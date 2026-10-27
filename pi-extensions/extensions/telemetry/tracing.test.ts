import { test } from "node:test";
import { expect } from "./test-assertions.ts";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { BoundedExporter, TelemetryTracing } from "./tracing.ts";

const config = {
  endpoint: "http://localhost:4318/v1/traces", headers: {}, serviceName: "test", sampleRatio: 1,
  shutdownTimeoutMs: 500, baggageAllowlist: [], protocol: "http/json" as const,
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

for (const count of [257, 800]) {
  test(`SDK scheduled export overlapping forceFlush delivers all ${count} spans exactly once`, async () => {
    const delivered: ReadableSpan[] = [];
    const callbacks: Array<() => void> = [];
    let live = 0;
    let peak = 0;
    const inner: SpanExporter = {
      export(spans, callback) {
        peak = Math.max(peak, ++live);
        callbacks.push(() => { delivered.push(...spans); live--; callback({ code: 0 }); });
      },
      async shutdown() {},
    };
    const warnings: string[] = [];
    const tracing = new TelemetryTracing(config, "session", inner, (message) => warnings.push(message));
    for (let i = 0; i < count; i++) tracing.end(tracing.startSpan("invoke_agent").span);
    // Reaching 256 starts the SDK's normal scheduled batch before forceFlush.
    expect(callbacks).toHaveLength(1);
    const flushed = tracing.provider.forceFlush();
    for (let i = 0; i < Math.ceil(count / 256); i++) {
      expect(callbacks).toHaveLength(1);
      callbacks.shift()!();
      await tick();
    }
    await flushed;
    expect(delivered).toHaveLength(count);
    expect(new Set(delivered.map((span) => span.spanContext().spanId)).size).toBe(count);
    expect(peak).toBe(1);
    expect(warnings).toEqual([]);
    await tracing.shutdown();
  });
}

test("queued batches get transport deadlines after admission, not while waiting", async () => {
  let delivered = 0;
  const tracing = new TelemetryTracing({ ...config, shutdownTimeoutMs: 80 }, "session", {
    export(spans, callback) {
      setTimeout(() => { delivered += spans.length; callback({ code: 0 }); }, 40);
    },
    async shutdown() {},
  });
  for (let i = 0; i < 1024; i++) tracing.end(tracing.startSpan("invoke_agent").span);
  await tracing.provider.forceFlush();
  expect(delivered).toBe(1024); // total exceeds a single transport deadline
  await tracing.shutdown();
});

test("bounded queue overflow is sanitized, nonfatal, and callbacks settle exactly once", async () => {
  const callbacks: Array<(result: { code: number }) => void> = [];
  const warnings: string[] = [];
  let shutdowns = 0;
  const exporter = new BoundedExporter({
    export(_spans, callback) { callbacks.push(callback); },
    shutdown() { shutdowns++; return new Promise<void>(() => {}); },
  }, (message) => warnings.push(message), 20);
  const results: number[] = [];
  for (let i = 0; i < 10; i++) exporter.export([], (result) => results.push(result.code));
  expect(results).toEqual([1]);
  expect(warnings).toEqual(["telemetry export queue full; batch omitted (details omitted)"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(results).toHaveLength(10);
  expect(callbacks).toHaveLength(1); // timeout must not open new live transports
  callbacks[0]({ code: 0 }); // late callback is ignored
  expect(results).toHaveLength(10);
  exporter.export([], (result) => results.push(result.code));
  expect(results).toHaveLength(11);
  expect(results.every((code) => code === 1)).toBe(true);
  expect(callbacks).toHaveLength(1); // Opaque exporter stays stopped after timeout.
  const started = Date.now();
  await exporter.shutdown(); // Even a hanging inner shutdown is bounded.
  expect(Date.now() - started).toBeLessThan(250);
  expect(shutdowns).toBe(1);
});
