import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TerminalManager, type Terminal } from "./manager.ts";
import { TerminalList } from "./tui.ts";

export function registerBackgroundTerminals(pi: ExtensionAPI, manager = new TerminalManager()): void {
  let sessionId: string | undefined;
  const reported = new Set<string>();
  const matches = (ctx: any) => { try { return sessionId === ctx.sessionManager.getSessionId(); } catch { return false; } };
  const clean = async () => { sessionId = undefined; reported.clear(); await manager.dispose(); };
  manager.subscribe(event => {
    if (event.type !== "completed" || !sessionId || reported.has(event.terminal.id)) return;
    reported.add(event.terminal.id);
    pi.sendUserMessage(`Background terminal ${event.terminal.id} finished (exit ${event.terminal.exitCode ?? "unknown"}). Inspect its output with background_terminal_status or background_terminal_logs.`, { deliverAs: "followUp" });
  });
  pi.on("session_start", async (_event, ctx) => { await clean(); await manager.beginSession(); try { sessionId = ctx.sessionManager.getSessionId(); } catch {} });
  pi.on("session_shutdown", async (_event, ctx) => { if (matches(ctx)) await clean(); });

  pi.registerTool({
    name: "background_terminal_start", label: "Background terminal", description: "Start a non-interactive shell command in the background. Optionally wait for it to finish.",
    parameters: Type.Object({ command: Type.String(), cwd: Type.Optional(Type.String()), wait: Type.Optional(Type.Boolean()) }),
    async execute(_id, args, signal, _update, ctx) {
      if (!matches(ctx)) throw new Error("Background terminals are unavailable outside an active session");
      const t = manager.start(args.command, args.cwd ?? ctx.cwd);
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
    async execute(_id, args) { const t = manager.get(args.id); if (!t) throw new Error(`Unknown terminal ${args.id}`); return { content: [{ type: "text", text: formatTerminal(t) }], details: t }; },
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
