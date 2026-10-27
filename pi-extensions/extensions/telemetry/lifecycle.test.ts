import { test } from "node:test";
import { expect } from "./test-assertions.ts";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { TelemetryConfig } from "./config.ts";
import { TelemetryRuntime } from "./lifecycle.ts";
import { TelemetryTracing } from "./tracing.ts";

class MemoryExporter implements SpanExporter {
  spans: ReadableSpan[] = [];
  export(spans: ReadableSpan[], callback: (result: { code: number; error?: Error }) => void): void {
    this.spans.push(...spans);
    callback({ code: 0 });
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

const config: TelemetryConfig = {
  endpoint: "http://localhost:4318/v1/traces", headers: {}, serviceName: "test", sampleRatio: 1,
  shutdownTimeoutMs: 100, baggageAllowlist: [], protocol: "http/json",
};

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function runtime(exporter: MemoryExporter, sessionId = "session-1"): TelemetryRuntime {
  return new TelemetryRuntime(config, sessionId, exporter);
}

test("provider construction and shutdown leave the process-global provider untouched", async () => {
  const globalProvider = trace.getTracerProvider();
  const telemetry = new TelemetryTracing(config, "session", new MemoryExporter());
  expect(trace.getTracerProvider()).toBe(globalProvider);
  await telemetry.shutdown();
  expect(trace.getTracerProvider()).toBe(globalProvider);
});

test("span attributes use an explicit allowlist and bounded values", async () => {
  const exporter = new MemoryExporter();
  const telemetry = new TelemetryTracing(config, "session", exporter);
  const span = telemetry.startSpan("invoke_agent", undefined, {
    "user.prompt": "must never export",
    "gen_ai.tool.call.id": "also rejected on an interaction",
  });
  telemetry.end(span.span);
  await telemetry.shutdown();
  expect(exporter.spans[0].attributes).toEqual({
    "session.id": "session", "gen_ai.conversation.id": "session",
    "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "pi",
  });
});

test("GenAI tool schema stays bounded and excludes content with a full finalization budget", async () => {
  const exporter = new MemoryExporter();
  const telemetry = new TelemetryTracing(config, "session", exporter);
  const tool = telemetry.startSpan("execute_tool", undefined, {
    "gen_ai.tool.name": "x".repeat(200),
    "gen_ai.tool.call.id": "call-1",
    "gen_ai.tool.call.arguments": "private arguments",
    "gen_ai.tool.call.result": "private result",
    "gen_ai.input.messages": "private messages",
    "gen_ai.request.model": "proxy-owned-model",
    "gen_ai.usage.input_tokens": 100,
    "session.id": "wrong-session",
  });
  telemetry.end(tool.span, "error", true);
  const invalid = telemetry.startSpan("execute_tool", undefined, {
    "gen_ai.tool.name": "private/path\ncontent", "gen_ai.tool.call.id": "bad\ncall",
  });
  telemetry.end(invalid.span);
  await telemetry.shutdown();
  expect(exporter.spans[0].name).toBe(`execute_tool ${"x".repeat(128)}`);
  expect(exporter.spans[0].attributes).toEqual({
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": "x".repeat(128), "gen_ai.tool.call.id": "call-1",
    "session.id": "session", "gen_ai.conversation.id": "session",
    "pi.outcome": "error", "pi.incomplete": true, "error.type": "agent_error",
  });
  expect(exporter.spans[0].kind).toBe(SpanKind.INTERNAL);
  expect(exporter.spans[0].droppedAttributesCount).toBe(0);
  expect(exporter.spans[1].name).toBe("execute_tool other");
  expect(exporter.spans[1].attributes["gen_ai.tool.call.id"]).toBeUndefined();
});

test("tool names share one Unicode-aware normalizer and always satisfy the required schema", async () => {
  const exporter = new MemoryExporter();
  const tracing = new TelemetryTracing(config, "session", exporter);
  const cases: Record<string, string | number | boolean>[] = [{}, { "gen_ai.tool.name": 42 }, { "gen_ai.tool.name": "工具_é" }];
  for (const attributes of cases) {
    tracing.end(tracing.startSpan("execute_tool", undefined, attributes).span);
  }
  await tracing.shutdown();
  expect(exporter.spans.map((span) => span.name)).toEqual([
    "execute_tool unknown", "execute_tool unknown", "execute_tool 工具_é",
  ]);
  expect(exporter.spans.map((span) => span.attributes["gen_ai.tool.name"])).toEqual(["unknown", "unknown", "工具_é"]);
  const runtimeExporter = new MemoryExporter();
  const telemetry = runtime(runtimeExporter);
  telemetry.agentStart();
  telemetry.toolStart("unicode", "工具_é");
  telemetry.toolEnd("unicode", false);
  await telemetry.shutdown();
  expect(runtimeExporter.spans.find((span) => span.attributes["gen_ai.tool.call.id"] === "unicode")?.name).toBe("execute_tool 工具_é");
});

test("tool-name truncation preserves astral Unicode at the code-point boundary", async () => {
  const exporter = new MemoryExporter();
  const telemetry = new TelemetryTracing(config, "session", exporter);
  const names = ["a".repeat(127) + "𐐀" + "tail", "𐐀".repeat(129)];
  for (const name of names) {
    telemetry.end(telemetry.startSpan("execute_tool", undefined, { "gen_ai.tool.name": name }).span);
  }
  await telemetry.shutdown();
  const expected = ["a".repeat(127) + "𐐀", "𐐀".repeat(128)];
  expect(exporter.spans.map((span) => span.attributes["gen_ai.tool.name"])).toEqual(expected);
  expect(exporter.spans.map((span) => span.name)).toEqual(expected.map((name) => `execute_tool ${name}`));
});

test("keeps one interaction over repeated agent starts and uses latest settle outcome", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.beforeSettle("error");
  telemetry.agentStart();
  telemetry.beforeSettle("completed");
  telemetry.settled();
  await drain();
  expect(exporter.spans).toHaveLength(1);
  expect(exporter.spans[0].name).toBe("invoke_agent pi");
  expect(exporter.spans[0].attributes["session.id"]).toBe("session-1");
  expect(exporter.spans[0].attributes["pi.outcome"]).toBe("completed");
  expect(exporter.spans[0].status.code).toBe(1);
  await telemetry.shutdown();
});

test("settled interactions get fresh traces while retaining the session ID", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.beforeSettle("aborted");
  telemetry.settled();
  telemetry.agentStart();
  telemetry.beforeSettle("error");
  telemetry.settled();
  await telemetry.shutdown();
  const interactions = exporter.spans.filter((span) => span.name === "invoke_agent pi");
  expect(interactions).toHaveLength(2);
  expect(interactions[0].spanContext().traceId).not.toBe(interactions[1].spanContext().traceId);
  expect(interactions.map((span) => span.attributes["session.id"])).toEqual(["session-1", "session-1"]);
  expect(interactions[0].attributes["pi.outcome"]).toBe("aborted");
  expect(interactions[0].status.code).toBe(0);
  expect(interactions[1].status.code).toBe(2);
});

