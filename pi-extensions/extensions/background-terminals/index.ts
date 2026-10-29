import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TerminalManager, type Terminal } from "./manager.ts";
import { TerminalList } from "./tui.ts";

export function registerBackgroundTerminals(pi: ExtensionAPI, manager = new TerminalManager()): void {
  let sessionId: string | undefined;
  const acknowledged = new Set<string>();
  const pending = new Map<string, Terminal>();
  let sessionContext: ExtensionContext | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const acknowledge = (t: Terminal) => {
    if (t.status === "running") return;
    acknowledged.add(t.id);
    pending.delete(t.id);
  };
  const notification = () => ({
    customType: "background-terminal-completed",
    content: `Background terminals finished:\n${[...pending.values()].map(t => `${t.id}: ${t.status} (exit ${t.exitCode ?? "unknown"})`).join("\n")}\nInspect output with background_terminal_status or background_terminal_logs.`,
    display: true,
    details: { ids: [...pending.keys()] },
  });
  const drain = () => {
    const message = notification();
    for (const id of pending.keys()) acknowledged.add(id);
    pending.clear();
    return message;
  };
  // Recheck busy periods (including standalone compaction) without queuing stale messages.
  const checkIdle = () => {
    idleTimer = undefined;
    if (!sessionContext || !pending.size) return;
    if (sessionContext.isIdle()) pi.sendMessage(drain(), { triggerTurn: true });
    else { idleTimer = setTimeout(checkIdle, 100); idleTimer.unref(); }
  };
  const matches = (ctx: any) => { try { return sessionId === ctx.sessionManager.getSessionId(); } catch { return false; } };
  const clean = async () => {
    sessionId = undefined; sessionContext = undefined;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined; pending.clear(); acknowledged.clear();
    await manager.dispose();
  };
  manager.subscribe(event => {
    if (event.type !== "completed" || !sessionId || acknowledged.has(event.terminal.id)) return;
    pending.set(event.terminal.id, event.terminal);
    if (!idleTimer) { idleTimer = setTimeout(checkIdle, 0); idleTimer.unref(); }
  });
  pi.on("session_start", async (_event, ctx) => { await clean(); await manager.beginSession(); try { sessionId = ctx.sessionManager.getSessionId(); sessionContext = ctx; } catch {} });
  pi.on("agent_before_settle", (event, ctx) => {
    if (!matches(ctx) || !pending.size || event.outcome !== "completed") return;
    return { entries: [...event.entries, { type: "custom_message" as const, ...drain() }], continue: true };
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (!matches(ctx) || !pending.size) return;
    // Late arrivals and aborted runs are recorded without restarting the agent.
    pi.sendMessage(drain(), { triggerTurn: false });
  });
  pi.on("session_shutdown", async (_event, ctx) => { if (matches(ctx)) await clean(); });

  pi.registerTool({
    name: "background_terminal_start", label: "Background terminal", description: "Start a non-interactive shell command in the background. Optionally wait for it to finish.",
    parameters: Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()), wait: Type.Optional(Type.Boolean()) }),
    async execute(_id, args, signal, _update, ctx) {
      if (!matches(ctx)) throw new Error("Background terminals are unavailable outside an active session");
      const t = manager.start(args.command, args.cwd ?? ctx.cwd);
      // start() cannot deliver async process completion before this synchronous registration.
      if (args.wait) acknowledged.add(t.id);
      const cancel = () => { void manager.kill(t.id); };
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (args.wait) {
          const completed = await manager.wait(t.id);
          return { content: [{ type: "text", text: formatTerminal(completed) }], details: completed };
        }
        return { content: [{ type: "text", text: `Started terminal ${t.id} (pid ${t.pid ?? "unknown"}).` }], details: { id: t.id } };
      } finally { signal?.removeEventListener("abort", cancel); }
    },
  });
  pi.registerTool({
    name: "background_terminal_status", label: "Terminal status", description: "Check a tracked terminal's state and captured output.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, args) { const t = manager.get(args.id); if (!t) throw new Error(`Unknown terminal ${args.id}`); acknowledge(t); return { content: [{ type: "text", text: formatTerminal(t) }], details: t }; },
  });
  pi.registerTool({
    name: "background_terminal_logs", label: "Terminal logs", description: "Read complete stdout and stderr logs, including output beyond the in-memory capture limit.",
    parameters: Type.Object({ id: Type.String(), stream: Type.Optional(Type.Union([Type.Literal("stdout"), Type.Literal("stderr")])) }),
    async execute(_id, args) {
      const logs = await manager.readLogs(args.id, args.stream);
      const text = typeof logs === "string" ? logs : `--- stdout ---\n${logs.stdout || "(empty)"}\n--- stderr ---\n${logs.stderr || "(empty)"}`;
      return { content: [{ type: "text", text }], details: { id: args.id, stream: args.stream ?? "both", logs } };
    },
  });
  pi.registerTool({
    name: "background_terminal_list", label: "List terminals", description: "List tracked background terminals.", parameters: Type.Object({}),
    async execute() { const list = manager.list(); return { content: [{ type: "text", text: list.length ? list.map(t => `${t.id} ${t.status} pid=${t.pid ?? "?"} ${t.command} (logs: background_terminal_logs id=${t.id})`).join("\n") : "No tracked terminals." }], details: list }; },
  });
  pi.registerTool({
    name: "background_terminal_kill", label: "Kill terminals", description: "Kill one or more background terminal process trees.", parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }) }),
    async execute(_id, args) { const count = await manager.killMany(args.ids); return { content: [{ type: "text", text: `Killed ${count} running terminal${count === 1 ? "" : "s"}.` }], details: { count } }; },
  });
  pi.registerCommand("ps", { description: "Inspect and manage background terminals", handler: async (_args, ctx) => {
    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      const modal = new TerminalList(manager, theme, done, () => tui.requestRender());
      return { render: (w: number) => modal.render(w), invalidate: () => modal.invalidate(), dispose: () => modal.dispose(), handleInput: (data: string) => { modal.handleInput(data); tui.requestRender(); } };
    }, { overlay: true, overlayOptions: { anchor: "center", width: "80%", minWidth: 60 } });
  } });
}
function formatTerminal(t: Terminal): string {
  return `Terminal ${t.id} — ${t.status} — exit ${t.exitCode ?? "running"}\n$ ${t.command}\n${t.truncated ? "[in-memory capture truncated; use background_terminal_logs to read captured logs]\n" : ""}${t.logsTruncated ? "[full-log safety cap reached; trailing output was discarded]\n" : ""}--- stdout ---\n${t.stdout || "(empty)"}\n--- stderr ---\n${t.stderr || "(empty)"}\nCaptured logs: background_terminal_logs id=${t.id}`;
}
export default function (pi: ExtensionAPI): void { registerBackgroundTerminals(pi); }
