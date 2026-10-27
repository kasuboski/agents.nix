import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TerminalManager, MAX_OUTPUT, MAX_RUNNING } from "./manager.ts";

const nodeCommand = (source: string) => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;

describe("TerminalManager", () => {
  it("captures output and exit status", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start("printf hello; printf problem >&2", process.cwd());
    try {
      await manager.wait(terminal.id);
      assert.equal(manager.get(terminal.id)?.stdout, "hello");
      assert.equal(manager.get(terminal.id)?.stderr, "problem");
      assert.equal(manager.get(terminal.id)?.status, "exited");
    } finally {
      await manager.dispose();
    }
  });

  it("bounds combined captured output and flags truncation", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start(nodeCommand(`process.stdout.write('x'.repeat(${MAX_OUTPUT + 100}))`), process.cwd());
    try {
      await manager.wait(terminal.id);
      const result = manager.get(terminal.id)!;
      assert.equal(result.stdout.length, MAX_OUTPUT);
      assert.equal(result.truncated, true);
    } finally {
      await manager.dispose();
    }
  });

  it("kills a running process tree and resolves only after completion", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start("sleep 30", process.cwd());
    try {
      assert.equal(await manager.kill(terminal.id), true);
      assert.equal((await manager.wait(terminal.id)).status, "killed");
      assert.equal(manager.get(terminal.id)?.status, "killed");
    } finally {
      await manager.dispose();
    }
  });

  it("reads complete spill logs while the command is still running", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start(nodeCommand(`process.stdout.write('live output'); setTimeout(() => {}, 30000)`), process.cwd());
    let unsubscribe = () => {};
    try {
      await new Promise<void>((resolve) => {
        unsubscribe = manager.subscribe(event => {
          if (event.type === "output" && event.id === terminal.id) resolve();
        });
      });
      assert.equal(manager.get(terminal.id)?.status, "running");
      assert.equal(await manager.readLogs(terminal.id, "stdout"), "live output");
    } finally {
      unsubscribe();
      await manager.dispose();
    }
  });

  it("counts exited-but-not-closed terminals against the running limit", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start("trap '' TERM; sleep 30 &", process.cwd());
    let unsubscribe = () => {};
    try {
      await new Promise<void>((resolve) => {
        unsubscribe = manager.subscribe(event => {
          if (event.type === "status" && event.terminal.id === terminal.id && event.terminal.status === "exited") resolve();
        });
      });
      assert.equal(manager.get(terminal.id)?.status, "exited");
      assert.equal(manager.runningCount(), 1);

      for (let i = 1; i < MAX_RUNNING; i++) manager.start("sleep 30", process.cwd());
      assert.equal(manager.runningCount(), MAX_RUNNING);
      assert.throws(() => manager.start("true", process.cwd()), /Maximum 8 running terminals reached/);
    } finally {
      unsubscribe();
      await manager.dispose();
    }
  });

  it("keeps exited-but-not-closed process trees eligible for shutdown cleanup", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start("trap '' TERM; sleep 30 &", process.cwd());
    let unsubscribe = () => {};
    try {
      await new Promise<void>((resolve) => {
        unsubscribe = manager.subscribe(event => {
          if (event.type === "status" && event.terminal.id === terminal.id && event.terminal.status === "exited") resolve();
        });
      });
      assert.equal(manager.get(terminal.id)?.status, "exited");
      await manager.shutdown();
      assert.equal(manager.get(terminal.id)?.status, "killed");
      await manager.wait(terminal.id);
    } finally {
      unsubscribe();
      await manager.dispose();
    }
  });

  it("keeps complete private logs while bounding captured output", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start(nodeCommand(`process.stdout.write('x'.repeat(${MAX_OUTPUT + 100}))`), process.cwd());
    try {
      const completed = await manager.wait(terminal.id);
      assert.equal(completed.stdout.length, MAX_OUTPUT);
      assert.equal(completed.truncated, true);
      const logs = await manager.readLogs(terminal.id, "stdout") as string;
      assert.equal(logs.length, MAX_OUTPUT + 100);
    } finally {
      await manager.dispose();
    }
  });

  it("publishes output and completion status events", async () => {
    const manager = new TerminalManager();
    const events: string[] = [];
    const unsubscribe = manager.subscribe((event) => events.push(event.type));
    const terminal = manager.start("printf hello", process.cwd());
    try {
      assert.equal((await manager.wait(terminal.id)).stdout, "hello");
      assert.ok(events.includes("started"));
      assert.ok(events.includes("output"));
      assert.ok(events.includes("status"));
      assert.ok(events.includes("completed"));
    } finally {
      unsubscribe();
      await manager.dispose();
    }
  });

  it("handles kill racing with natural process exit", async () => {
    const manager = new TerminalManager();
    const terminal = manager.start("true", process.cwd());
    try {
      await manager.wait(terminal.id);
      assert.equal(await manager.kill(terminal.id), false);
      assert.equal(manager.get(terminal.id)?.status, "exited");
    } finally {
      await manager.dispose();
    }
  });
});
