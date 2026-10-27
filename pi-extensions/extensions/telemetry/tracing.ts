import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  propagation,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapPropagator,
  type TextMapSetter,
} from "@opentelemetry/api";
import { W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { TelemetryConfig } from "./config.ts";

const MAX_SESSION_ID_LENGTH = 4096;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_ATTRIBUTE_VALUE_LENGTH = 4096;
const EXPORT_TIMEOUT_FALLBACK_MS = 10_000;

function safeExportError(): Error {
  const error = new Error("telemetry export failed");
  // SDK background error handling may call another extension's global diag logger.
  // Even a locally constructed Error stack would reveal installation/project paths.
  error.stack = "";
  return error;
}

const getter: TextMapGetter<Record<string, string | null>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => {
    const actual = Object.keys(carrier).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return actual ? carrier[actual] ?? undefined : undefined;
  },
};

const setter: TextMapSetter<Record<string, string | null>> = {
  set(carrier, key, value) {
    for (const existing of Object.keys(carrier)) {
      if (existing.toLowerCase() === key.toLowerCase()) delete carrier[existing];
    }
    carrier[key] = value;
  },
};

/** Serializes SDK scheduled/flush batches with bounded pending memory and transport deadlines. */
export class BoundedExporter implements SpanExporter {
  private readonly queue: Array<{ spans: Parameters<SpanExporter["export"]>[0]; callback: Parameters<SpanExporter["export"]>[1] }> = [];
  private pendingSpans = 0;
  private activeFinish?: (result: { code: number; error?: Error }) => void;
  private stopped = false;
  private shutdownPromise?: Promise<void>;
  private warned = false;

  constructor(
    private readonly inner: SpanExporter,
    private readonly warn: (message: string) => void,
    private readonly timeoutMs: number,
    private readonly innerOwnsTimeout = false,
  ) {}

  export(spans: Parameters<SpanExporter["export"]>[0], resultCallback: Parameters<SpanExporter["export"]>[1]): void {
    if (this.stopped || this.queue.length >= 8 || this.pendingSpans + spans.length > 2048) {
      this.warnOnce(this.stopped ? undefined : "telemetry export queue full; batch omitted (details omitted)");
      resultCallback({ code: 1, error: safeExportError() });
      return;
    }
    this.queue.push({ spans, callback: resultCallback });
    this.pendingSpans += spans.length;
    this.pump();
  }

  private pump(): void {
    if (this.activeFinish || this.stopped) return;
    const batch = this.queue.shift();
    if (!batch) return;
    const { spans, callback: resultCallback } = batch;
    this.pendingSpans -= spans.length;
    let settled = false;
    const finish = (result: { code: number; error?: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.activeFinish = undefined;
      if (result.code !== 0 || result.error) {
        this.warnOnce();
        resultCallback({ code: result.code, error: safeExportError() });
      } else resultCallback(result);
      this.pump();
    };
    this.activeFinish = finish;
    // The private transport aborts timed-out requests and calls finish itself,
    // leaving later batches usable. Opaque exporters may still have live I/O,
    // so conservatively stop them instead of opening another transport.
    const timer = this.innerOwnsTimeout ? undefined
      : setTimeout(() => { void this.shutdown().catch(() => {}); }, this.timeoutMs);
    try {
      this.inner.export(spans, finish);
    } catch {
      finish({ code: 1, error: new Error("export failed") });
    }
  }

  forceFlush(): Promise<void> {
    return settleWithin(this.inner.forceFlush?.() ?? Promise.resolve(), this.timeoutMs);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    this.activeFinish?.({ code: 1, error: safeExportError() });
    for (const batch of this.queue.splice(0)) batch.callback({ code: 1, error: safeExportError() });
    this.pendingSpans = 0;
    this.shutdownPromise = settleWithin(Promise.resolve().then(() => this.inner.shutdown()), this.timeoutMs).then(() => {});
    return this.shutdownPromise;
  }

  private warnOnce(message = "telemetry export failed (details omitted)"): void {
    if (this.warned) return;
    this.warned = true;
    try { this.warn(message); } catch { /* non-fatal */ }
  }
}

export type SafeOutcome = "completed" | "error" | "aborted" | "unknown";

/** Isolated OTEL primitives. Does not read or modify any OpenTelemetry global. */
export class TelemetryTracing {
  readonly provider: BasicTracerProvider;
  readonly tracer;
  readonly propagator: TextMapPropagator;
  private readonly exporter: BoundedExporter;
  private flushPromise?: Promise<void>;
  private stopped = false;
  private warned = false;

