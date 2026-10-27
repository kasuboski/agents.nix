import type { AgentResult } from "./index.ts";

export type BackgroundStatus = "running" | "completed" | "failed" | "cancelled";

export type BackgroundRunOptions = {
  systemPrompt?: string;
  appendSystemPrompt?: string;
  model?: string;
  thinking?: string;
  tools?: string[];
  excludeTools?: string[];
};

export type BackgroundJob = {
  id: string;
  sessionId: string;
  prompt: string;
  cwd: string;
  options: BackgroundRunOptions;
  controller: AbortController;
  status: BackgroundStatus;
  result?: AgentResult;
  consumed: boolean;
  delivered: boolean;
  startedAt: number;
  completion: Promise<void>;
  resolve: () => void;
  runner?: Promise<void>;
  runDir?: string;
  childSessionId?: string;
  tabId?: string;
  paneId?: string;
};

export type JobRecord = Omit<BackgroundJob, "controller" | "completion" | "resolve" | "runner">;

function deferred() {
  let resolve!: () => void;
  const completion = new Promise<void>((done) => { resolve = done; });
  return { completion, resolve };
}

export class BackgroundRegistry {
  private jobs = new Map<string, BackgroundJob>();
  private readonly maxRunning: number;
  private readonly maxTracked: number;

  constructor(maxRunning = 8, maxTracked = 64) {
    this.maxRunning = maxRunning;
    this.maxTracked = maxTracked;
  }

  list(owner: string): BackgroundJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.sessionId === owner)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  get(owner: string, id: string): BackgroundJob | undefined {
    const job = this.jobs.get(id);
    return job?.sessionId === owner ? job : undefined;
  }

  create(
    owner: string,
    prompt: string,
    cwd = process.cwd(),
    options: BackgroundRunOptions = {},
  ): BackgroundJob | undefined {
    const jobs = this.list(owner);
    if (jobs.filter((job) => job.status === "running").length >= this.maxRunning) return;
    while (jobs.length >= this.maxTracked) {
      const oldestSettled = jobs.find((job) => job.status !== "running");
      if (!oldestSettled) return;
      this.jobs.delete(oldestSettled.id);
      jobs.splice(jobs.indexOf(oldestSettled), 1);
    }
    const pending = deferred();
    const job: BackgroundJob = {
      id: `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: owner,
      prompt,
      cwd,
      options,
      controller: new AbortController(),
      status: "running",
      consumed: false,
      delivered: false,
      startedAt: Date.now(),
      ...pending,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  restart(
    owner: string,
    id: string,
    prompt: string,
    options: BackgroundRunOptions = {},
  ): BackgroundJob | undefined {
    const job = this.get(owner, id);
    if (!job || job.status === "running") return;
    if (this.list(owner).filter((entry) => entry.status === "running").length >= this.maxRunning) return;
    if (!job.runDir || !job.childSessionId) return;
    const pending = deferred();
    job.prompt = prompt;
    job.options = { ...job.options, ...options };
    job.controller = new AbortController();
    job.status = "running";
    job.result = undefined;
    job.consumed = false;
    job.delivered = false;
    job.startedAt = Date.now();
    job.runner = undefined;
    job.completion = pending.completion;
    job.resolve = pending.resolve;
    job.tabId = undefined;
    job.paneId = undefined;
    return job;
  }

  settle(id: string, status: BackgroundStatus, result?: AgentResult): void {
    const job = this.jobs.get(id);
    if (!job || job.status !== "running") return;
    job.status = status;
    job.result = result;
    job.resolve();
  }

  consume(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.consumed) return false;
    job.consumed = true;
    return true;
  }

  claimDelivery(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.consumed || job.delivered) return false;
    job.delivered = true;
    return true;
  }

  releaseDelivery(id: string): void {
    const job = this.jobs.get(id);
    if (job && !job.consumed) job.delivered = false;
  }

  async cancel(job: BackgroundJob, cleanup?: () => Promise<void>): Promise<void> {
    if (job.status !== "running") return;
    job.controller.abort();
    await cleanup?.();
    await job.runner;
    this.settle(job.id, "cancelled");
  }

  async cancelOwner(owner: string): Promise<void> {
    const running = this.list(owner).filter((job) => job.status === "running");
    for (const job of running) job.consumed = true;
    await Promise.all(running.map((job) => this.cancel(job)));
  }

  snapshot(owner: string): JobRecord[] {
    return this.list(owner).map(({ controller, completion, resolve, runner, ...record }) => ({
      ...record,
      status: record.status === "running" ? "failed" : record.status,
    }));
  }

  restore(owner: string, records: JobRecord[]): void {
    for (const job of this.list(owner)) this.jobs.delete(job.id);
    for (const record of records) {
      const current = this.jobs.get(record.id);
      if (current && current.sessionId !== owner) continue;
      const pending = deferred();
      const job: BackgroundJob = {
        ...record,
        options: record.options ?? {},
        sessionId: owner,
        controller: new AbortController(),
        status: record.status === "running" ? "failed" : record.status,
        ...pending,
      };
      this.jobs.set(job.id, job);
      job.resolve();
    }
  }
}
