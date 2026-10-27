import type { TerminalManager, Terminal } from "./manager.ts";

type Stream = "stdout" | "stderr";

/** Read-only process/log inspector; only the explicit kill key mutates a process. */
export class TerminalList {
  private selected = 0;
  private offset = 0;
  private stream: Stream = "stdout";
  private detail = false;
  private logs: { stdout: string; stderr: string } | undefined;
  private unsubscribe: () => void;
  private manager: TerminalManager;
  private theme: any;
  private done: (value: void) => void;
  private onUpdate: () => void;

  constructor(
    manager: TerminalManager,
    theme: any,
    done: (value: void) => void,
    onUpdate: () => void = () => {},
  ) {
    this.manager = manager;
    this.theme = theme;
    this.done = done;
    this.onUpdate = onUpdate;
    this.unsubscribe = manager.subscribe(event => {
      if (event.type === "output" || event.type === "status" || event.type === "started" || event.type === "completed") {
        if (event.type === "completed" && this.detail && event.terminal.id === this.currentId()) void this.loadLogs();
        this.onUpdate();
      }
    });
  }

  dispose(): void { this.unsubscribe(); }
  invalidate(): void {}

  render(width: number): string[] {
    const items = this.manager.list();
    this.selected = items.length ? Math.min(this.selected, items.length - 1) : 0;
    const current = items[this.selected];
    const lines = [this.theme.fg("accent", this.detail
      ? "Background terminal details  Tab stdout/stderr  PgUp/PgDn scroll  k kill  Esc back"
      : "Background terminals  ↑/↓ select  Enter details  k kill  q close")];
    if (!items.length) lines.push("No tracked terminals.");
    else if (this.detail && current) {
      lines.push(`${current.id} ${current.status} pid=${current.pid ?? "?"} exit=${current.exitCode ?? "running"}`);
      lines.push(`$ ${current.command}`);
      lines.push(`Complete logs: background_terminal_logs id=${current.id}`);
      const content = this.logs?.[this.stream] ?? current[this.stream];
      const output = content.split("\n");
      const available = Math.max(1, 12);
      const maxOffset = Math.max(0, output.length - available);
      this.offset = Math.min(this.offset, maxOffset);
      lines.push(`--- ${this.stream}${current.truncated && !this.logs ? " (captured output; full log loading)" : ""} ---`);
      lines.push(...output.slice(this.offset, this.offset + available));
      if (!this.logs && current.truncated) lines.push("Full logs are available through background_terminal_logs.");
    } else {
      for (const [i, t] of items.entries()) lines.push(`${i === this.selected ? ">" : " "} ${t.id} ${t.status} pid=${t.pid ?? "?"} ${t.command}`);
      lines.push("Select a terminal and press Enter for stdout/stderr details.");
    }
    return lines.map(line => line.slice(0, Math.max(1, width)));
  }

  handleInput(data: string): void {
    const list: Terminal[] = this.manager.list();
    if (data === "q" || data === "\u001b") {
      if (this.detail) { this.detail = false; this.logs = undefined; this.onUpdate(); }
      else this.done();
      return;
    }
    if (!this.detail && data === "\r") {
      const current = list[this.selected];
      if (current) { this.detail = true; this.offset = 0; this.logs = undefined; void this.loadLogs(); }
    } else if (!this.detail && data === "\u001b[B") this.selected = Math.min(Math.max(0, list.length - 1), this.selected + 1);
    else if (!this.detail && data === "\u001b[A") this.selected = Math.max(0, this.selected - 1);
    else if (this.detail && data === "\t") { this.stream = this.stream === "stdout" ? "stderr" : "stdout"; this.offset = 0; }
    else if (this.detail && data === "\u001b[5~") this.offset = Math.max(0, this.offset - 8);
    else if (this.detail && data === "\u001b[6~") this.offset += 8;
    else if (data === "k" && list[this.selected]) void this.manager.kill(list[this.selected].id);
    this.onUpdate();
  }

  private currentId(): string | undefined { return this.manager.list()[this.selected]?.id; }
  private async loadLogs(): Promise<void> {
    const id = this.currentId();
    if (!id) return;
    try {
      const logs = await this.manager.readLogs(id);
      if (this.detail && this.currentId() === id && typeof logs !== "string") {
        this.logs = logs;
        this.onUpdate();
      }
    } catch { /* Logs for a running child may become readable after it closes. */ }
  }
}
