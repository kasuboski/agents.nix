import assert from "node:assert/strict";
import { it } from "node:test";
import { registerBackgroundTerminals } from "./index.ts";
import { TerminalManager } from "./manager.ts";

function setup() {
  const handlers = new Map<string, Function>();
  const tools: any[] = [];
  const commands: any[] = [];
  const followUps: any[] = [];
  const pi: any = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (...args: any[]) => commands.push(args),
    on: (name: string, fn: Function) => handlers.set(name, fn),
    sendUserMessage: (...args: any[]) => followUps.push(args),
    sendMessage: (...args: any[]) => followUps.push(args),
  };
  const manager = new TerminalManager();
  registerBackgroundTerminals(pi, manager);
  return { handlers, tools, commands, followUps, manager };
}

const context = (id = "s1") => ({
  cwd: process.cwd(),
  sessionManager: { getSessionId: () => id },
  ui: { notify() {} },
  isIdle: () => false,
});

it("registers tools and shuts down processes at session end", async () => {
  const { handlers, tools, commands, manager } = setup();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "background_terminal_start",
    "background_terminal_status",
    "background_terminal_logs",
    "background_terminal_list",
    "background_terminal_kill",
  ]);
  assert.equal(commands[0][0], "ps");
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  await tools[0].execute("call", { command: "sleep 30" }, undefined, undefined, ctx);
  assert.equal(manager.runningCount(), 1);
  await handlers.get("session_shutdown")!({}, ctx);
  assert.equal(manager.runningCount(), 0);
});

const boundary = () => ({ entries: [], outcome: "completed", context: { canContinue: true } });

it("batches unread completions at settlement without queued follow-ups", async () => {
  const { handlers, followUps, manager } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const first = manager.start("printf one", process.cwd());
  const second = manager.start("printf two", process.cwd());
  await Promise.all([manager.wait(first.id), manager.wait(second.id)]);
  assert.equal(followUps.length, 0);
  const result = handlers.get("agent_before_settle")!(boundary(), ctx);
  assert.equal(result.continue, true);
  assert.equal(result.entries.length, 1);
  assert.ok(result.entries[0].content.includes(first.id));
  assert.ok(result.entries[0].content.includes(second.id));
  assert.equal(handlers.get("agent_before_settle")!(boundary(), ctx), undefined);
  await handlers.get("session_shutdown")!({}, ctx);
});

it("acknowledges completed status but not running polls or log reads", async () => {
  const { handlers, tools, manager } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const read = manager.start("printf read", process.cwd());
  await manager.wait(read.id);
  await tools[1].execute("call", { id: read.id });
  const unread = manager.start("sleep 0.05; printf unread", process.cwd());
  await tools[1].execute("call", { id: unread.id });
  await manager.wait(unread.id);
  await tools[2].execute("call", { id: unread.id });
  const result = handlers.get("agent_before_settle")!(boundary(), ctx);
  assert.ok(!result.entries[0].content.includes(read.id));
  assert.ok(result.entries[0].content.includes(unread.id));
  await handlers.get("session_shutdown")!({}, ctx);
});

it("suppresses completion even when status was read before the close event", async () => {
  const { handlers, tools, manager } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const terminal = manager.start("printf done", process.cwd());
  const snapshot = { ...terminal, status: "exited", exitCode: 0 };
  const originalGet = manager.get.bind(manager);
  manager.get = () => snapshot as any;
  await tools[1].execute("call", { id: terminal.id });
  manager.get = originalGet;
  await manager.wait(terminal.id);
  assert.equal(handlers.get("agent_before_settle")!(boundary(), ctx), undefined);
  await handlers.get("session_shutdown")!({}, ctx);
});

it("wait mode returns final output and aborting a start kills the child", async () => {
  const { handlers, tools, manager, followUps } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const waited = await tools[0].execute("call", { command: "printf ready", wait: true }, undefined, undefined, ctx);
  assert.equal(waited.details.stdout, "ready");

  const controller = new AbortController();
  const pending = tools[0].execute("call", { command: "sleep 30", wait: true }, controller.signal, undefined, ctx);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  const result = await pending;
  assert.equal(result.details.status, "killed");
  assert.equal(manager.runningCount(), 0);
  assert.equal(followUps.length, 0);
  assert.equal(handlers.get("agent_before_settle")!(boundary(), ctx), undefined);
  await handlers.get("session_shutdown")!({}, ctx);
});

it("idle delivery rechecks acknowledgement and batches unread completions", async () => {
  const { handlers, tools, manager, followUps } = setup();
  const ctx = { ...context(), isIdle: () => true };
  await handlers.get("session_start")!({}, ctx);
  const read = manager.start("printf read", process.cwd());
  await manager.wait(read.id);
  await tools[1].execute("call", { id: read.id });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(followUps.length, 0);
  const unread = manager.start("printf unread", process.cwd());
  await manager.wait(unread.id);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(followUps.length, 1);
  assert.ok(followUps[0][0].content.includes(unread.id));
  assert.deepEqual(followUps[0][1], { triggerTurn: true });
  await handlers.get("session_shutdown")!({}, ctx);
});

it("aborted runs do not continue and settlement records late notices without restarting", async () => {
  const { handlers, manager, followUps } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const terminal = manager.start("printf done", process.cwd());
  await manager.wait(terminal.id);
  assert.equal(handlers.get("agent_before_settle")!({ ...boundary(), outcome: "aborted" }, ctx), undefined);
  handlers.get("agent_settled")!({}, ctx);
  assert.equal(followUps.length, 1);
  assert.deepEqual(followUps[0][1], { triggerTurn: false });
  await handlers.get("session_shutdown")!({}, ctx);
});

it("shutdown discards pending notifications", async () => {
  const { handlers, manager, followUps } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const terminal = manager.start("printf done", process.cwd());
  await manager.wait(terminal.id);
  await handlers.get("session_shutdown")!({}, ctx);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(followUps.length, 0);
  assert.equal(handlers.get("agent_before_settle")!(boundary(), ctx), undefined);
});

it("logs tool exposes full output and status points to it", async () => {
  const { handlers, tools, manager } = setup();
  const ctx = context();
  await handlers.get("session_start")!({}, ctx);
  const terminal = manager.start("printf complete", process.cwd());
  await manager.wait(terminal.id);
  const status = await tools[1].execute("call", { id: terminal.id });
  assert.ok(status.content[0].text.includes(`background_terminal_logs id=${terminal.id}`));
  const logs = await tools[2].execute("call", { id: terminal.id, stream: "stdout" });
  assert.equal(logs.content[0].text, "complete");
});
