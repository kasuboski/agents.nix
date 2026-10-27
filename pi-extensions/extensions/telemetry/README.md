# Structural telemetry

This extension emits optional, session-scoped OpenTelemetry traces for Pi agent interactions and tool execution. It records structure, not content: prompts, messages, model names, tool arguments/results, file paths, credentials, and exception text are not exported. Tool names are length-bounded and restricted to a conservative character set.

Every Pi-created span carries the exact Pi session ID in both `session.id` and `gen_ai.conversation.id`. W3C baggage propagates those same identities. Agent and tool spans use [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) (currently Development), rather than backend-specific span typing:

| Operation | Span name | Attributes |
| --- | --- | --- |
| Local agent invocation | `invoke_agent pi` | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name=pi` |
| Local tool execution | `execute_tool {tool name}` | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id` |

Both operations use `INTERNAL` span kind. Tool names are sanitized and bounded in both names and attributes. `pi.outcome` and `pi.incomplete` remain application-specific lifecycle bookkeeping; failures also set the content-free `error.type=agent_error` because Pi reports failure without a safe exception classification. Structural fallback scopes (`pi.tool_scope`) and header preparation (`pi.provider_dispatch`) remain custom operations, not fabricated agent or inference calls. The attribute budget accommodates identities, semantic fields, outcome, incomplete state, and error type together.

The **LLM proxy owns model-call spans, conversation content, token usage, and cost**. The extension does not duplicate that data: it supplies the agent/tool structure and W3C context connecting proxy spans to each interaction. The proxy must extract the incoming trace context, create its model-call span under that parent, and explicitly copy baggage identities onto relevant spans; baggage does not automatically become an attribute. The combined pipeline can therefore reconstruct conversations even though this extension exports no message bodies.

Telemetry is disabled unless an export endpoint is configured. Configuration is read from `<agent-dir>/extensions/telemetry.json`, where agent-dir comes from Pi's exported `getAgentDir()` utility and honors `PI_CODING_AGENT_DIR`. **The SDK `agentDir` option is not available to this extension through its event context and is not honored for locating telemetry config.** Embedded SDK hosts that need a non-default config directory must set `PI_CODING_AGENT_DIR` in the process environment before loading/starting the extension. The installed host peer is pinned for development/type checking to **`@earendil-works/pi-coding-agent` 1.0.2**; the extension uses Pi's direct event API and exported `getAgentDir()` utility.

## Configuration

Example personal config at `<agent-dir>/extensions/telemetry.json`:

```json
{
  "endpoint": "http://otel-collector.<tailnet>.ts.net:4318/v1/traces",
  "serviceName": "pi",
  "sampleRatio": 1,
  "shutdownTimeoutMs": 3000,
  "baggageAllowlist": []
}
```

The endpoint alone enables telemetry: no credentials, environment variables, or `enabled` flag are required. The primary deployment is a trusted tailnet collector; it owns downstream Latitude credentials and routing. HTTP without headers is also supported for remote collectors—restrict listeners with network binding/firewall and tailnet ACLs, never expose an unauthenticated receiver publicly. HTTPS and optional authentication headers work equally well. Export headers are percent-decoded (`Authorization=Bearer%20...`), belong only to OTLP export, and never enter model headers. Select a custom secret environment variable with `headersFromEnv`; do not put secrets in JSON. `allowInsecureHeaders: true` explicitly permits configured headers over remote HTTP; otherwise any headers require HTTPS or loopback HTTP.

`protocol` may be omitted or set to `http/json`; other protocols disable telemetry. Endpoint precedence is `PI_OTEL_ENDPOINT`, JSON `endpoint`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, then `OTEL_EXPORTER_OTLP_ENDPOINT` (the generic endpoint gets `/v1/traces` appended). Header precedence is `PI_OTEL_HEADERS`, the variable named by `headersFromEnv`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, then `OTEL_EXPORTER_OTLP_HEADERS`. Protocol environment precedence is `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` then `OTEL_EXPORTER_OTLP_PROTOCOL`. `OTEL_SERVICE_NAME` overrides JSON `serviceName`, and `PI_OTEL_SAMPLE_RATIO` overrides JSON `sampleRatio`. Setting `OTEL_SDK_DISABLED=true` disables this extension.

Sampling defaults to **1.0** (all root traces sampled), with an isolated parent-based sampler; use `sampleRatio` from 0 to 1 or `PI_OTEL_SAMPLE_RATIO` to adjust it. Non-recording spans still propagate valid context. Coordinate downstream parent sampling separately, and use 100% when validating complete accounting; collector tail sampling can also make totals partial. This extension never duplicates the proxy's semantic LLM/usage/cost spans.