  constructor(
    readonly config: TelemetryConfig,
    private readonly sessionId: string,
    exporter?: SpanExporter,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {
    if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
      try { warn("telemetry: session identity exceeds limits; generation disabled"); } catch { /* non-fatal */ }
      throw new Error("Unsupported telemetry session identity");
    }
    const timeoutMs = Number.isFinite(config.shutdownTimeoutMs) && config.shutdownTimeoutMs > 0
      ? config.shutdownTimeoutMs
      : EXPORT_TIMEOUT_FALLBACK_MS;
    const actualExporter = exporter ?? new PrivateOtlpHttpExporter(config.endpoint, config.headers, timeoutMs);
    const safeExporter = new BoundedExporter(actualExporter, this.warn, timeoutMs, exporter === undefined);
    this.exporter = safeExporter;
    this.provider = new BasicTracerProvider({
      resource: resourceFromAttributes({ "service.name": config.serviceName }),
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
      spanProcessors: [new BatchSpanProcessor(safeExporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 256,
        scheduledDelayMillis: 1000,
        // Include the active batch plus eight queued batches. Per-transport
        // deadlines fire first and supply stack-free safe errors to the SDK.
        exportTimeoutMillis: timeoutMs * 9 + 100,
      })],
      spanLimits: {
        attributeCountLimit: 10,
        attributeValueLengthLimit: MAX_ATTRIBUTE_VALUE_LENGTH,
        eventCountLimit: 0,
        linkCountLimit: 0,
      },
    });
    this.tracer = this.provider.getTracer("pi-telemetry", "1.0.0");
    this.propagator = new CompositeLocalPropagator();

  }

  startSpan(operation: "invoke_agent" | "execute_tool" | "pi.tool_scope" | "pi.provider_dispatch", parent: Context = ROOT_CONTEXT, attributes: Record<string, string | number | boolean> = {}): { span: Span; context: Context } {
    const safeAttrs: Record<string, string | number | boolean> = {};
    let name: string = operation;
    if (operation === "invoke_agent") {
      safeAttrs["gen_ai.operation.name"] = operation;
      safeAttrs["gen_ai.agent.name"] = "pi";
      name = "invoke_agent pi";
    } else if (operation === "execute_tool") {
      safeAttrs["gen_ai.operation.name"] = operation;
      const toolName = normalizeToolName(attributes["gen_ai.tool.name"]);
      const callId = attributes["gen_ai.tool.call.id"];
      safeAttrs["gen_ai.tool.name"] = toolName;
      name = `execute_tool ${toolName}`;
      if (typeof callId === "string" && callId.length <= 256 && !/[\r\n\0]/.test(callId)) safeAttrs["gen_ai.tool.call.id"] = callId;
    }
    safeAttrs["session.id"] = this.sessionId;
    safeAttrs["gen_ai.conversation.id"] = this.sessionId;
    const span = this.tracer.startSpan(name, { kind: SpanKind.INTERNAL, attributes: safeAttrs }, parent);
    return { span, context: trace.setSpan(parent, span) };
  }

  end(span: Span, outcome?: SafeOutcome, incomplete = false): void {
    try {
      if (incomplete) span.setAttribute("pi.incomplete", true);
      if (outcome) {
        span.setAttribute("pi.outcome", outcome);
        if (outcome === "completed") span.setStatus({ code: SpanStatusCode.OK });
        else if (outcome === "error") {
          span.setAttribute("error.type", "agent_error");
          span.setStatus({ code: SpanStatusCode.ERROR, message: "Agent activity failed" });
        }
      }
      span.end();
    } catch {
      this.warnOnce("span finalization failed (details omitted)");
    }
  }