test("parallel and nested tools preserve parentage regardless of end order", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.toolStart("a", "shell");
  telemetry.toolStart("b", "read");
  telemetry.toolStart("a/1", "nested", "a");
  telemetry.toolEnd("b", false);
  telemetry.toolEnd("a", false);
  telemetry.toolEnd("a/1", false);
  telemetry.settled();
  await drain();
  const byId = new Map(exporter.spans.map((span) => [span.attributes["gen_ai.tool.call.id"], span]));
  const interaction = exporter.spans.find((span) => span.name === "invoke_agent pi")!;
  expect(byId.get("a")?.parentSpanContext?.spanId).toBe(interaction.spanContext().spanId);
  expect(byId.get("b")?.parentSpanContext?.spanId).toBe(interaction.spanContext().spanId);
  expect(byId.get("a/1")?.parentSpanContext?.spanId).toBe(byId.get("a")?.spanContext().spanId);
  expect(exporter.spans.every((span) => span.attributes["session.id"] === "session-1")).toBe(true);
  await telemetry.shutdown();
});

for (const isError of [false, true]) {
  test(`tool completion records explicit ${isError ? "error" : "completed"} outcome and content-free status`, async () => {
    const exporter = new MemoryExporter();
    const telemetry = runtime(exporter);
    telemetry.agentStart();
    telemetry.toolStart("tool-call", "shell");
    telemetry.toolEnd("tool-call", isError);
    telemetry.toolEnd("tool-call", !isError); // Duplicate end must not change the result.
    await telemetry.shutdown();
    const tools = exporter.spans.filter((span) => span.name.startsWith("execute_tool "));
    expect(tools).toHaveLength(1);
    expect(tools[0].attributes["pi.outcome"]).toBe(isError ? "error" : "completed");
    expect(tools[0].status).toEqual(isError
      ? { code: SpanStatusCode.ERROR, message: "Agent activity failed" }
      : { code: SpanStatusCode.OK });
    expect(tools[0].events).toEqual([]);
  });
}

