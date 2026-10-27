import assert from "node:assert/strict";
import { it } from "node:test";
import { BackgroundRegistry } from "./registry.ts";

it("isolates owners and enforces running/tracked limits", () => {
  const registry = new BackgroundRegistry(1, 2);
  const job = registry.create("a", "one")!;
  assert.equal(registry.create("a", "two"), undefined);
  assert.equal(registry.get("b", job.id), undefined);
  registry.settle(job.id, "completed");
  assert.ok(registry.create("a", "two"));
  assert.equal(registry.list("b").length, 0);
});

it("does not prune a settled run directory when creation is rejected at the running limit", () => {
  const registry = new BackgroundRegistry(2, 3);
  const settled = registry.create("owner", "settled")!;
  registry.settle(settled.id, "completed");
  const running = registry.create("owner", "running")!;
  const secondRunning = registry.create("owner", "second running")!;
  settled.runDir = "/tmp/keep-this-run";

  assert.equal(registry.create("owner", "rejected"), undefined);
  assert.equal(registry.get("owner", settled.id)?.runDir, "/tmp/keep-this-run");
  assert.ok(registry.get("owner", running.id));
  assert.ok(registry.get("owner", secondRunning.id));
});

it("wait completion resolves and snapshots restore across restart", async () => {
  const registry = new BackgroundRegistry();
  const job = registry.create("owner", "do work")!;
  const waiting = job.completion;
  registry.settle(job.id, "completed");
  await waiting;
  const restarted = new BackgroundRegistry();
  restarted.restore("owner", registry.snapshot("owner"));
  assert.equal(restarted.get("owner", job.id)?.status, "completed");
});

it("prunes oldest settled jobs while retaining the running limit", () => {
  const registry = new BackgroundRegistry(8, 2);
  const first = registry.create("owner", "one")!;
  registry.settle(first.id, "completed");
  const second = registry.create("owner", "two")!;
  registry.settle(second.id, "failed");
  const third = registry.create("owner", "three")!;
  assert.equal(registry.get("owner", first.id), undefined);
  assert.deepEqual(registry.list("owner").map((job) => job.id), [second.id, third.id]);
});

it("restoring a full snapshot removes records absent from it without touching other owners", () => {
  const registry = new BackgroundRegistry();
  const removed = registry.create("owner", "will be pruned")!;
  const retained = registry.create("owner", "retained")!;
  const otherOwner = registry.create("other", "other owner")!;
  const snapshot = registry.snapshot("owner").filter((record) => record.id === retained.id);

  registry.restore("owner", snapshot);

  assert.equal(registry.get("owner", removed.id), undefined);
  assert.ok(registry.get("owner", retained.id));
  assert.ok(registry.get("other", otherOwner.id));
});

it("later persisted snapshots replace stale records and restart reuses session identity", () => {
  const registry = new BackgroundRegistry();
  const job = registry.create("owner", "initial task", "/tmp/project", {
    model: "aperture/gpt-6-luna",
    tools: ["read", "bash"],
  })!;
  job.runDir = "/tmp/agent-session";
  job.childSessionId = "child-session";
  const early = registry.snapshot("owner");
  registry.settle(job.id, "completed");
  const late = registry.snapshot("owner");
  const restored = new BackgroundRegistry();
  restored.restore("owner", early);
  restored.restore("owner", late);
  assert.equal(restored.get("owner", job.id)?.status, "completed");
  const restarted = restored.restart("owner", job.id, "continue work");
  assert.equal(restarted?.runDir, "/tmp/agent-session");
  assert.equal(restarted?.childSessionId, "child-session");
  assert.equal(restarted?.cwd, "/tmp/project");
  assert.deepEqual(restarted?.options, { model: "aperture/gpt-6-luna", tools: ["read", "bash"] });
  assert.equal(restarted?.status, "running");
});

it("consume is exactly once", () => {
  const registry = new BackgroundRegistry();
  const job = registry.create("owner", "work")!;
  assert.equal(registry.consume(job.id), true);
  assert.equal(registry.consume(job.id), false);
});

it("owner shutdown cancels running work", async () => {
  const registry = new BackgroundRegistry();
  const job = registry.create("owner", "work")!;
  const shuttingDown = registry.cancelOwner("owner");
  assert.equal(job.controller.signal.aborted, true);
  await shuttingDown;
  assert.equal(job.status, "cancelled");
});