  inject(headers: Record<string, string | null>, selected: Context, allowlist: string[]): void {
    const contextWithoutBaggage = selected;
    const received = new CompositeLocalPropagator().extract(ROOT_CONTEXT, headers, getter);
    const receivedBaggage = propagation.getBaggage(received);
    const allowed = new Set(["session.id", "gen_ai.conversation.id", ...allowlist]);
    const entries: Record<string, { value: string }> = {};
    // These two identities intentionally refer to the Pi session per the telemetry contract.
    if (this.sessionId.length <= MAX_SESSION_ID_LENGTH) {
      entries["session.id"] = { value: this.sessionId };
      entries["gen_ai.conversation.id"] = { value: this.sessionId };
    }
    for (const key of receivedBaggage?.getAllEntries().map(([name]) => name) ?? []) {
      if (allowed.has(key) && !["session.id", "gen_ai.conversation.id"].includes(key.toLowerCase())) {
        const value = receivedBaggage?.getEntry(key)?.value;
        if (value && value.length <= 256) entries[key] = { value };
      }
    }
    let injected = contextWithoutBaggage;
    try {
      // Remove stale propagation first; the selected context is authoritative.
      for (const key of Object.keys(headers)) {
        if (["traceparent", "tracestate", "baggage"].includes(key.toLowerCase())) delete headers[key];
      }
      const write = (values: Record<string, { value: string }>) => {
        const baggage = propagation.createBaggage(values);
        injected = propagation.setBaggage(contextWithoutBaggage, baggage);
        this.propagator.inject(injected, headers, setter);
      };
      write(entries);
      const output = propagation.getBaggage(new CompositeLocalPropagator().extract(ROOT_CONTEXT, headers, getter));
      const hasBothIdentities = this.sessionId.length > MAX_SESSION_ID_LENGTH || (
        output?.getEntry("session.id")?.value === this.sessionId &&
        output?.getEntry("gen_ai.conversation.id")?.value === this.sessionId
      );
      if (Object.entries(entries).some(([key, entry]) =>
        !["session.id", "gen_ai.conversation.id"].includes(key) && output?.getEntry(key)?.value !== entry.value)) {
        this.warnOnce("selected extra baggage exceeds propagation limits; entries omitted (details omitted)");
      }
      if (!hasBothIdentities) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === "baggage") delete headers[key];
        delete entries["session.id"];
        delete entries["gen_ai.conversation.id"];
        write(entries);
        this.warnOnce("session identity baggage exceeds propagation limits; both identities omitted");
      }
    } catch {
      this.warnOnce("context propagation failed (details omitted)");
    }
  }

  flushSoon(): void {
    if (this.stopped || this.flushPromise) return;
    this.flushPromise = this.provider.forceFlush()
      .catch(() => this.warnOnce("telemetry flush failed (details omitted)"))
      .finally(() => { this.flushPromise = undefined; });
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, this.config.shutdownTimeoutMs); });
    try {
      await Promise.race([this.provider.shutdown().catch(() => this.warnOnce("telemetry shutdown failed (details omitted)")), timeout]);
    } catch {
      this.warnOnce("telemetry shutdown failed (details omitted)");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // A provider timeout alone does not cancel queued exports or live HTTP requests.
      void this.exporter.shutdown().catch(() => this.warnOnce("telemetry shutdown failed (details omitted)"));
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    try { this.warn(message); } catch { /* telemetry diagnostics are non-fatal */ }
  }
}

/** OTLP HTTP transport without OpenTelemetry's process-global diag logger. */
class PrivateOtlpHttpExporter implements SpanExporter {
  private readonly requests = new Set<ClientRequest>();
  private stopped = false;

  constructor(private readonly endpoint: string, private readonly headers: Record<string, string>, private readonly timeoutMs: number) {}

  export(spans: Parameters<SpanExporter["export"]>[0], callback: Parameters<SpanExporter["export"]>[1]): void {
    if (this.stopped) {
      callback({ code: 1, error: new Error("telemetry exporter stopped") });
      return;
    }
    let payload: Uint8Array | undefined;
    try { payload = JsonTraceSerializer.serializeRequest(spans); } catch { /* sanitized below */ }
    if (!payload) {
      callback({ code: 1, error: new Error("telemetry serialization failed") });
      return;
    }
    let request: ClientRequest | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (request) {
        this.requests.delete(request);
        request.destroy();
      }
      callback(success ? { code: 0 } : { code: 1, error: safeExportError() });
    };
    try {
      const send = new URL(this.endpoint).protocol === "https:" ? httpsRequest : httpRequest;
      request = send(this.endpoint, {
        method: "POST",
        // No pooled socket or redirect can outlive this bounded private request.
        agent: false,
        headers: { ...this.headers, "content-type": "application/json" },
      }, (response) => {
        const success = (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300;
        // Response content is never collected, including endless/error bodies.
        response.destroy();
        finish(success);
      });
      this.requests.add(request);
      request.once("error", () => finish(false));
      request.once("close", () => finish(false));
      timer = setTimeout(() => finish(false), this.timeoutMs);
      request.end(payload);
    } catch {
      finish(false);
    }
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const request of this.requests) request.destroy();
    this.requests.clear();
  }
}

class CompositeLocalPropagator implements TextMapPropagator {
  private readonly delegates = [new W3CTraceContextPropagator(), new W3CBaggagePropagator()];
  inject(ctx: Context, carrier: Record<string, string | null>, setterArg: TextMapSetter<Record<string, string | null>>): void {
    for (const delegate of this.delegates) delegate.inject(ctx, carrier, setterArg);
  }
  extract(ctx: Context, carrier: Record<string, string | null>, getterArg: TextMapGetter<Record<string, string | null>>): Context {
    return this.delegates.reduce((current, delegate) => delegate.extract(current, carrier, getterArg), ctx);
  }
  fields(): string[] { return this.delegates.flatMap((delegate) => delegate.fields()); }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizeToolName(name: unknown): string {
  if (typeof name !== "string") return "unknown";
  let bounded = "";
  let count = 0;
  for (const character of name) {
    if (count++ === MAX_TOOL_NAME_LENGTH) break;
    bounded += character;
  }
  return /^[\p{L}\p{N}_.:-]+$/u.test(bounded) ? bounded : "other";
}

export { MAX_TOOL_NAME_LENGTH };
