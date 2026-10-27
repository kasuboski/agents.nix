import { afterEach, test } from "node:test";
import { expect } from "../test-assertions.ts";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

type WireRequest = { headers: http.IncomingHttpHeaders; body: any };
type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
  status?: { code?: number; message?: string };
};

const servers: http.Server[] = [];
const tempDirs: string[] = [];

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP address"));
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function bodyOf(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sse(content: string): string {
  return [
    `data: ${JSON.stringify({ id: "local-test", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "local-test", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
    "",
    "",
  ].join("\r\n\r\n");
}

function toolSse(): string {
  return [
    `data: ${JSON.stringify({ id: "local-tool", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "outer-call", type: "function", function: { name: "outer", arguments: "{}" } }] }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ id: "local-tool", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}`,
    "data: [DONE]",
    "",
    "",
  ].join("\r\n\r\n");
}

function otlpSpans(payloads: any[]): OtlpSpan[] {
  return payloads.flatMap((payload) => (payload.resourceSpans ?? []).flatMap((resource: any) =>
    (resource.scopeSpans ?? []).flatMap((scope: any) => scope.spans ?? [])));
}

function attr(span: OtlpSpan, key: string): any {
  return span.attributes?.find((item) => item.key === key)?.value;
}

async function eventually<T>(read: () => T, ready: (value: T) => boolean, message: string): Promise<T> {
  const until = Date.now() + 4000;
  let value = read();
  while (!ready(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = read();
  }
  if (!ready(value)) throw new Error(message);
  return value;
}

async function createAgentDir(endpoint: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-telemetry-sdk-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "extensions"), { recursive: true });
  await fs.writeFile(path.join(dir, "extensions", "telemetry.json"), JSON.stringify({
    endpoint: `${endpoint}/v1/traces`,
    headersFromEnv: "PI_TEST_OTEL_EXPORT_HEADERS",
    shutdownTimeoutMs: 1000,
  }));
  return dir;
}

async function makeSession(
  agentDir: string,
  cwd: string,
  modelUrl: string,
  captureRegistry?: (registry: any) => void,
  compaction: { enabled: boolean; reserveTokens?: number; keepRecentTokens?: number } = { enabled: false },
) {
  const telemetryEntry = path.resolve(currentDir, "../index.ts");
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("openai", { baseUrl: `${modelUrl}/v1`, apiKey: "model-only-key" });
  const baseModel = modelRuntime.getModel("openai", "gpt-4o-mini");
  if (!baseModel) throw new Error("Installed Pi 1.0.2 did not expose openai/gpt-4o-mini");
  // This fixture deliberately exercises Chat Completions rather than Responses SSE.
  const model = { ...baseModel, api: "openai-completions" } as typeof baseModel;
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [telemetryEntry],
    extensionFactories: captureRegistry ? [(pi) => { pi.on("session_start", (_event, ctx) => captureRegistry(ctx.modelRegistry)); }] : [],
  });
  await resourceLoader.reload();
  const created = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    sessionStartEvent: { type: "session_start", reason: "startup" },
    settingsManager: SettingsManager.inMemory({ compaction }),
    customTools: [
      {
        name: "outer",
        label: "Outer",
        description: "Run a nested tool",
        parameters: Type.Object({}),
        execute: async (_id, _params, _signal, _update, ctx) => {
          const result = await ctx.executeTool("inner", {});
          return { content: [{ type: "text", text: "outer done" }], details: result.result.details };
        },
      } satisfies ToolDefinition,
      {
        name: "inner",
        label: "Inner",
        description: "Nested test tool",
        parameters: Type.Object({}),
        execute: async () => ({ content: [{ type: "text", text: "inner done" }], details: {} }),
      } satisfies ToolDefinition,
    ],
  });
  await created.session.bindExtensions({});
  return created;
}

afterEach(async () => {
  delete process.env.PI_TEST_OTEL_EXPORT_HEADERS;
  delete process.env.PI_CODING_AGENT_DIR;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test("Pi 1.0.2 SDK loads telemetry index.ts and propagates interaction context through a nested tool turn", async () => {
  const wire: WireRequest[] = [];
  const modelServer = await listen(async (request, response) => {
    const body = JSON.parse(await bodyOf(request));
    wire.push({ headers: request.headers, body });
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    response.end(wire.length === 1 ? toolSse() : sse("finished"));
  });
  const exports: any[] = [];
  const receiver = await listen(async (request, response) => {
    expect(request.url).toBe("/v1/traces");
    expect(request.headers["x-export-only-secret"]).toBe("export-secret-canary");
    exports.push(JSON.parse(await bodyOf(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const agentDir = await createAgentDir(receiver.url);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-telemetry-cwd-"));
  tempDirs.push(cwd);
  process.env.PI_TEST_OTEL_EXPORT_HEADERS = "X-Export-Only-Secret=export-secret-canary";

  const { session } = await makeSession(agentDir, cwd, modelServer.url);
  const sessionId = session.sessionManager.getSessionId();
  try {
    await session.prompt("sdk-prompt-canary; call outer once, then finish");
    expect(wire).toHaveLength(2);
    expect(wire[0].body.messages.some((message: any) => JSON.stringify(message).includes("sdk-prompt-canary"))).toBe(true);
    expect(wire.every((request) => request.headers["x-export-only-secret"] === undefined)).toBe(true);
    expect(wire.every((request) => request.headers.authorization === "Bearer model-only-key")).toBe(true);
    expect(wire.every((request) => typeof request.headers.traceparent === "string")).toBe(true);
    const propagatedBaggage = wire[0].headers.baggage;
    expect(propagatedBaggage).toContain(`session.id=${sessionId}`);
    expect(propagatedBaggage).toContain(`gen_ai.conversation.id=${sessionId}`);

    await eventually(() => exports, (items) => items.length > 0, "No OTLP export received from the real SDK session");
    const spans = otlpSpans(exports);
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const interactions = spans.filter((span) => span.name === "invoke_agent pi");
    expect(interactions).toHaveLength(1);
    expect(interactions[0].traceId).toBe(wire[0].headers.traceparent!.toString().split("-")[1]);
    expect(attr(interactions[0], "session.id")?.stringValue).toBe(sessionId);
    expect(attr(interactions[0], "gen_ai.operation.name")?.stringValue).toBe("invoke_agent");
    expect(attr(interactions[0], "gen_ai.agent.name")?.stringValue).toBe("pi");
    // The proxy's incoming parent is the agent span, not a fabricated local LLM span.
    expect(wire.every((request) => request.headers.traceparent!.toString().split("-")[2] === interactions[0].spanId)).toBe(true);
    expect(spans.every((span) => attr(span, "gen_ai.conversation.id")?.stringValue === sessionId)).toBe(true);

    const toolSpans = spans.filter((span) => span.name.startsWith("execute_tool "));
    expect(toolSpans.length).toBeGreaterThanOrEqual(2);
    expect(toolSpans.every((span) => attr(span, "gen_ai.operation.name")?.stringValue === "execute_tool")).toBe(true);
    expect(toolSpans.every((span) => span.name === `execute_tool ${attr(span, "gen_ai.tool.name")?.stringValue}`)).toBe(true);
    const outer = toolSpans.find((span) => attr(span, "gen_ai.tool.name")?.stringValue === "outer");
    const inner = toolSpans.find((span) => attr(span, "gen_ai.tool.name")?.stringValue === "inner");
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner!.parentSpanId).toBe(outer!.spanId);
    expect(toolSpans.every((span) => span.traceId === interactions[0].traceId)).toBe(true);
    expect(spans.every((span) => attr(span, "session.id")?.stringValue === sessionId)).toBe(true);

    const serialized = JSON.stringify(exports);
    expect(serialized).not.toContain("sdk-prompt-canary");
    expect(serialized).not.toContain("export-secret-canary");
    expect(serialized).not.toContain("model-only-key");
    expect(serialized).not.toMatch(/gen_ai\.(input|output|usage|cost)/);
  } finally {
    session.dispose();
  }
});

test("real SDK early stream abort exports aborted interaction rather than unknown", async () => {
  let streaming = false;
  const modelServer = await listen(async (request, response) => {
    await bodyOf(request);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "abort-test", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: { content: "private-abort-content" }, finish_reason: null }] })}\r\n\r\n`);
    streaming = true;
  });
  const exports: any[] = [];
  const receiver = await listen(async (request, response) => {
    exports.push(JSON.parse(await bodyOf(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const agentDir = await createAgentDir(receiver.url);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-telemetry-cwd-"));
  tempDirs.push(cwd);
  const { session } = await makeSession(agentDir, cwd, modelServer.url);
  try {
    const prompting = session.prompt("abort prompt canary");
    await eventually(() => streaming, Boolean, "Model stream did not start");
    await session.abort();
    await prompting;
    await eventually(() => otlpSpans(exports), (spans) => spans.some((span) => span.name === "invoke_agent pi"), "Abort interaction not exported");
    const interaction = otlpSpans(exports).find((span) => span.name === "invoke_agent pi")!;
    expect(attr(interaction, "pi.outcome")?.stringValue).toBe("aborted");
    expect(interaction.status?.code ?? 0).toBe(0);
    expect(JSON.stringify(exports)).not.toContain("private-abort-content");
  } finally {
    session.dispose();
    modelServer.server.closeAllConnections();
  }
});

test("manual compaction dispatches idle provider headers and exports its dispatch span", async () => {
  const wire: WireRequest[] = [];
  const modelServer = await listen(async (request, response) => {
    wire.push({ headers: request.headers, body: JSON.parse(await bodyOf(request)) });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse("summary or short answer"));
  });
  const exports: any[] = [];
  const receiver = await listen(async (request, response) => {
    exports.push(JSON.parse(await bodyOf(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const agentDir = await createAgentDir(receiver.url);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-telemetry-cwd-"));
  tempDirs.push(cwd);
  const { session } = await makeSession(agentDir, cwd, modelServer.url, undefined, {
    enabled: true,
    reserveTokens: 1,
    keepRecentTokens: 1,
  });
  const sessionId = session.sessionManager.getSessionId();
  try {
    await session.prompt("first turn: preserve this in the session");
    await session.prompt("second turn: add more history before compaction");
    await session.prompt("third turn: ensure the manual compaction has old messages to summarize");
    expect(wire).toHaveLength(3);

    const result = await session.compact();
    expect(result.summary.length).toBeGreaterThan(0);
    expect(wire.length).toBeGreaterThan(3);
    const compactionRequests = wire.slice(3).filter((request) => typeof request.headers.traceparent === "string");
    expect(compactionRequests.length).toBeGreaterThan(0);
    expect(compactionRequests.every((request) => request.headers.baggage?.includes(`session.id=${sessionId}`))).toBe(true);
    expect(compactionRequests.every((request) => request.headers.baggage?.includes(`gen_ai.conversation.id=${sessionId}`))).toBe(true);

    await eventually(() => exports, (items) => otlpSpans(items).some((span) => span.name === "pi.provider_dispatch"), "Manual compaction did not export an idle provider-dispatch span");
    const spans = otlpSpans(exports);
    const requestTraceparents = new Set(compactionRequests.map((request) => request.headers.traceparent!.toString()));
    const dispatch = spans.find((span) => span.name === "pi.provider_dispatch" && requestTraceparents.has(`00-${span.traceId}-${span.spanId}-01`));
    expect(dispatch).toBeDefined();
    expect(attr(dispatch!, "session.id")?.stringValue).toBe(sessionId);
  } finally {
    session.dispose();
  }
});

test("SDK provider hooks run for session prompts, while direct model-registry calls remain outside them", async () => {
  const wire: WireRequest[] = [];
  const modelServer = await listen(async (request, response) => {
    wire.push({ headers: request.headers, body: JSON.parse(await bodyOf(request)) });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse("short answer"));
  });
  const exports: any[] = [];
  const receiver = await listen(async (request, response) => {
    exports.push(JSON.parse(await bodyOf(request)));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const agentDir = await createAgentDir(receiver.url);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-telemetry-cwd-"));
  tempDirs.push(cwd);
  let directRegistry: any;
  const { session } = await makeSession(agentDir, cwd, modelServer.url, (registry) => { directRegistry = registry; });
  try {
    await session.prompt("one safe prompt");
    await session.prompt("a second safe prompt");
    expect(wire.length).toBeGreaterThanOrEqual(2);
    expect(typeof wire[1].headers.traceparent).toBe("string");
    expect(wire[1].headers["x-litellm-session-id"]).toBeUndefined();
    expect(wire[1].headers["x-session-id"]).toBeUndefined();

    const direct = await directRegistry.streamSimple(session.model, { messages: [] } as any);
    for await (const _event of direct) { /* consume the independent direct call */ }
    expect(wire).toHaveLength(3);
    expect(wire[2].headers.traceparent).toBeUndefined();

    await eventually(() => exports, (items) => items.length > 0, "No OTLP dispatch span received");
    const spans = otlpSpans(exports);
    expect(spans.filter((span) => span.name === "invoke_agent pi").length).toBeGreaterThanOrEqual(1);
    // Direct registry streams are a verified negative: they bypass SDK request hooks.
    expect(spans.every((span) => attr(span, "session.id")?.stringValue === session.sessionManager.getSessionId())).toBe(true);
  } finally {
    session.dispose();
  }
});