test("unknown ID cannot close a same-name live tool; duplicate starts do not overwrite", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.toolStart("live", "shell");
  telemetry.toolStart("live", "other");
  telemetry.toolEnd("unknown", true);
  telemetry.toolEnd("live", false);
  telemetry.settled();
  await drain();
  expect(exporter.spans.filter((span) => span.name.startsWith("execute_tool "))).toHaveLength(1);
  expect(exporter.spans.find((span) => span.name.startsWith("execute_tool "))?.attributes["gen_ai.tool.name"]).toBe("shell");
  await telemetry.shutdown();
});

test("unknown nested parent falls back to the active interaction, not a new root", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.toolStart("nested", "read", "missing");
  telemetry.toolEnd("nested", false);
  telemetry.settled();
  await telemetry.shutdown();
  const interaction = exporter.spans.find((span) => span.name === "invoke_agent pi")!;
  const tool = exporter.spans.find((span) => span.name.startsWith("execute_tool "))!;
  expect(tool.parentSpanContext?.spanId).toBe(interaction.spanContext().spanId);
  expect(tool.spanContext().traceId).toBe(interaction.spanContext().traceId);
  expect(exporter.spans.some((span) => span.name === "pi.tool_scope")).toBe(false);
});

test("orphan tools receive an explicit session-tagged scope root", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.toolStart("orphan", "mystery", "missing-parent");
  telemetry.toolEnd("orphan", false);
  await telemetry.shutdown();
  const scope = exporter.spans.find((span) => span.name === "pi.tool_scope");
  const tool = exporter.spans.find((span) => span.name.startsWith("execute_tool "));
  expect(scope?.name).toBe("pi.tool_scope");
  expect(scope?.attributes["session.id"]).toBe("session-1");
  expect(tool?.parentSpanContext?.spanId).toBe(scope?.spanContext().spanId);
});

test("hanging export callbacks release the exporter and shutdown has a deadline", async () => {
  const warnings: string[] = [];
  const hanging: SpanExporter = {
    export() { /* deliberately never calls back */ },
    shutdown() { return new Promise<void>(() => {}); },
    forceFlush() { return new Promise<void>(() => {}); },
  };
  const telemetry = new TelemetryTracing({ ...config, shutdownTimeoutMs: 30 }, "session", hanging, (message) => warnings.push(message));
  const span = telemetry.startSpan("invoke_agent");
  telemetry.end(span.span);
  telemetry.flushSoon();
  const started = Date.now();
  await telemetry.shutdown();
  expect(Date.now() - started).toBeLessThan(250);
  expect(warnings).toContain("telemetry export failed (details omitted)");
  expect(warnings.join(" ")).not.toContain("session");
});

test("failed exporters do not expose their raw error through callbacks or diagnostics", async () => {
  const secret = "private-export-error-canary";
  const exporter: SpanExporter = {
    export(_spans, callback) { callback({ code: 1, error: new Error(secret) }); },
    async shutdown() {},
    async forceFlush() {},
  };
  const warnings: string[] = [];
  const telemetry = new TelemetryTracing(config, "session", exporter, (message) => warnings.push(message));
  const span = telemetry.startSpan("invoke_agent");
  telemetry.end(span.span);
  telemetry.flushSoon();
  await drain();
  await telemetry.shutdown();
  expect(warnings).toContain("telemetry export failed (details omitted)");
  expect(warnings.join(" ")).not.toContain(secret);
});

test("concurrent runtime shutdown calls share the bounded shutdown operation", async () => {
  const exporter: SpanExporter = {
    export() {},
    shutdown() { return new Promise<void>(() => {}); },
    forceFlush() { return new Promise<void>(() => {}); },
  };
  const telemetry = new TelemetryRuntime(config, "session", exporter);
  const first = telemetry.shutdown();
  const second = telemetry.shutdown();
  expect(second).toBe(first);
  const started = Date.now();
  await first;
  expect(Date.now() - started).toBeLessThan(300);
});

test("shutdown closes outstanding tools and interaction as incomplete", async () => {
  const exporter = new MemoryExporter();
  const telemetry = runtime(exporter);
  telemetry.agentStart();
  telemetry.toolStart("unfinished", "shell");
  await telemetry.shutdown();
  expect(exporter.spans).toHaveLength(2);
  expect(exporter.spans.every((span) => span.attributes["pi.incomplete"] === true)).toBe(true);
});
