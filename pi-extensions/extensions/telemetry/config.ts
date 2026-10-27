import * as fs from "node:fs";
import * as path from "node:path";
import { isIP } from "node:net";

export type TelemetryConfig = {
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
  sampleRatio: number;
  shutdownTimeoutMs: number;
  baggageAllowlist: string[];
  protocol: "http/json";
};

type JsonConfig = {
  endpoint?: unknown;
  headersFromEnv?: unknown;
  serviceName?: unknown;
  sampleRatio?: unknown;
  shutdownTimeoutMs?: unknown;
  baggageAllowlist?: unknown;
  protocol?: unknown;
  allowInsecureHeaders?: unknown;
};

type Env = Record<string, string | undefined>;
type Warn = (message: string) => void;

const CONFIG_FILE = "telemetry.json";
const MAX_SHUTDOWN_TIMEOUT_MS = 60_000;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BAGGAGE_NAME = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

function warning(warn: Warn, message: string): void {
  // Never include config values, endpoint URLs, header names, or parse exceptions.
  try {
    warn(`telemetry config: ${message}`);
  } catch {
    // Diagnostics must not affect extension startup.
  }
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readJson(agentDir: string, warn: Warn): JsonConfig | undefined {
  const file = path.join(agentDir, "extensions", CONFIG_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      warning(warn, "could not read personal config file");
    }
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    warning(warn, "personal config file is not valid JSON");
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warning(warn, "personal config must be a JSON object");
    return undefined;
  }
  return value as JsonConfig;
}

function getProtocol(json: JsonConfig | undefined, env: Env, warn: Warn): "http/json" | undefined {
  const configured = nonempty(env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL)
    ?? nonempty(env.OTEL_EXPORTER_OTLP_PROTOCOL);
  const value = configured ?? json?.protocol;
  if (value === undefined || value === "http/json") return "http/json";
  warning(warn, "protocol is unsupported; only http/json is available");
  return undefined;
}

