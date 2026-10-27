import assert from "node:assert/strict";
import { it } from "node:test";
import { TerminalManager } from "./manager.ts";
import { TerminalList } from "./tui.ts";

it("/ps is read-only by default and exposes detail streams, scrolling, and explicit kill", async () => {
  const manager = new TerminalManager();
  const terminal = manager.start("printf 'out\\n'; printf 'err\\n' >&2; sleep 30", process.cwd());
  const done: unknown[] = [];
  let renders = 0;
  const view = new TerminalList(manager, { fg: (_color: string, text: string) => text }, (value) => done.push(value), () => renders++);
  try {
    assert.ok(view.render(120).join("\n").includes(terminal.id));
    assert.equal(manager.get(terminal.id)?.status, "running");
    view.handleInput("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(view.render(120).join("\n").includes("stdout"));
    view.handleInput("\t");
    assert.ok(view.render(120).join("\n").includes("stderr"));
    view.handleInput("\u001b[6~");
    view.handleInput("k");
    await manager.wait(terminal.id);
    assert.equal(manager.get(terminal.id)?.status, "killed");
    assert.ok(renders > 0);
    view.handleInput("\u001b");
    assert.equal(done.length, 0);
    view.handleInput("q");
    assert.equal(done.length, 1);
  } finally {
    view.dispose();
    await manager.dispose();
  }
});
