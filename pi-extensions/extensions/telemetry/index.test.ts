import { test } from "node:test";
import { expect } from "./test-assertions.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTelemetry } from "./index.ts";
import type { TelemetryConfig } from "./config.ts";

const config: TelemetryConfig = {
  endpoint: "http://localhost:4318/v1/traces", headers: {}, serviceName: "test", sampleRatio: 1,
  shutdownTimeoutMs: 100, baggageAllowlist: [], protocol: "http/json",
};

type Handler = (event: any, ctx: any) => unknown;
function setup(shutdown?: (runtimeIndex: number) => Promise<void>) {
  const handlers = new Map<string, Handler>();
  const runtimes: Array<{ calls: unknown[][]; runtime: any }> = [];
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  registerTelemetry(pi, {
    getAgentDir: () => "/authoritative/agent-dir",
    loadConfig: (dir) => { expect(dir).toBe("/authoritative/agent-dir"); return config; },
    createRuntime: (_config, sessionId) => {
      const index = runtimes.length;
      const calls: unknown[][] = [];
      const runtime = Object.fromEntries(["agentStart", "beforeSettle", "settled", "toolStart", "toolEnd", "inject"].map((method) => [method, (...args: unknown[]) => calls.push([method, ...args])])) as any;
      runtime.shutdown = () => { calls.push(["shutdown"]); return shutdown?.(index); };
      runtimes.push({ calls, runtime });
      return runtime;
    },
  });
  const ctx = (sessionId: string) => ({ sessionManager: { getSessionId: () => sessionId } });
  const emit = (eventName: string, event: unknown = {}, sessionId = "session-1") => handlers.get(eventName)?.(event, ctx(sessionId));
  return { handlers, runtimes, ctx, emit };
}

const resolved = async (value: unknown) => { await value; };

test("wires lifecycle, actual settle outcome, nested tools, and provider header injection", async () => {
  const { emit, runtimes } = setup();
  await resolved(emit("session_start"));
  emit("agent_start");
  emit("agent_before_settle", { outcome: "aborted" });
  emit("tool_execution_start", { toolCallId: "tool/1", toolName: "read", parentToolCallId: "parent" });
  emit("tool_execution_end", { toolCallId: "tool/1", isError: true });
  const headers: Record<string, string | null> = { traceparent: "prior" };
  emit("before_provider_headers", { headers });
  emit("agent_settled");
  expect(runtimes[0].calls).toEqual([
    ["agentStart"], ["beforeSettle", "aborted"], ["toolStart", "tool/1", "read", "parent"],
    ["toolEnd", "tool/1", true], ["inject", headers], ["settled"],
  ]);
});

test("early abort turn_end outcome is captured passively without before_settle", async () => {
  const { emit, runtimes } = setup();
  await resolved(emit("session_start"));
  emit("agent_start");
  expect(emit("turn_end", { outcome: "aborted", message: { secret: "not inspected" } })).toBeUndefined();
  emit("agent_settled");
  expect(runtimes[0].calls).toEqual([["agentStart"], ["beforeSettle", "aborted"], ["settled"]]);
});

test("later boundary outcome replaces a transient turn outcome", async () => {
  const { emit, runtimes } = setup();
  await resolved(emit("session_start"));
  emit("turn_end", { outcome: "error" });
  emit("agent_before_settle", { outcome: "completed" });
  expect(runtimes[0].calls).toEqual([["beforeSettle", "error"], ["beforeSettle", "completed"]]);
});

test("awaits old shutdown before replacement and prevents racing starts from installing stale runtimes", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { handlers, runtimes, ctx } = setup((index) => index === 0 ? blocked : Promise.resolve());
  await handlers.get("session_start")?.({}, ctx("session-1"));
  const replacing = handlers.get("session_start")?.({}, ctx("session-2")) as Promise<void>;
  expect(runtimes[0].calls).toEqual([["shutdown"]]);
  expect(runtimes).toHaveLength(1);

  const latest = handlers.get("session_start")?.({}, ctx("session-3")) as Promise<void>;
  release();
  await Promise.all([replacing, latest]);
  expect(runtimes).toHaveLength(2);
  handlers.get("agent_start")?.({}, ctx("session-3"));
  expect(runtimes[1].calls).toEqual([["agentStart"]]);
});

test("shutdown invalidates and awaits a start pending old generation retirement", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { handlers, runtimes, ctx } = setup((index) => index === 0 ? blocked : Promise.resolve());
  await handlers.get("session_start")?.({}, ctx("session-1"));
  const starting = handlers.get("session_start")?.({}, ctx("session-2"));
  const stopping = handlers.get("session_shutdown")?.({}, ctx("session-2"));
  release();
  await Promise.all([starting, stopping]);
  expect(runtimes).toHaveLength(1);
  handlers.get("agent_start")?.({}, ctx("session-2"));
  expect(runtimes[0].calls).toEqual([["shutdown"]]);
});

test("mismatched ordinary callbacks retire old state and are ignored", async () => {
  const { handlers, runtimes, ctx } = setup();
  await handlers.get("session_start")?.({}, ctx("session-1"));
  handlers.get("agent_start")?.({}, ctx("other-session"));
  expect(runtimes[0].calls).toEqual([["shutdown"]]);
  handlers.get("tool_execution_start")?.({ toolCallId: "stale", toolName: "read" }, ctx("session-1"));
  expect(runtimes[0].calls).toEqual([["shutdown"]]);
});

test("session shutdown awaits bounded runtime cleanup; runtime failures remain non-fatal", async () => {
  const handlers = new Map<string, Handler>();
  let shutDown = 0;
  let release!: () => void;
  const shutdownDone = new Promise<void>((resolve) => { release = resolve; });
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  registerTelemetry(pi, {
    getAgentDir: () => "/agent", loadConfig: () => config,
    createRuntime: () => ({
      agentStart() { throw new Error("failure"); }, beforeSettle() {}, settled() {}, toolStart() {}, toolEnd() {}, inject() {},
      shutdown() { shutDown++; return shutdownDone; },
    }),
  });
  const ctx = { sessionManager: { getSessionId: () => "s" } };
  await handlers.get("session_start")?.({}, ctx);
  expect(() => handlers.get("agent_start")?.({}, ctx)).not.toThrow();
  let complete = false;
  const stopping = handlers.get("session_shutdown")?.({}, ctx) as Promise<void>;
  void stopping.then(() => { complete = true; });
  await Promise.resolve();
  expect(shutDown).toBe(1);
  expect(complete).toBe(false);
  release();
  await stopping;
  expect(complete).toBe(true);
});

test("rejected runtime shutdown is swallowed after being awaited", async () => {
  const handlers = new Map<string, Handler>();
  const pi = { on: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  registerTelemetry(pi, {
    getAgentDir: () => "/agent", loadConfig: () => config,
    createRuntime: () => ({ agentStart() {}, beforeSettle() {}, settled() {}, toolStart() {}, toolEnd() {}, inject() {}, shutdown: () => Promise.reject(new Error("shutdown failure")) }),
  });
  const ctx = { sessionManager: { getSessionId: () => "s" } };
  await handlers.get("session_start")?.({}, ctx);
  await expect(handlers.get("session_shutdown")?.({}, ctx)).resolves.toBeUndefined();
});
