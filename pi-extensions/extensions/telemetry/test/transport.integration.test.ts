import { afterEach, test } from "node:test";
import { expect } from "../test-assertions.ts";
import * as http from "node:http";
import * as net from "node:net";
import { TelemetryRuntime } from "../lifecycle.ts";
import { TelemetryTracing } from "../tracing.ts";
import type { TelemetryConfig } from "../config.ts";

const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP address"));
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1/traces` });
    });
  });
}

async function eventually(read: () => number, message: string): Promise<void> {
  const until = Date.now() + 2000;
  while (read() === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  if (read() === 0) throw new Error(message);
}

function config(endpoint: string, shutdownTimeoutMs = 100): TelemetryConfig {
  return {
    endpoint,
    headers: { "x-export-test": "private-canary" },
    serviceName: "telemetry-transport-test",
    sampleRatio: 1,
    shutdownTimeoutMs,
    baggageAllowlist: [],
    protocol: "http/json",
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

test("real OTLP HTTP transport tolerates an endpoint rejection without leaking response details", async () => {
  let received = 0;
  let rejected = 0;
  const receiver = await listen(async (request, response) => {
    received++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    expect(request.headers["x-export-test"]).toBe("private-canary");
    expect(Buffer.concat(chunks).toString("utf8")).toContain("invoke_agent pi");
    rejected++;
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("rejection detail must not escape");
  });
  const runtime = new TelemetryRuntime(config(receiver.url), "rejected-export-session");
  runtime.agentStart();
  runtime.beforeSettle("completed");
  runtime.settled();

  await eventually(() => rejected, "The real OTLP exporter did not receive the rejecting endpoint response");
  await runtime.shutdown();
  expect(received).toBe(1);
});

test("real OTLP HTTP transport delivers the next batch after a stalled request times out", async () => {
  const payloads: string[] = [];
  const receiver = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payloads.push(Buffer.concat(chunks).toString("utf8"));
    if (payloads.length === 1) return; // First request never gets response headers.
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const warnings: string[] = [];
  const tracing = new TelemetryTracing(config(receiver.url, 100), "recovery-session", undefined, (message) => warnings.push(message));
  try {
    const first = tracing.startSpan("invoke_agent").span;
    tracing.end(first, "completed");
    await expect(tracing.provider.forceFlush()).rejects.toBeDefined();
    expect(payloads).toHaveLength(1);
    expect(warnings).toEqual(["telemetry export failed (details omitted)"]);

    const next = tracing.startSpan("invoke_agent").span;
    tracing.end(next, "completed");
    await tracing.provider.forceFlush();
    expect(payloads).toHaveLength(2);
    const delivered = JSON.parse(payloads[1]).resourceSpans[0].scopeSpans[0].spans;
    expect(delivered).toHaveLength(1);
    expect(delivered[0].spanId).toBe(next.spanContext().spanId);
    expect(delivered[0].name).toBe("invoke_agent pi");
    expect(warnings).toHaveLength(1);
  } finally {
    await tracing.shutdown();
  }
});

test("real OTLP HTTP transport times out a stalled endpoint with sanitized diagnostics", async () => {
  let received = 0;
  let closed = 0;
  // A raw TCP fixture observes actual socket cleanup without relying on
  // higher-level HTTP server response-close semantics.
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("data", () => received++);
    socket.on("data", () => {});
    socket.once("close", () => { closed++; sockets.delete(socket); });
    // Deliberately never send HTTP response headers.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  const receiver = { url: `http://127.0.0.1:${address.port}/v1/traces` };
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => { warnings.push(String(message)); };
  const runtime = new TelemetryRuntime(config(receiver.url, 100), "timeout-export-session");
  runtime.agentStart();
  runtime.beforeSettle("completed");
  runtime.settled();

  try {
    await eventually(() => received, "The real OTLP exporter did not contact the stalled endpoint");
    await eventually(() => warnings.length, "The stalled export did not hit the configured exporter deadline");
    await eventually(() => closed, "The transport deadline did not disconnect the stalled HTTP response");
    expect(warnings).toContain("telemetry export failed (details omitted)");
    expect(warnings.join(" ")).not.toContain("private-canary");
    expect(warnings.join(" ")).not.toContain("rejection detail");
    const started = Date.now();
    await runtime.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    console.warn = originalWarn;
    await runtime.shutdown();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
