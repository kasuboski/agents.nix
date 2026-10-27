import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_RUNNING = 8;
export const MAX_TRACKED = 32;
export const MAX_OUTPUT = 256 * 1024;
export const MAX_LOG_BYTES_PER_STREAM = 256 * 1024 * 1024;
export const KILL_GRACE_MS = 500;

export type Terminal = {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  status: "running" | "exited" | "killed";
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logsTruncated: boolean;
  startedAt: number;
};
export type TerminalEvent =
  | { type: "started"; terminal: Terminal }
  | { type: "output"; id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "status"; terminal: Terminal }
  | { type: "completed"; terminal: Terminal };
export type LogStream = "stdout" | "stderr";

type Entry = {
  terminal: Terminal;
  child: ChildProcess;
  stdoutFd: number;
  stderrFd: number;
  completion: Promise<Terminal>;
  resolveCompletion: (terminal: Terminal) => void;
  killTimer?: ReturnType<typeof setTimeout>;
  killRequested: boolean;
  finalized: boolean;
  stdoutLogBytes: number;
  stderrLogBytes: number;
};

/** Tracks shell processes, bounded display captures, and private complete logs. */
export class TerminalManager {
  private entries = new Map<string, Entry>();
  private listeners = new Set<(event: TerminalEvent) => void>();
  private logDirectory = mkdtempSync(join(tmpdir(), "pi-background-terminals-"));
  private disposed = false;

  constructor() { mkdirSync(this.logDirectory, { recursive: true, mode: 0o700 }); }

  async beginSession(): Promise<void> {
    if (!this.disposed) return;
    this.logDirectory = mkdtempSync(join(tmpdir(), "pi-background-terminals-"));
    mkdirSync(this.logDirectory, { recursive: true, mode: 0o700 });
    this.disposed = false;
  }

  start(command: string, cwd: string): Terminal {
    if (this.disposed) throw new Error("Terminal manager has been disposed");
    if (this.runningCount() >= MAX_RUNNING) throw new Error(`Maximum ${MAX_RUNNING} running terminals reached`);
    while (this.entries.size >= MAX_TRACKED) {
      const oldestSettled = [...this.entries.entries()]
        .filter(([, entry]) => entry.finalized)
        .sort((a, b) => a[1].terminal.startedAt - b[1].terminal.startedAt)[0];
      if (!oldestSettled) throw new Error(`Maximum ${MAX_TRACKED} tracked terminals reached`);
      const [oldId] = oldestSettled;
      this.entries.delete(oldId);
      rmSync(join(this.logDirectory, `${oldId}.stdout.log`), { force: true });
      rmSync(join(this.logDirectory, `${oldId}.stderr.log`), { force: true });
    }

    const id = randomUUID().slice(0, 8);
    const stdoutFd = openSync(join(this.logDirectory, `${id}.stdout.log`), "wx", 0o600);
    let stderrFd: number;
    try { stderrFd = openSync(join(this.logDirectory, `${id}.stderr.log`), "wx", 0o600); }
    catch (error) { closeSync(stdoutFd); throw error; }

    let child: ChildProcess;
    try {
      child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    } catch (error) {
      closeSync(stdoutFd); closeSync(stderrFd);
      throw error;
    }

    let resolveCompletion!: (terminal: Terminal) => void;
    const completion = new Promise<Terminal>(resolve => { resolveCompletion = resolve; });
    const terminal: Terminal = {
      id, command, cwd, pid: child.pid, status: "running", stdout: "", stderr: "", truncated: false, logsTruncated: false, startedAt: Date.now(),
    };
    const entry: Entry = { terminal, child, stdoutFd, stderrFd, completion, resolveCompletion, killRequested: false, finalized: false, stdoutLogBytes: 0, stderrLogBytes: 0 };
    this.entries.set(id, entry);

    child.stdout?.setEncoding("utf8").on("data", (text: string) => this.append(entry, "stdout", text));
    child.stderr?.setEncoding("utf8").on("data", (text: string) => this.append(entry, "stderr", text));
    child.once("error", error => {
      terminal.exitCode = 1;
      this.append(entry, "stderr", `\n${error.message}`);
      this.setStatus(entry, entry.killRequested ? "killed" : "exited");
      this.finalize(entry);
    });
    child.once("exit", code => {
      terminal.exitCode = code;
      this.setStatus(entry, entry.killRequested ? "killed" : "exited");
    });
    child.once("close", code => {
      if (terminal.exitCode === undefined) terminal.exitCode = code;
      this.setStatus(entry, entry.killRequested ? "killed" : "exited");
      this.finalize(entry);
    });
    this.emit({ type: "started", terminal: this.snapshot(terminal) });
    return this.snapshot(terminal);
  }

