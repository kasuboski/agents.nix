import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentExtension, { type AgentResult, updateAgentResult } from "./index.ts";
import lifecycleExtension, { hasAgentSettled } from "./lifecycle.ts";
import { BackgroundRegistry } from "./registry.ts";

const originalSettledFile = process.env.PI_AGENT_SETTLED_FILE;
const originalSettledSessionId = process.env.PI_AGENT_SETTLED_SESSION_ID;
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalSettledFile === undefined) delete process.env.PI_AGENT_SETTLED_FILE;
  else process.env.PI_AGENT_SETTLED_FILE = originalSettledFile;

  if (originalSettledSessionId === undefined) delete process.env.PI_AGENT_SETTLED_SESSION_ID;
  else process.env.PI_AGENT_SETTLED_SESSION_ID = originalSettledSessionId;

  await Promise.all(tempDirs.splice(0).map((dir) =>
    fs.promises.rm(dir, { recursive: true, force: true }),
  ));
});

it("exposes spawn and controls through the existing agent tool", async () => {
  const tools: any[] = [];
  const pi = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand() {},
    on() {},
  } as unknown as ExtensionAPI;
  agentExtension(pi);

  assert.deepEqual(tools.map((tool) => tool.name), ["agent"]);
  assert.ok(tools[0].parameters.properties.action);
  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => "session" },
  };
  const defaultAction = await tools[0].execute("call", {}, undefined, undefined, ctx);
  assert.equal(defaultAction.content[0].text, "spawn requires prompt");
  const result = await tools[0].execute("call", { action: "list" }, undefined, undefined, ctx);
  assert.equal(result.content[0].text, "No background agents.");
});

it("persists successful result delivery so session resume does not send it again", async () => {
  const registry = new BackgroundRegistry();
  const job = registry.create("session", "work")!;
  registry.settle(job.id, "completed");
  const initial = { type: "custom", customType: "agent_jobs", data: { jobs: registry.snapshot("session") } };
  const entries: any[] = [];
  const sent: string[] = [];
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const commands = new Map<string, any>();
  const createPi = () => ({
    on(event: string, handler: (...args: any[]) => Promise<void>) { handlers.set(event, handler); },
    appendEntry(type: string, data: unknown) { entries.push({ type: "custom", customType: type, data }); },
    sendUserMessage(text: string) { sent.push(text); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerTool() {},
  } as unknown as ExtensionAPI);
  const makeContext = (branch: any[]) => ({
    isIdle: () => true,
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => "session", getBranch: () => branch },
  });

  agentExtension(createPi());
  await handlers.get("session_start")?.({}, makeContext([initial]));
  assert.equal(sent.length, 1);
  assert.equal(entries.at(-1)?.data.jobs[0].delivered, true);

  const resumedHandlers = new Map<string, (...args: any[]) => Promise<void>>();
  const resumedEntries = [...entries];
  const resumedPi = {
    ...createPi(),
    on(event: string, handler: (...args: any[]) => Promise<void>) { resumedHandlers.set(event, handler); },
  } as unknown as ExtensionAPI;
  agentExtension(resumedPi);
  await resumedHandlers.get("session_start")?.({}, makeContext([initial, resumedEntries.at(-1)]));
  assert.equal(sent.length, 1);
});

it("restores jobs from only the latest full session snapshot", async () => {
  const registry = new BackgroundRegistry();
  const oldJob = registry.create("session", "old job")!;
  const oldSnapshot = registry.snapshot("session");
  const latestJob = registry.create("session", "latest job")!;
  const latestSnapshot = registry.snapshot("session").filter((record) => record.id === latestJob.id);
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const tools: any[] = [];
  const pi = {
    on(event: string, handler: (...args: any[]) => Promise<void>) { handlers.set(event, handler); },
    registerCommand() {},
    registerTool(tool: any) { tools.push(tool); },
  } as unknown as ExtensionAPI;
  agentExtension(pi);
  const ctx = {
    isIdle: () => false,
    cwd: process.cwd(),
    sessionManager: {
      getSessionId: () => "session",
      getBranch: () => [
        { type: "custom", customType: "agent_jobs", data: { jobs: oldSnapshot } },
        { type: "custom", customType: "agent_jobs", data: { jobs: latestSnapshot } },
      ],
    },
  };

  await handlers.get("session_start")?.({}, ctx);
  const listed = await tools[0].execute("call", { action: "list" }, undefined, undefined, ctx);
  assert.match(listed.content[0].text, new RegExp(latestJob.id));
  assert.doesNotMatch(listed.content[0].text, new RegExp(oldJob.id));
});

it("clears a transient model error after a successful retry", () => {
  const result: AgentResult = {
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  };

  updateAgentResult(result, {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "503 service unavailable",
  } as any);
  updateAgentResult(result, {
    role: "assistant",
    content: [{ type: "text", text: "retried successfully" }],
    stopReason: "stop",
  } as any);

  assert.equal(result.stopReason, "stop");
  assert.equal(result.errorMessage, undefined);
  assert.equal(result.messages.length, 2);
});

it("signals the herdr parent only when its direct child fully settles", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-agent-test-"));
  tempDirs.push(tempDir);
  const settledFile = path.join(tempDir, "agent-settled");
  process.env.PI_AGENT_SETTLED_FILE = settledFile;
  process.env.PI_AGENT_SETTLED_SESSION_ID = "direct-child";

  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const pi = {
    on(event: string, handler: (...args: any[]) => Promise<void>) {
      handlers.set(event, handler);
    },
    registerTool() {},
  } as unknown as ExtensionAPI;

  lifecycleExtension(pi);

  assert.equal(await hasAgentSettled(settledFile), false);
  const onSettled = handlers.get("agent_settled");
  assert.ok(onSettled);

  await onSettled?.({}, { sessionManager: { getSessionId: () => "nested-child" } });
  assert.equal(await hasAgentSettled(settledFile), false);

  await onSettled?.({}, { sessionManager: { getSessionId: () => "direct-child" } });
  assert.equal(await hasAgentSettled(settledFile), true);
  assert.equal(await fs.promises.readFile(settledFile, "utf8"), "settled\n");
});
