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
  };
  const manager = new TerminalManager();
  registerBackgroundTerminals(pi, manager);
  return { handlers, tools, commands, followUps, manager };
}

const context = (id = "s1") => ({
  cwd: process.cwd(),
  sessionManager: { getSessionId: () => id },
  ui: { notify() {} },
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

it("reports every completed terminal to the model exactly once as a follow-up", async () => {
  const { handlers, followUps, manager } = setup();
  await handlers.get("session_start")!({}, context());
  const first = manager.start("printf one", process.cwd());
  const second = manager.start("printf two", process.cwd());
  await Promise.all([manager.wait(first.id), manager.wait(second.id)]);
  assert.equal(followUps.length, 2);
  assert.ok(followUps.every((args) => args[1].deliverAs === "followUp"));
  assert.ok(followUps.some((args) => String(args[0]).includes(first.id)));
  assert.ok(followUps.some((args) => String(args[0]).includes(second.id)));
});

it("wait mode returns final output and aborting a start kills the child", async () => {
  const { handlers, tools, manager } = setup();
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