  private append(entry: Entry, key: LogStream, text: string): void {
    const fd = key === "stdout" ? entry.stdoutFd : entry.stderrFd;
    const data = Buffer.from(text, "utf8");
    const written = key === "stdout" ? entry.stdoutLogBytes : entry.stderrLogBytes;
    const spillRoom = Math.max(0, MAX_LOG_BYTES_PER_STREAM - written);
    const spill = data.subarray(0, spillRoom);
    let offset = 0;
    while (offset < spill.length) offset += writeSync(fd, spill, offset, spill.length - offset);
    if (key === "stdout") entry.stdoutLogBytes += spill.length;
    else entry.stderrLogBytes += spill.length;
    if (spill.length < data.length) entry.terminal.logsTruncated = true;

    const terminal = entry.terminal;
    const room = Math.max(0, MAX_OUTPUT - Buffer.byteLength(terminal.stdout) - Buffer.byteLength(terminal.stderr));
    let kept = room > 0 ? data.subarray(0, room).toString("utf8") : "";
    while (Buffer.byteLength(kept) > room) kept = kept.slice(0, -1);
    if (kept) terminal[key] += kept;
    if (Buffer.byteLength(kept) < data.length) terminal.truncated = true;
    this.emit({ type: "output", id: terminal.id, stream: key, text });
  }

  private setStatus(entry: Entry, status: Terminal["status"]): void {
    if (entry.terminal.status === status) return;
    entry.terminal.status = status;
    this.emit({ type: "status", terminal: this.snapshot(entry.terminal) });
  }

  private finalize(entry: Entry): void {
    if (entry.finalized) return;
    entry.finalized = true;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    closeSync(entry.stdoutFd);
    closeSync(entry.stderrFd);
    const completed = this.snapshot(entry.terminal);
    entry.resolveCompletion(completed);
    this.emit({ type: "completed", terminal: completed });
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* One observer must not break process tracking. */ }
    }
  }

  private snapshot(terminal: Terminal): Terminal { return { ...terminal }; }
  runningCount(): number { return [...this.entries.values()].filter(e => !e.finalized).length; }
  list(): Terminal[] { return [...this.entries.values()].map(e => this.snapshot(e.terminal)); }
  get(id: string): Terminal | undefined { const terminal = this.entries.get(id)?.terminal; return terminal && this.snapshot(terminal); }

  subscribe(listener: (event: TerminalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Resolves after process close and all stdout/stderr data have been consumed. */
  wait(id: string): Promise<Terminal> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new Error(`Unknown terminal ${id}`));
    return entry.completion.then(terminal => this.snapshot(terminal));
  }
  awaitCompletion(id: string): Promise<Terminal> { return this.wait(id); }

  /** Reads complete logs from the manager's private temporary directory. */
  async readLogs(id: string, stream?: LogStream): Promise<{ stdout: string; stderr: string } | string> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown terminal ${id}`);
    const read = (key: LogStream) => readFileSync(join(this.logDirectory, `${id}.${key}.log`), "utf8");
    return stream ? read(stream) : { stdout: read("stdout"), stderr: read("stderr") };
  }

  async kill(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || entry.finalized) return false;
    entry.killRequested = true;
    this.sendSignal(entry, "SIGTERM");
    entry.killTimer = setTimeout(() => this.sendSignal(entry, "SIGKILL"), KILL_GRACE_MS);
    entry.killTimer.unref?.();
    await entry.completion;
    return true;
  }

  private sendSignal(entry: Entry, signal: NodeJS.Signals): void {
    if (entry.finalized) return;
    try {
      if (process.platform !== "win32" && entry.child.pid) process.kill(-entry.child.pid, signal);
      else if (process.platform === "win32" && entry.child.pid) {
        const args = ["/pid", String(entry.child.pid), "/t"];
        if (signal === "SIGKILL") args.push("/f");
        const killer = spawn("taskkill", args, { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => {
          try { entry.child.kill(signal); } catch { /* The process may have closed meanwhile. */ }
        });
        killer.unref();
      } else entry.child.kill(signal);
    } catch (error) {
      // ESRCH means the process exited in the race between status check and signal.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        try { entry.child.kill(signal); } catch { /* The process may have closed meanwhile. */ }
      }
    }
  }

  async killMany(ids: string[]): Promise<number> {
    const results = await Promise.all(ids.map(id => this.kill(id)));
    return results.filter(Boolean).length;
  }

  async shutdown(): Promise<void> {
    await this.killMany([...this.entries.values()].filter(entry => !entry.finalized).map(entry => entry.terminal.id));
  }

  /** Stops children and removes the private log directory. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.shutdown();
    this.disposed = true;
    rmSync(this.logDirectory, { recursive: true, force: true });
    this.entries.clear();
  }
}
