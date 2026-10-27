import { test } from "node:test";
import { expect } from "./test-assertions.ts";
import { propagation, ROOT_CONTEXT, trace, createTraceState } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import type { TelemetryConfig } from "./config.ts";
import { TelemetryRuntime } from "./lifecycle.ts";
import { TelemetryTracing } from "./tracing.ts";

const config: TelemetryConfig = {
  endpoint: "http://localhost:4318/v1/traces", headers: {}, serviceName: "test", sampleRatio: 1,
  shutdownTimeoutMs: 100, baggageAllowlist: [], protocol: "http/json",
};

const fakeExporter: SpanExporter = {
  export(_spans, callback) { callback({ code: 0 }); },
  async shutdown() {},
  async forceFlush() {},
};

function baggage(headers: Record<string, string | null>) {
  const propagator = new W3CBaggagePropagator();
  const ctx = propagator.extract(ROOT_CONTEXT, headers, {
    keys: (carrier) => Object.keys(carrier),
    get: (carrier, key) => {
      const found = Object.entries(carrier).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
      return typeof found === "string" ? found : undefined;
    },
  });
  return propagation.getBaggage(ctx);
}

test("injects valid W3C context and both Pi session identity baggage keys", async () => {
  const sessionId = "session :/ ünicode";
  const telemetry = new TelemetryRuntime(config, sessionId, fakeExporter);
  telemetry.agentStart();
  const headers: Record<string, string | null> = { "X-Litellm-Session-Id": "cache-key" };
  telemetry.inject(headers);
  expect(headers["X-Litellm-Session-Id"]).toBe("cache-key");
  expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const value = baggage(headers);
  expect(value?.getEntry("session.id")?.value).toBe(sessionId);
  expect(value?.getEntry("gen_ai.conversation.id")?.value).toBe(sessionId);
  const state = headers.tracestate;
  if (state !== undefined) expect(typeof state).toBe("string");
  await telemetry.shutdown();
});

test("replaces stale case-insensitive propagation headers and baggage identities", async () => {
  const telemetry = new TelemetryRuntime(config, "current-session", fakeExporter);
  telemetry.agentStart();
  const headers: Record<string, string | null> = {
    TraceParent: "00-11111111111111111111111111111111-2222222222222222-00",
    TRACESTATE: "old=value",
    Baggage: "session.id=old,gen_ai.conversation.id=wrong,secret=never-copy",
    "X-Session-ID": "unrelated",
  };
  telemetry.inject(headers);
  expect(headers.TraceParent).toBeUndefined();
  expect(headers.TRACESTATE).toBeUndefined();
  expect(headers.Baggage).toBeUndefined();
  const value = baggage(headers);
  expect(value?.getEntry("session.id")?.value).toBe("current-session");
  expect(value?.getEntry("gen_ai.conversation.id")?.value).toBe("current-session");
  expect(value?.getEntry("secret")).toBeUndefined();
  expect(headers["X-Session-ID"]).toBe("unrelated");
  await telemetry.shutdown();
});

test("allowlisting identity aliases cannot forward stale identities", async () => {
  const tracing = new TelemetryTracing(config, "current-session", fakeExporter);
  const root = tracing.startSpan("invoke_agent");
  const headers: Record<string, string | null> = { baggage: "Session.Id=old,GEN_AI.CONVERSATION.ID=wrong,approved=ok,secret=canary" };
  tracing.inject(headers, root.context, ["Session.Id", "GEN_AI.CONVERSATION.ID", "approved"]);
  const entries = baggage(headers);
  expect(entries?.getEntry("Session.Id")).toBeUndefined();
  expect(entries?.getEntry("GEN_AI.CONVERSATION.ID")).toBeUndefined();
  expect(entries?.getEntry("approved")?.value).toBe("ok");
  expect(entries?.getEntry("secret")).toBeUndefined();
  tracing.end(root.span);
  await tracing.shutdown();
});