Malformed selected settings disable telemetry safely, with value-free diagnostics and no alternate destination fallback. An inherited standard OTLP endpoint also enables the extension. Only the environment conventions listed here are supported; `PI_TELEMETRY` is unrelated. Export failures do not affect model requests/tools. A bounded queue (2048 spans, 256 per batch), one concurrent export, coalesced flushes, request abort deadlines, and bounded shutdown prevent unbounded offline work. Congestion, rejection, timeouts, hard termination and crashes can drop spans; delivery is best-effort, without a disk queue or extension retry loop.

## Trace coverage and limitations

- `agent_start` starts/reuses an interaction span; `agent_before_settle` records Pi's typed outcome (`completed`, `aborted`, or `error`); `agent_settled` ends the interaction once automatic follow-up work is complete.
- Tool execution start/end spans preserve parent tool-call IDs (including nested calls) and mark failed calls. An unknown parent falls back to the active interaction; a structural scope root is used only when no interaction exists. No tool data is reconstructed.
- `before_provider_headers` injects W3C trace context and baggage into supported outbound provider requests. Both session identities are propagated when they fit W3C byte limits; otherwise both are omitted with a safe warning, never truncated/hashed into different identities. IDs above 4096 characters disable the generation rather than exporting untagged spans. Additional baggage requires an explicit `baggageAllowlist`, and only bounded pre-existing values in that list are forwarded. Caching/provenance headers such as `x-session-id` and `x-litellm-session-id` are untouched.
- When no interaction is active, the hook can emit a short `pi.provider_dispatch` span around provider-header preparation. This measures local preparation only, **not provider/LLM request latency**.

This extension provides semantic agent/tool tracing, not model-call capture: there are no locally exported LLM input/output, token, cost, model, retry-detail, or tool-argument/result attributes. Those model-call details and conversation content belong to the proxy's telemetry. It does not instrument arbitrary HTTP clients or providers outside Pi's event hook. In particular, direct model-registry calls bypass these hooks; the SDK integration test verifies that limitation. It exports OTLP/HTTP JSON using a private serializer and HTTP transport, not the standard OpenTelemetry OTLP exporter, and emits no standard exporter diagnostic logs. gRPC and HTTP/protobuf are unsupported. It uses a local OpenTelemetry provider/propagator and does not register or mutate OpenTelemetry globals. It cannot guarantee that the process has no OpenTelemetry globals: Pi or third-party extensions may own or mutate their own globals.

Configuring an endpoint consents to exporting IDs/tool names/timing and propagating session baggage to **all providers reached through the SDK header hook**. That event has no destination URL, so this extension cannot implement a reliable destination allowlist. No host/user/process/cwd resource detection, prompt capture, free-form events, raw error status messages or content-capture option exists.

Each session/reload gets an isolated runtime. Shutdown is awaited and bounded. Pi's event API provides no generation token on callbacks, so a callback with a mismatched session ID retires the current runtime to avoid leaking its state; it is impossible to distinguish a stale callback from a genuine current-session change in that case. Generation tokens do prevent delayed session-start work from installing a runtime after a newer session has replaced it, but cannot universally reject stale callbacks without a host-provided event generation.

## Development

From the repository root, install project dependencies and run the local Pi launcher:

```sh
mise exec node@24.20.0 -- npm ci --ignore-scripts
mise exec -- ./dev.sh --ext telemetry
```

The extension uses Node 24's built-in TypeScript support and test runner (`node:test`; `--experimental-strip-types` and `--experimental-transform-types`). From `extensions/telemetry`:

```sh
mise exec node@24.20.0 -- npm ci --ignore-scripts
mise exec node@24.20.0 -- npm test
mise exec node@24.20.0 -- npm run typecheck
```

Tested host: Pi 1.0.2 and Node 24.20.0. `dev.sh` fetches unpinned latest Pi; the latest-launcher smoke test currently fails inside bundled Undici before extension loading. The pinned SDK integration suite does not use that launcher.

Local integration coverage includes real SDK Chat Completions, nested tools, idle manual compaction, HTTP/OTLP JSON, and direct-registry bypass. Aperture's two load orders, Responses/native adapters, live warming/overflow/retry, full reload/fork/resume integration and production proxy/Latitude accounting remain unverified.

### Collector validation performed locally

Before submission, local validation used the official Collector contrib **0.123.0** with OTLP HTTP and file/debug exporters, actual Pi SDK **1.0.2**, and a deterministic local model fixture. It verified an interaction and two nested tool spans, trace/parent IDs, session attributes, provider baggage, and privacy. Unsupported `grpc` configuration remained inert while tools completed normally. No real model credentials or private session content were used.

The test-only harness and generated evidence are not included in this change. This establishes local HTTP/JSON collector compatibility, not production delivery guarantees, authenticated remote export, proxy/Latitude accounting, or other protocols.