function getEndpoint(json: JsonConfig | undefined, env: Env, warn: Warn): string | undefined {
  const jsonEndpoint = json?.endpoint;
  const candidates: Array<{ value: string | undefined; generic?: boolean; invalid?: boolean }> = [
    { value: nonempty(env.PI_OTEL_ENDPOINT) },
    {
      value: typeof jsonEndpoint === "string" ? nonempty(jsonEndpoint) : undefined,
      invalid: jsonEndpoint !== undefined && typeof jsonEndpoint !== "string",
    },
    { value: nonempty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) },
    { value: nonempty(env.OTEL_EXPORTER_OTLP_ENDPOINT), generic: true },
  ];
  const selected = candidates.find((candidate) => candidate.value !== undefined || candidate.invalid);
  if (!selected) return undefined;
  if (selected.invalid || !selected.value) {
    warning(warn, "selected endpoint is invalid; telemetry remains disabled");
    return undefined;
  }

  try {
    const url = new URL(selected.value);
    if (selected.generic) url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/traces`;
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new Error();
    }
    return url.toString();
  } catch {
    warning(warn, "selected endpoint is invalid; telemetry remains disabled");
    return undefined;
  }
}

function decodeHeaderPart(value: string): string {
  // OTEL_EXPORTER_OTLP_HEADERS uses application/x-www-form-urlencoded-style
  // percent encoding, but '+' is a literal plus rather than a space.
  return decodeURIComponent(value.replace(/\+/g, "%2B"));
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return {};
  const headers: Record<string, string> = Object.create(null);
  for (const item of value.split(",")) {
    const equals = item.indexOf("=");
    if (equals <= 0) return undefined;
    let name: string;
    let headerValue: string;
    try {
      name = decodeHeaderPart(item.slice(0, equals).trim());
      headerValue = decodeHeaderPart(item.slice(equals + 1).trim());
    } catch {
      return undefined;
    }
    if (
      !HEADER_NAME.test(name) ||
      /[\r\n\0]/.test(headerValue) ||
      /[\r\n\0]/.test(name)
    ) {
      return undefined;
    }
    headers[name] = headerValue;
  }
  return headers;
}

function getHeaders(json: JsonConfig | undefined, env: Env, warn: Warn): Record<string, string> | undefined {
  const configuredName = typeof json?.headersFromEnv === "string" ? json.headersFromEnv.trim() : "";
  if (json?.headersFromEnv !== undefined && (!configuredName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(configuredName))) {
    warning(warn, "headersFromEnv must name an environment variable");
    return undefined;
  }

  const source = nonempty(env.PI_OTEL_HEADERS)
    ?? (configuredName ? nonempty(env[configuredName]) : undefined)
    ?? nonempty(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS)
    ?? nonempty(env.OTEL_EXPORTER_OTLP_HEADERS);
  const headers = parseHeaders(source);
  if (!headers) {
    warning(warn, "export headers are invalid; telemetry remains disabled");
    return undefined;
  }
  return headers;
}

function readString(
  value: unknown,
  fallback: string,
  valid: (value: string) => boolean,
  setting: string,
  warn: Warn,
): string | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !valid(value.trim())) {
    warning(warn, `${setting} is invalid; telemetry remains disabled`);
    return undefined;
  }
  return value.trim();
}

function readNumber(
  envValue: string | undefined,
  jsonValue: unknown,
  fallback: number,
  min: number,
  max: number,
  setting: string,
  warn: Warn,
): number | undefined {
  const value: unknown = envValue !== undefined ? envValue : jsonValue;
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    warning(warn, `${setting} is invalid; telemetry remains disabled`);
    return undefined;
  }
  return parsed;
}

function readBaggageAllowlist(value: unknown, warn: Warn): string[] | undefined {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== "string" || !BAGGAGE_NAME.test(item) || item.length > 128)
  ) {
    warning(warn, "baggageAllowlist is invalid; telemetry remains disabled");
    return undefined;
  }
  return [...new Set(value as string[])];
}

/** Load validated personal telemetry config. No endpoint means no telemetry. */
export function loadConfig(
  agentDir: string,
  env: Env = process.env,
  warn: Warn = (message) => console.warn(message),
): TelemetryConfig | undefined {
  try {
    if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") return undefined;
    const json = readJson(agentDir, warn);
    const endpoint = getEndpoint(json, env, warn);
    if (!endpoint) return undefined;
    const protocol = getProtocol(json, env, warn);
    if (!protocol) return undefined;

    const headers = getHeaders(json, env, warn);
    if (!headers) return undefined;
    const url = new URL(endpoint);
    const allowInsecure = json?.allowInsecureHeaders === true;
    if (url.protocol === "http:" && Object.keys(headers).length > 0 && !allowInsecure && !isLoopback(url.hostname)) {
      warning(warn, "export headers over HTTP require a loopback endpoint or allowInsecureHeaders");
      return undefined;
    }

    const serviceName = readString(
      env.OTEL_SERVICE_NAME !== undefined ? env.OTEL_SERVICE_NAME : json?.serviceName,
      "pi",
      (value) => value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value),
      "serviceName",
      warn,
    );
    const sampleRatio = readNumber(env.PI_OTEL_SAMPLE_RATIO, json?.sampleRatio, 1, 0, 1, "sampleRatio", warn);
    const shutdownTimeoutMs = readNumber(undefined, json?.shutdownTimeoutMs, 3000, 1, MAX_SHUTDOWN_TIMEOUT_MS, "shutdownTimeoutMs", warn);
    const baggageAllowlist = readBaggageAllowlist(json?.baggageAllowlist, warn);
    if (serviceName === undefined || sampleRatio === undefined || shutdownTimeoutMs === undefined || baggageAllowlist === undefined) {
      return undefined;
    }
    return { endpoint, headers, serviceName, sampleRatio, shutdownTimeoutMs, baggageAllowlist, protocol };
  } catch {
    warning(warn, "configuration could not be loaded; telemetry remains disabled");
    return undefined;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}
