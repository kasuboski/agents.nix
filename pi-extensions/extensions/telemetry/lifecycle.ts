import { ROOT_CONTEXT, type Context, type Span } from "@opentelemetry/api";
import type { TelemetryConfig } from "./config.ts";
import { TelemetryTracing, type SafeOutcome } from "./tracing.ts";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

const MAX_OPEN_TOOLS = 2048;
const MAX_CALL_ID_LENGTH = 256;

type ToolState = {
  span: Span;
  context: Context;
  parentToolCallId?: string;
  scope?: ScopeState;
};

type ScopeState = { span: Span; context: Context; children: number };

/** Structural interaction/tool tracing for one Pi session generation. */
export class TelemetryRuntime {
  private readonly tracing: TelemetryTracing;
  private interaction?: { span: Span; context: Context; lastOutcome: SafeOutcome; runCount: number };
  private readonly tools = new Map<string, ToolState>();
  private readonly orphanScopes = new Set<ScopeState>();
  private closed = false;
  private shutdownPromise?: Promise<void>;
  private diagnostics = 0;

  constructor(config: TelemetryConfig, readonly sessionId: string, exporter?: SpanExporter) {
    this.tracing = new TelemetryTracing(config, sessionId, exporter);
  }

  agentStart(): void {
    this.guard(() => {
      if (this.closed) return;
      if (this.interaction) {
        this.interaction.runCount = Math.min(Number.MAX_SAFE_INTEGER, this.interaction.runCount + 1);
        return;
      }
      const root = this.tracing.startSpan("invoke_agent", ROOT_CONTEXT);
      this.interaction = { ...root, lastOutcome: "unknown", runCount: 1 };
    });
  }

  beforeSettle(outcome: string): void {
    this.guard(() => {
      if (!this.interaction || this.closed) return;
      this.interaction.lastOutcome = normalizeOutcome(outcome);
    });
  }

  settled(): void {
    this.guard(() => {
      if (this.closed) return;
      this.closeAllTools(true);
      const interaction = this.interaction;
      this.interaction = undefined;
      if (interaction) this.tracing.end(interaction.span, interaction.lastOutcome);
      this.tracing.flushSoon();
    });
  }

  toolStart(id: string, name: string, parentId?: string): void {
    this.guard(() => {
      if (this.closed || !isSafeCallId(id) || this.tools.has(id) || this.tools.size >= MAX_OPEN_TOOLS) {
        this.diagnostic();
        return;
      }
      let parent: Context;
      let scope: ScopeState | undefined;
      if (parentId) {
        const knownParent = this.tools.get(parentId);
        if (knownParent) {
          parent = knownParent.context;
          scope = knownParent.scope;
          if (scope) scope.children++;
        }
        else {
          this.diagnostic();
          parent = this.interaction?.context ?? ROOT_CONTEXT;
          if (!this.interaction) {
            scope = this.orphanScope();
            scope.children++;
            parent = scope.context;
          }
        }
      } else {
        parent = this.interaction?.context ?? ROOT_CONTEXT;
        if (!this.interaction) {
          scope = this.orphanScope();
          scope.children++;
          parent = scope.context;
        }
      }
      const started = this.tracing.startSpan("execute_tool", parent, {
        "gen_ai.tool.name": name,
        "gen_ai.tool.call.id": id,
      });
      this.tools.set(id, { ...started, parentToolCallId: parentId, scope });
    });
  }

  toolEnd(id: string, isError: boolean): void {
    this.guard(() => {
      if (this.closed || !isSafeCallId(id)) return;
      const tool = this.tools.get(id);
      if (!tool) {
        this.diagnostic();
        return;
      }
      this.tools.delete(id);
      this.tracing.end(tool.span, isError ? "error" : "completed");
      if (tool.scope) {
        tool.scope.children = Math.max(0, tool.scope.children - 1);
        if (tool.scope.children === 0) this.closeScope(tool.scope);
      }
    });
  }

  inject(headers: Record<string, string | null>): void {
    this.guard(() => {
      if (this.closed) return;
      let selected = this.interaction?.context;
      let dispatch: Span | undefined;
      if (!selected) {
        const root = this.tracing.startSpan("pi.provider_dispatch", ROOT_CONTEXT);
        dispatch = root.span;
        selected = root.context;
      }
      try {
        this.tracing.inject(headers, selected, this.tracing.config.baggageAllowlist);
      } finally {
        if (dispatch) this.tracing.end(dispatch);
      }
    });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.closeAllTools(true);
    if (this.interaction) {
      this.tracing.end(this.interaction.span, "unknown", true);
      this.interaction = undefined;
    }
    this.shutdownPromise = this.tracing.shutdown();
    return this.shutdownPromise;
  }

  private orphanScope(): ScopeState {
    const scope = this.tracing.startSpan("pi.tool_scope", ROOT_CONTEXT);
    const state = { ...scope, children: 0 };
    this.orphanScopes.add(state);
    return state;
  }

  private closeScope(scope: ScopeState): void {
    if (!this.orphanScopes.delete(scope)) return;
    this.tracing.end(scope.span);
  }

  private closeAllTools(incomplete: boolean): void {
    for (const tool of this.tools.values()) {
      this.tracing.end(tool.span, undefined, incomplete);
      if (tool.scope) {
        tool.scope.children = Math.max(0, tool.scope.children - 1);
        if (tool.scope.children === 0) this.closeScope(tool.scope);
      }
    }
    this.tools.clear();
    for (const scope of this.orphanScopes) this.tracing.end(scope.span, undefined, incomplete);
    this.orphanScopes.clear();
  }

  private diagnostic(): void {
    // Keep bookkeeping bounded; warnings contain neither call IDs nor tool data.
    if (this.diagnostics < 8) this.diagnostics++;
  }

  private guard(action: () => void): void {
    try { action(); } catch {
      this.diagnostic();
    }
  }
}

function isSafeCallId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_CALL_ID_LENGTH && !/[\r\n\0]/.test(id);
}

function normalizeOutcome(outcome: string): SafeOutcome {
  switch (outcome.toLowerCase()) {
    case "success":
    case "completed": return "completed";
    case "error":
    case "failed": return "error";
    case "abort":
    case "aborted":
    case "cancelled":
    case "canceled": return "aborted";
    default: return "unknown";
  }
}

export type { TelemetryConfig };
