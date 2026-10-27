// Run via collector.integration.sh, NOT the automated node:test suite. Only the model endpoint is a fixture.
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const [endpoint, evidenceFile, reportFile] = process.argv.slice(2);
assert(endpoint && evidenceFile && reportFile, "Use collector.integration.sh");
// Prevent inherited destinations, auth, sampling, or user configuration from affecting this run.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("OTEL_") || key.startsWith("PI_OTEL_") || key === "PI_CODING_AGENT_DIR") delete process.env[key];
}
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-real-collector-sdk-"));
const requests: http.IncomingHttpHeaders[] = [];
const promptCanary = "SYNTHETIC_PROMPT_NOT_FOR_TELEMETRY";
const resultCanary = "SYNTHETIC_TOOL_RESULT_NOT_FOR_TELEMETRY";
const argCanary = "SYNTHETIC_TOOL_ARGUMENT_NOT_FOR_TELEMETRY";
const modelKey = "synthetic-model-only-key";
const modelName = "gpt-4o-mini";
let requestCount = 0;

function sse(tool: boolean): string {
  const delta = tool ? { tool_calls: [{ index: 0, id: "outer-call", type: "function", function: { name: "outer", arguments: JSON.stringify({ canary: argCanary }) } }] } : { content: "SYNTHETIC_ASSISTANT_NOT_FOR_TELEMETRY" };
  return [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
  ].map((chunk) => `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: modelName, ...chunk })}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n";
}
const server = http.createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume but never save prompt bodies */ }
  requests.push(request.headers);
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(sse(requestCount++ % 2 === 0));
});

async function readEvidence(): Promise<any[]> {
  try {
    return (await fs.readFile(evidenceFile, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error: any) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}
function spansOf(payloads: any[]): any[] {
  return payloads.flatMap((p) => (p.resourceSpans ?? []).flatMap((r: any) => (r.scopeSpans ?? []).flatMap((s: any) => s.spans ?? [])));
}
function attrs(attributes: any[] = []): Record<string, any> {
  return Object.fromEntries(attributes.map((a) => [a.key, a.value.stringValue ?? a.value.boolValue ?? a.value.intValue]));
}
async function eventually(check: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(description);
}

async function runSession(protocol?: string) {
  let outerCalls = 0;
  let innerCalls = 0;
  const agentDir = path.join(tmp, protocol ? "unsupported" : "enabled");
  const cwd = path.join(agentDir, "workspace");
  await fs.mkdir(path.join(agentDir, "extensions"), { recursive: true });
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(agentDir, "extensions/telemetry.json"), JSON.stringify({ endpoint, serviceName: "pi-real-collector-test", sampleRatio: 1, shutdownTimeoutMs: 3000, ...(protocol ? { protocol } : {}) }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const address = server.address();
  assert(address && typeof address !== "string");
  runtime.registerProvider("openai", { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: modelKey });
  const base = runtime.getModel("openai", modelName);
  assert(base);
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [path.resolve(currentDir, "../index.ts")] });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model: { ...base, api: "openai-completions" }, thinkingLevel: "off", resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd), sessionStartEvent: { type: "session_start", reason: "startup" },
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    customTools: [
      { name: "outer", label: "Outer", description: "Synthetic nested tool", parameters: Type.Object({ canary: Type.String() }), execute: async (_id, _args, _signal, _update, ctx) => {
        outerCalls++;
        await ctx.executeTool("inner", {});
        return { content: [{ type: "text", text: resultCanary }], details: {} };
      } },
      { name: "inner", label: "Inner", description: "Synthetic tool", parameters: Type.Object({}), execute: async () => {
        innerCalls++;
        return { content: [{ type: "text", text: resultCanary }], details: {} };
      } },
    ],
  });
  try {
    await session.bindExtensions({});
    session.setActiveToolsByName(["outer", "inner"]);
    await session.prompt(promptCanary);
    assert.equal(outerCalls, 1, "SDK must execute outer tool once");
    assert.equal(innerCalls, 1, "SDK must execute nested inner tool once");
    return session.sessionManager.getSessionId();
  } finally {
    session.dispose();
  }
}

try {
  await eventually(async () => {
    try {
      // GET cannot emit spans; 405 proves the receiver is listening, not export success.
      return (await fetch(endpoint, { signal: AbortSignal.timeout(500) })).status === 405;
    } catch { return false; }
  }, "Collector OTLP HTTP receiver did not become ready");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sessionId = await runSession();
  assert.equal(requests.length, 2);
  await eventually(async () => spansOf(await readEvidence()).length >= 3, "Real Collector file exporter did not write SDK spans");
  await new Promise((resolve) => setTimeout(resolve, 1500)); // also catch duplicates from scheduled batch export
  const payloads = await readEvidence();
  const spans = spansOf(payloads);
  assert.equal(spans.length, 3, "Expected exactly one interaction plus two nested tool spans");
  const interaction = spans.find((s) => s.name === "pi.interaction");
  const outer = spans.find((s) => attrs(s.attributes)["pi.tool.name"] === "outer");
  const inner = spans.find((s) => attrs(s.attributes)["pi.tool.name"] === "inner");
  assert(interaction && outer && inner);
  assert(!interaction.parentSpanId);
  assert.equal(outer.parentSpanId, interaction.spanId);
  assert.equal(inner.parentSpanId, outer.spanId);
  assert.equal(new Set(spans.map((s) => s.spanId)).size, 3);
  for (const span of spans) {
    assert.match(span.traceId, /^[0-9a-f]{32}$/i);
    assert.match(span.spanId, /^[0-9a-f]{16}$/i);
    assert.equal(span.traceId, interaction.traceId);
    assert.equal(attrs(span.attributes)["session.id"], sessionId);
    assert.equal(span.kind, 1); // INTERNAL
    assert(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
    assert.equal(span.events?.length ?? 0, 0);
    assert.equal(span.links?.length ?? 0, 0);
    assert.equal(span.status?.message ?? "", "");
    for (const key of Object.keys(attrs(span.attributes))) assert(["session.id", "pi.tool.name", "pi.tool.call_id", "pi.outcome", "pi.incomplete"].includes(key), `Unexpected span attribute ${key}`);
  }
  assert.equal(attrs(interaction.attributes)["pi.outcome"], "completed");
  assert.equal(interaction.status?.code, 1);
  for (const request of requests) {
    assert.equal(request.traceparent, `00-${interaction.traceId}-${interaction.spanId}-01`);
    assert.equal(request.baggage, `session.id=${sessionId},gen_ai.conversation.id=${sessionId}`);
    assert.equal(request.authorization, `Bearer ${modelKey}`);
  }
  for (const payload of payloads) for (const resource of payload.resourceSpans) {
    assert.deepEqual(attrs(resource.resource.attributes), { "service.name": "pi-real-collector-test" });
    for (const scope of resource.scopeSpans) assert.deepEqual(scope.scope, { name: "pi-telemetry", version: "1.0.0" });
  }
  const serialized = JSON.stringify(payloads);
  for (const forbidden of [promptCanary, resultCanary, argCanary, modelKey, modelName, tmp, "SYNTHETIC_ASSISTANT_NOT_FOR_TELEMETRY", "gen_ai.", "host.name", "process.", "exception", "http."]) assert(!serialized.includes(forbidden), `Privacy check failed: ${forbidden}`);
  const disabledSessionId = await runSession("grpc");
  assert.equal(requests.length, 4);
  for (const request of requests.slice(2)) {
    assert.equal(request.traceparent, undefined);
    assert.equal(request.baggage, undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(spansOf(await readEvidence()).length, 3, "Unsupported protocol must not export to Collector");
  const report = { collector: "otelcol-contrib 0.123.0", sdk: "1.0.2", node: process.version, auth: "none on OTLP receiver", sessionId, disabledSessionId, modelRequests: requests.length, spanCount: spans.length, spans: spans.map((s) => ({ name: s.name, traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? null, attributes: attrs(s.attributes) })), checks: ["file exporter decoded OTLP HTTP JSON", "exact counts and unique span IDs", "nested parent IDs", "provider traceparent and both baggage identities", "session attributes", "resource/scope allowlist", "content/credential/path/model privacy canaries", "grpc disabled without impacting SDK tools"] };
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.PI_CODING_AGENT_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
}
