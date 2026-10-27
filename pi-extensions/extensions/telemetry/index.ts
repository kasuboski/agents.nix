import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, type TelemetryConfig } from "./config.ts";
import { TelemetryRuntime } from "./lifecycle.ts";

type Runtime = Pick<TelemetryRuntime, "agentStart" | "beforeSettle" | "settled" | "toolStart" | "toolEnd" | "inject" | "shutdown">;
type Dependencies = {
  getAgentDir: () => string;
  loadConfig: (agentDir: string) => TelemetryConfig | undefined;
  createRuntime: (config: TelemetryConfig, sessionId: string) => Runtime;
};
type ActiveGeneration = { id: number; sessionId: string; runtime: Runtime };

const defaults: Dependencies = { getAgentDir, loadConfig, createRuntime: (config, sessionId) => new TelemetryRuntime(config, sessionId) };

/** Connect Pi lifecycle/provider events to the session-scoped telemetry runtime. */
export function registerTelemetry(pi: ExtensionAPI, dependencies: Dependencies = defaults): void {
  let generation = 0;
  let active: ActiveGeneration | undefined;
  let retiring: Promise<void> | undefined;

  const current = (ctx: { sessionManager: { getSessionId(): string } }): ActiveGeneration | undefined => {
    const candidate = active;
    if (!candidate || candidate.id !== generation) return undefined;
    try {
      return ctx.sessionManager.getSessionId() === candidate.sessionId ? candidate : undefined;
    } catch {
      return undefined;
    }
  };

  const stop = (candidate: ActiveGeneration | undefined): Promise<void> => {
    if (active === candidate) active = undefined;
    if (!candidate) return retiring ?? Promise.resolve();
    let shutdown: Promise<void>;
    try { shutdown = Promise.resolve(candidate.runtime.shutdown()).catch(() => {}); }
    catch { shutdown = Promise.resolve(); }
    const pending = Promise.all([retiring, shutdown]).then(() => {});
    retiring = pending;
    void pending.then(() => { if (retiring === pending) retiring = undefined; });
    return pending;
  };

  const forEvent = (ctx: { sessionManager: { getSessionId(): string } }): ActiveGeneration | undefined => {
    const candidate = current(ctx);
    if (candidate) return candidate;
    const old = active;
    if (!old) return undefined;
    let sessionId: string | undefined;
    try { sessionId = ctx.sessionManager.getSessionId(); } catch { /* unavailable context */ }
    if (sessionId !== old.sessionId) {
      generation++;
      void stop(old);
    }
    return undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    const token = ++generation;
    const previous = active;
    active = undefined;
    await stop(previous);
    if (token !== generation) return;
    try {
      const config = dependencies.loadConfig(dependencies.getAgentDir());
      if (!config) return;
      const sessionId = ctx.sessionManager.getSessionId();
      if (!sessionId || token !== generation) return;
      active = { id: token, sessionId, runtime: dependencies.createRuntime(config, sessionId) };
    } catch {
      // Telemetry setup must never interfere with session startup.
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const candidate = current(ctx);
    const old = candidate ?? active;
    // Invalidate a session_start that is still awaiting retirement, even with no active runtime.
    generation++;
    await stop(old);
  });

  pi.on("agent_start", (_event, ctx) => { try { forEvent(ctx)?.runtime.agentStart(); } catch { /* non-fatal */ } });
  // Pi 1.0.2 turn_end BoundaryState.outcome is available even when an early
  // abort skips before_settle. Observe only the safe enum, never message content.
  pi.on("turn_end", (event, ctx) => {
    try { forEvent(ctx)?.runtime.beforeSettle(event.outcome); } catch { /* non-fatal */ }
  });
  pi.on("agent_before_settle", (event, ctx) => {
    try { forEvent(ctx)?.runtime.beforeSettle(event.outcome); } catch { /* non-fatal */ }
  });
  pi.on("agent_settled", (_event, ctx) => { try { forEvent(ctx)?.runtime.settled(); } catch { /* non-fatal */ } });
  pi.on("tool_execution_start", (event, ctx) => {
    try { forEvent(ctx)?.runtime.toolStart(event.toolCallId, event.toolName, event.parentToolCallId); } catch { /* non-fatal */ }
  });
  pi.on("tool_execution_end", (event, ctx) => {
    try { forEvent(ctx)?.runtime.toolEnd(event.toolCallId, event.isError); } catch { /* non-fatal */ }
  });
  pi.on("before_provider_headers", (event, ctx) => {
    try { forEvent(ctx)?.runtime.inject(event.headers); } catch { /* non-fatal */ }
  });
}

export default function telemetryExtension(pi: ExtensionAPI): void {
  registerTelemetry(pi);
}
