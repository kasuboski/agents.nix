import { afterEach, test } from "node:test";
import { expect } from "./test-assertions.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "./config.ts";

const dirs: string[] = [];

async function makeAgentDir(config?: unknown): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-otel-config-"));
  dirs.push(dir);
  if (config !== undefined) {
    await fs.promises.mkdir(path.join(dir, "extensions"), { recursive: true });
    await fs.promises.writeFile(path.join(dir, "extensions", "telemetry.json"), JSON.stringify(config));
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

test("is inert without an endpoint and when OTEL_SDK_DISABLED is true", async () => {
  const dir = await makeAgentDir({ serviceName: "test" });
  expect(loadConfig(dir, {})).toBeUndefined();
  expect(loadConfig(dir, { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" })).toBeUndefined();
  expect(loadConfig(dir, { PI_OTEL_ENDPOINT: "https://collector.example/v1/traces", OTEL_SDK_DISABLED: "true" })).toBeUndefined();
});

test("loads personal JSON config with validated defaults", async () => {
  const dir = await makeAgentDir({ endpoint: "http://collector.local:4318/v1/traces", baggageAllowlist: ["gen_ai.conversation.id"] });
  expect(loadConfig(dir, {})).toEqual({
    endpoint: "http://collector.local:4318/v1/traces",
    headers: {},
    serviceName: "pi",
    sampleRatio: 1,
    shutdownTimeoutMs: 3000,
    baggageAllowlist: ["gen_ai.conversation.id"],
    protocol: "http/json",
  });
});

test("applies endpoint precedence and appends generic OTLP path only", async () => {
  const dir = await makeAgentDir({ endpoint: "https://json.example/trace" });
  expect(loadConfig(dir, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/v1/traces", OTEL_EXPORTER_OTLP_ENDPOINT: "https://generic.example" })?.endpoint)
    .toBe("https://json.example/trace");
  expect(loadConfig(dir, { PI_OTEL_ENDPOINT: "https://pi.example/export", OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example" })?.endpoint)
    .toBe("https://pi.example/export");
  const envOnlyDir = await makeAgentDir();
  expect(loadConfig(envOnlyDir, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/v1/traces", OTEL_EXPORTER_OTLP_ENDPOINT: "https://generic.example" })?.endpoint)
    .toBe("https://traces.example/v1/traces");
  expect(loadConfig(envOnlyDir, { OTEL_EXPORTER_OTLP_ENDPOINT: "https://generic.example/base/" })?.endpoint)
    .toBe("https://generic.example/base/v1/traces");
  expect(loadConfig(envOnlyDir, { OTEL_EXPORTER_OTLP_ENDPOINT: "https://generic.example/base/?route=traces" })?.endpoint)
    .toBe("https://generic.example/base/v1/traces?route=traces");
});

test("an invalid selected endpoint warns safely and does not fall back", async () => {
  const secret = "https://user:password@invalid.example/?token=secret";
  const dir = await makeAgentDir({ endpoint: secret });
  const warnings: string[] = [];
  expect(loadConfig(dir, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://fallback.example/v1/traces" }, (message) => warnings.push(message))).toBeUndefined();
  expect(warnings.join(" ")).not.toContain("password");
  expect(warnings.join(" ")).not.toContain("secret");

  const malformedJsonDir = await makeAgentDir({ endpoint: 42 });
  expect(loadConfig(malformedJsonDir, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://fallback.example/v1/traces" }, (message) => warnings.push(message))).toBeUndefined();
});

test("uses standard export header precedence and percent-decodes values", async () => {
  const dir = await makeAgentDir({ endpoint: "https://collector.example/v1/traces" });
  const config = loadConfig(dir, {
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=Bearer%20abc%2B123,X-Test=a%2Cb",
    OTEL_EXPORTER_OTLP_HEADERS: "Ignored=value",
  });
  expect(config?.headers).toEqual({ Authorization: "Bearer abc+123", "X-Test": "a,b" });
  expect(loadConfig(dir, {
    PI_OTEL_HEADERS: "X-Override=pi",
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: "X-Override=signal",
  })?.headers).toEqual({ "X-Override": "pi" });
});

test("protects every header over remote HTTP unless explicitly opted in", async () => {
  const dir = await makeAgentDir({ endpoint: "http://localhost:4318/v1/traces", headersFromEnv: "MY_EXPORT_HEADERS" });
  expect(loadConfig(dir, { MY_EXPORT_HEADERS: "Authorization=secret" })?.headers).toEqual({ Authorization: "secret" });

  const remoteDir = await makeAgentDir({ endpoint: "http://collector.example/v1/traces", headersFromEnv: "MY_EXPORT_HEADERS" });
  const warns: string[] = [];
  for (const value of ["Authorization=secret", "X-Trace-Mode=compact"]) {
    expect(loadConfig(remoteDir, { MY_EXPORT_HEADERS: value }, (message) => warns.push(message))).toBeUndefined();
    expect(warns.join(" ")).not.toContain(value);
  }

  const optedInDir = await makeAgentDir({ endpoint: "http://collector.example/v1/traces", headersFromEnv: "MY_EXPORT_HEADERS", allowInsecureHeaders: true });
  expect(loadConfig(optedInDir, { MY_EXPORT_HEADERS: "Authorization=secret" })?.headers).toEqual({ Authorization: "secret" });
});

test("rejects malformed header encoding and CRLF injection without exposing values", async () => {
  const dir = await makeAgentDir({ endpoint: "https://collector.example/v1/traces" });
  for (const value of ["Authorization=%GG", "X-Test=ok%0d%0aInjected%3Ayes"]) {
    const warnings: string[] = [];
    expect(loadConfig(dir, { PI_OTEL_HEADERS: value }, (message) => warnings.push(message))).toBeUndefined();
    expect(warnings.join(" ")).not.toContain(value);
  }
});

test("rejects malformed JSON without exposing parser details", async () => {
  const dir = await makeAgentDir();
  await fs.promises.mkdir(path.join(dir, "extensions"), { recursive: true });
  const file = path.join(dir, "extensions", "telemetry.json");
  await fs.promises.writeFile(file, '{"endpoint":"https://private.example/?token=secret",');
  const warnings: string[] = [];
  expect(loadConfig(dir, {}, (message) => warnings.push(message))).toBeUndefined();
  expect(warnings.join(" ")).not.toContain("private.example");
  expect(warnings.join(" ")).not.toContain("secret");
  expect(warnings.join(" ")).not.toContain("SyntaxError");

  await fs.promises.writeFile(file, "[]");
  expect(loadConfig(dir, {}, (message) => warnings.push(message))).toBeUndefined();
  expect(warnings.at(-1)).toContain("must be a JSON object");
});

test("accepts only HTTP JSON protocol from config and standard OTEL protocol variables", async () => {
  const dir = await makeAgentDir({ endpoint: "https://collector.example/v1/traces" });
  expect(loadConfig(dir, {})?.protocol).toBe("http/json");
  expect(loadConfig(dir, { OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" })?.protocol).toBe("http/json");
  expect(loadConfig(dir, { OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json", OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" })?.protocol)
    .toBe("http/json");
  for (const env of [
    { OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf" },
    { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
    { OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "grpc" },
  ]) {
    expect(loadConfig(dir, env)).toBeUndefined();
  }
  expect(loadConfig(await makeAgentDir({ endpoint: "https://collector.example/v1/traces", protocol: "grpc" }), {})).toBeUndefined();
});

test("validates protocol, sampling, timeout, service name, and baggage allowlist", async () => {
  const dir = await makeAgentDir({ endpoint: "https://collector.example/v1/traces", sampleRatio: 0.5, shutdownTimeoutMs: 10, serviceName: "my-pi", baggageAllowlist: ["session.id"] });
  expect(loadConfig(dir, { PI_OTEL_SAMPLE_RATIO: "0" })?.sampleRatio).toBe(0);
  expect(loadConfig(dir, {})?.shutdownTimeoutMs).toBe(10);
  for (const env of [{ PI_OTEL_SAMPLE_RATIO: "1.1" }, { PI_OTEL_SAMPLE_RATIO: "NaN" }]) {
    expect(loadConfig(dir, env)).toBeUndefined();
  }
  for (const config of [
    { endpoint: "https://collector.example/v1/traces", protocol: "grpc" },
    { endpoint: "https://collector.example/v1/traces", sampleRatio: -1 },
    { endpoint: "https://collector.example/v1/traces", shutdownTimeoutMs: 0 },
    { endpoint: "https://collector.example/v1/traces", baggageAllowlist: ["bad key"] },
    { endpoint: "https://collector.example/v1/traces", serviceName: "bad\nname" },
  ]) {
    expect(loadConfig(await makeAgentDir(config), {})).toBeUndefined();
  }
});