test("oversized Unicode session identities are omitted as a pair instead of truncated", async () => {
  const warnings: string[] = [];
  // Exceeds the W3C byte limit after percent encoding while remaining under the character limit.
  const sessionId = "界".repeat(3000);
  const tracing = new TelemetryTracing(config, sessionId, fakeExporter, (message) => warnings.push(message));
  const span = tracing.startSpan("invoke_agent");
  const headers: Record<string, string | null> = { baggage: "session.id=stale,keep=stale" };
  tracing.inject(headers, span.context, []);
  const value = baggage(headers);
  expect(value?.getEntry("session.id")).toBeUndefined();
  expect(value?.getEntry("gen_ai.conversation.id")).toBeUndefined();
  expect(value?.getEntry("keep")).toBeUndefined();
  expect(warnings).toContain("session identity baggage exceeds propagation limits; both identities omitted");
  tracing.end(span.span);
  await tracing.shutdown();
});

test("selected extra entries omitted by W3C limits warn without losing required identities", async () => {
  const warnings: string[] = [];
  const tracing = new TelemetryTracing(config, "session", fakeExporter, (message) => warnings.push(message));
  const span = tracing.startSpan("invoke_agent");
  // Incoming baggage fits the aggregate limit, but a Unicode key's re-encoding
  // exceeds the per-entry limit on injection. Extraction preserves this key.
  const key = "界".repeat(500);
  const headers: Record<string, string | null> = { baggage: `${key}=ok` };
  tracing.inject(headers, span.context, [key]);
  expect(baggage(headers)?.getEntry(key)).toBeUndefined();
  expect(baggage(headers)?.getEntry("session.id")?.value).toBe("session");
  expect(baggage(headers)?.getEntry("gen_ai.conversation.id")?.value).toBe("session");
  expect(warnings).toEqual(["selected extra baggage exceeds propagation limits; entries omitted (details omitted)"]);
  tracing.end(span.span);
  await tracing.shutdown();
});

test("non-recording spans still inject session baggage and unsampled trace context", async () => {
  const telemetry = new TelemetryRuntime({ ...config, sampleRatio: 0 }, "unsampled", fakeExporter);
  telemetry.agentStart();
  const headers: Record<string, string | null> = {};
  telemetry.inject(headers);
  expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  expect(baggage(headers)?.getEntry("session.id")?.value).toBe("unsampled");
  await telemetry.shutdown();
});

test("explicit context tracestate survives injection without adopting inbound state", async () => {
  const tracing = new TelemetryTracing(config, "state-session", fakeExporter);
  const selected = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1,
    traceState: createTraceState("owned=value"),
  });
  const headers: Record<string, string | null> = { tracestate: "stale=value" };
  tracing.inject(headers, selected, []);
  expect(headers.tracestate).toBe("owned=value");
  await tracing.shutdown();
});

test("oversized span identities disable the generation instead of exporting untagged spans", () => {
  const warnings: string[] = [];
  const secret = "identity-canary".repeat(500);
  expect(() => new TelemetryTracing(config, secret, fakeExporter, (message) => warnings.push(message)))
    .toThrow("Unsupported telemetry session identity");
  expect(warnings).toHaveLength(1);
  expect(warnings.join(" ")).not.toContain("identity-canary");
});

test("idle propagation uses a short dispatch root and remains parseable", async () => {
  const telemetry = new TelemetryRuntime(config, "idle-session", fakeExporter);
  const headers: Record<string, string | null> = {};
  telemetry.inject(headers);
  expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const extracted = new W3CTraceContextPropagator().extract(ROOT_CONTEXT, headers, {
    keys: (carrier) => Object.keys(carrier),
    get: (carrier, key) => carrier[key] ?? undefined,
  });
  expect(extracted).not.toBe(ROOT_CONTEXT);
  await telemetry.shutdown();
});
