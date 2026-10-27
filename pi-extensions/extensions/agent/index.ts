/**
 * Agent Tool — Spawn a subagent with an isolated context window
 *
 * Spawns a separate `pi` process, giving it an isolated context window.
 * The subagent works autonomously, then returns a single text result.
 * Override the system prompt, model, tools, and thinking level as needed.
 *
 * Sets PI_SUBAGENT=1 in the child environment so extensions (like
 * status-tracker) can detect they're running inside a subagent.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  getMarkdownTheme,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { hasAgentSettled } from "./lifecycle.ts";
import { BackgroundRegistry, type BackgroundJob, type BackgroundRunOptions } from "./registry.ts";

const COLLAPSED_ITEM_COUNT = 10;
const LIFECYCLE_EXTENSION_PATH = fileURLToPath(
  new URL("./lifecycle.ts", import.meta.url),
);

// ─── formatting helpers ───────────────────────────────────────────────────────

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens?: number;
    turns?: number;
  },
  model?: string,
): string {
  const parts: string[] = [];
  if (usage.turns)
    parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg: (color: any, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview =
        command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = themeFg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += themeFg(
          "warning",
          `:${startLine}${endLine ? `-${endLine}` : ""}`,
        );
      }
      return themeFg("muted", "read ") + text;
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = themeFg("muted", "write ") + themeFg("accent", filePath);
      if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return (
        themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
      );
    }
    case "ls": {
      const rawPath = (args.path || ".") as string;
      return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
    }
    case "find": {
      const pattern = (args.pattern || "*") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "find ") +
        themeFg("accent", pattern) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    case "grep": {
      const pattern = (args.pattern || "") as string;
      const rawPath = (args.path || ".") as string;
      return (
        themeFg("muted", "grep ") +
        themeFg("accent", `/${pattern}/`) +
        themeFg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview =
        argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
    }
  }
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface AgentResult {
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

interface AgentDetails {
  result: AgentResult;
}

export function updateAgentResult(result: AgentResult, msg: Message): void {
  result.messages.push(msg);

  if (msg.role !== "assistant") return;

  result.usage.turns++;
  const usage = msg.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }
  if (!result.model && msg.model) result.model = msg.model;
  if (msg.stopReason) result.stopReason = msg.stopReason;
  result.errorMessage = msg.errorMessage;
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall")
          items.push({
            type: "toolCall",
            name: part.name,
            args: part.arguments,
          });
      }
    }
  }
  return items;
}

// ─── temp file for system prompt ──────────────────────────────────────────────

async function writePromptToTempFile(
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-agent-"));
  const filePath = path.join(tmpDir, "system-prompt.md");
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, {
      encoding: "utf-8",
      mode: 0o600,
    });
  });
  return { dir: tmpDir, filePath };
}

// ─── pi invocation ────────────────────────────────────────────────────────────

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

// ─── agent execution ──────────────────────────────────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function spawnAndCapture(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", (code) =>
      resolve({ exitCode: code ?? 0, stdout, stderr }),
    );
    proc.on("error", (error) =>
      resolve({ exitCode: 1, stdout, stderr: String(error) }),
    );
  });
}

// ─── inherited resource flags ────────────────────────────────────────────────
//
// pi is frequently launched with explicit resource paths and auto-discovery
// disabled — e.g. the nix `pi-ext` wrapper or this repo's `dev.sh`:
//   pi --no-extensions --no-skills --no-themes -e <path> --skill <path> ...
// The agent extension spawns a fresh `pi` child that otherwise re-runs
// auto-discovery and would miss those explicitly-loaded resources. Under the
// nix wrapper the bundle lives in the Nix store (not a discovery location) and
// PI_OFFLINE forbids downloading, so the child would silently lose every
// bundled extension/skill/theme — and with them commands like /fast-*.
//
// Forward the parent's resource flags so the child loads the same bundle.
// Only resource-loading flags are inherited; per-call overrides (model,
// thinking, tools, system prompt) come from the agent tool params instead.

const RESOURCE_VALUE_FLAGS = new Set([
  "-e",
  "--extension",
  "--skill",
  "--theme",
]);
const RESOURCE_BOOLEAN_FLAGS = new Set([
  "--no-extensions",
  "--no-skills",
  "--no-themes",
]);

function collectResourceFlags(argv: string[]): string[] {
  const flags: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (RESOURCE_BOOLEAN_FLAGS.has(arg)) {
      flags.push(arg);
      continue;
    }
    if (RESOURCE_VALUE_FLAGS.has(arg)) {
      // Space-separated form: `-e <path>`
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.push(arg, next);
        i++;
      }
      continue;
    }
    // `--flag=value` form for value flags: `--extension=<path>`
    const eq = arg.indexOf("=");
    if (eq > 0 && RESOURCE_VALUE_FLAGS.has(arg.slice(0, eq))) {
      flags.push(arg);
    }
  }
  return flags;
}

// process.argv = [<runtime>, <script>, ...pi args]. Computed once at load.
const inheritedResourceFlags = collectResourceFlags(process.argv.slice(2));

async function waitForBackgroundJob(job: BackgroundJob, signal?: AbortSignal): Promise<void> {
  if (!signal) return job.completion;
  if (signal.aborted) throw new Error("Wait aborted; the agent continues running.");
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new Error("Wait aborted; the agent continues running."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    job.completion.then(() => {
      cleanup();
      resolve();
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function runAgent(
  defaultCwd: string,
  params: {
    prompt: string;
    background?: boolean;
    foreground?: boolean;
    runDir?: string;
    childSessionId?: string;
    onHerdrCreated?: (tabId: string, paneId: string, sessionId: string) => void;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    model?: string;
    thinking?: string;
    tools?: string[];
    excludeTools?: string[];
    cwd?: string;
  },
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<AgentDetails>) => void) | undefined,
): Promise<AgentResult> {
  // Base flags are always the first 4 entries — the herdr path drops them via
  // args.slice(4), so anything appended below (inherited resources, per-call
  // overrides, prompt) carries over to the interactive child unchanged.
  const args: string[] = [
    "--mode",
    "json",
    "-p",
    ...(params.background ? [] : ["--no-session"]),
    ...inheritedResourceFlags,
  ];

  if (params.model) args.push("--model", params.model);
  if (params.thinking) args.push("--thinking", params.thinking);
  if (params.tools && params.tools.length > 0)
    args.push("--tools", params.tools.join(","));
  if (params.excludeTools && params.excludeTools.length > 0) {
    args.push("--exclude-tools", params.excludeTools.join(","));
  }

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  const result: AgentResult = {
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
  };

  const emitUpdate = () => {
    if (onUpdate) {
      onUpdate({
        content: [
          {
            type: "text",
            text: getFinalOutput(result.messages) || "(running...)",
          },
        ],
        details: { result },
      });
    }
  };

  try {
    if (params.systemPrompt && params.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(params.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--system-prompt", tmpPromptPath);
    }

    if (params.appendSystemPrompt && params.appendSystemPrompt.trim()) {
      args.push("--append-system-prompt", params.appendSystemPrompt);
    }

    args.push(params.prompt);

    let wasAborted = false;
    let buffer = "";

    const recordMessage = (msg: Message) => {
      updateAgentResult(result, msg);
      emitUpdate();
    };

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type === "message_end" && event.message) {
        recordMessage(event.message as Message);
      }

      if (event.type === "tool_result_end" && event.message) {
        recordMessage(event.message as Message);
      }
    };

    const processChunk = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    };

    const flushBuffer = () => {
      if (buffer.trim()) processLine(buffer);
      buffer = "";
    };

    const invocation = getPiInvocation(args);
    const cwd = params.cwd ?? defaultCwd;

    const runNative = async (): Promise<number> => {
      return await new Promise<number>((resolve) => {
        const nativeArgs = params.background
          ? [
              ...invocation.args.slice(0, -1),
              "--session-dir", params.runDir!,
              "--session-id", params.childSessionId!,
              invocation.args[invocation.args.length - 1],
            ]
          : invocation.args;
        const proc = spawn(invocation.command, nativeArgs, {
          cwd,
          env: { ...process.env, PI_SUBAGENT: "1" },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let abortHandler: (() => void) | undefined;
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (code: number) => {
          if (forceKillTimer) clearTimeout(forceKillTimer);
          if (signal && abortHandler) {
            signal.removeEventListener("abort", abortHandler);
          }
          resolve(code);
        };

        proc.stdout.on("data", (data) => processChunk(data.toString()));

        proc.stderr.on("data", (data) => {
          result.stderr += data.toString();
        });

        proc.on("close", (code) => {
          flushBuffer();
          finish(code ?? 0);
        });

        proc.on("error", () => {
          finish(1);
        });

        if (signal) {
          abortHandler = () => {
            wasAborted = true;
            proc.kill("SIGTERM");
            forceKillTimer = setTimeout(() => {
              if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
            }, 5000);
            forceKillTimer.unref?.();
          };
          if (signal.aborted) abortHandler();
          else signal.addEventListener("abort", abortHandler, { once: true });
        }
      });
    };

    const findHerdrWorkspaceId = async (): Promise<string | undefined> => {
      if (process.env.HERDR_WORKSPACE_ID) return process.env.HERDR_WORKSPACE_ID;
      const currentPaneId = process.env.HERDR_PANE_ID;
      const panes = await spawnAndCapture("herdr", ["pane", "list"], {
        env: process.env,
      });
      if (panes.exitCode !== 0) return undefined;
      try {
        const payload = JSON.parse(panes.stdout);
        const paneList = payload?.result?.panes ?? [];
        const current = currentPaneId
          ? paneList.find((pane: any) => pane.pane_id === currentPaneId)
          : undefined;
        if (current?.workspace_id) return current.workspace_id;
        const focused = paneList.find((pane: any) => pane.focused);
        return focused?.workspace_id;
      } catch {
        return undefined;
      }
    };

    const parseExitCode = (text: string): number => {
      const trimmed = text.trim();
      if (!/^-?\d+$/.test(trimmed)) return 1;
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : 1;
    };

    const runHerdr = async (): Promise<number> => {
      const runDir = params.background && params.runDir
        ? params.runDir
        : await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-herdr-agent-"));
      const stderrPath = path.join(runDir, "stderr.log");
      const exitPath = path.join(runDir, "exit-code");
      const settledPath = path.join(runDir, "agent-settled");
      const runScriptPath = path.join(runDir, "run-agent.sh");
      if (params.background) {
        await Promise.all([stderrPath, exitPath, settledPath].map((file) =>
          fs.promises.rm(file, { force: true }),
        ));
      }
      const sessionId = params.childSessionId ?? `agent-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      let tabId: string | undefined;
      let paneId: string | undefined;
      let sessionPath: string | undefined;
      let sessionReadOffset = 0;
      let sessionBuffer = "";
      let quitSent = false;
      let abortHandler: (() => void) | undefined;

      const cleanupRunDir = async () => {
        try {
          await fs.promises.rm(runDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      };

      const fallbackNative = async (): Promise<number> => {
        if (!params.background) await cleanupRunDir();
        return await runNative();
      };

      const findSessionPath = async (): Promise<string | undefined> => {
        if (sessionPath) return sessionPath;
        try {
          const files = await fs.promises.readdir(runDir);
          const match = files.find((file) =>
            file.endsWith(`_${sessionId}.jsonl`),
          );
          if (!match) return undefined;
          sessionPath = path.join(runDir, match);
          return sessionPath;
        } catch {
          return undefined;
        }
      };

      const processSessionChunk = (chunk: string, flush = false) => {
        sessionBuffer += chunk;
        const lines = sessionBuffer.split("\n");
        sessionBuffer = flush ? "" : lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "message" && event.message) {
            const msg = event.message as Message;
            if (msg.role === "assistant" || msg.role === "toolResult") {
              recordMessage(msg);
            }
          }
        }
      };

      const pollSession = async () => {
        const file = await findSessionPath();
        if (!file) return;
        let sessionText = "";
        try {
          sessionText = await fs.promises.readFile(file, "utf8");
        } catch {
          return;
        }
        if (sessionText.length > sessionReadOffset) {
          processSessionChunk(sessionText.slice(sessionReadOffset));
          sessionReadOffset = sessionText.length;
        }
      };

      const quoteArgs = (command: string, args: string[]) =>
        [command, ...args].map(shellQuote).join(" ");

      // A background rerun opens the same child session, but consumes only
      // entries appended by this run when reconstructing the result.
      if (params.background) {
        try {
          const files = await fs.promises.readdir(runDir);
          const existing = files.find((file) => file.endsWith(`_${sessionId}.jsonl`));
          if (existing) {
            sessionPath = path.join(runDir, existing);
            sessionReadOffset = (await fs.promises.readFile(sessionPath, "utf8")).length;
          }
        } catch {
          // First run: no session file exists yet.
        }
      }
      const interactiveArgs = [
        "--session-dir",
        runDir,
        "--session-id",
        sessionId,
        ...(inheritedResourceFlags.includes(LIFECYCLE_EXTENSION_PATH)
          ? []
          : ["--extension", LIFECYCLE_EXTENSION_PATH]),
        ...args.slice(params.background ? 3 : 4),
      ];
      const herdrInvocation = getPiInvocation(interactiveArgs);
      const commandLine = quoteArgs(
        herdrInvocation.command,
        herdrInvocation.args,
      );
      const script = `#!/usr/bin/env bash
set +e
cd ${shellQuote(cwd)} || exit 1
export PI_SUBAGENT=1
export PI_AGENT_SETTLED_FILE=${shellQuote(settledPath)}
export PI_AGENT_SETTLED_SESSION_ID=${shellQuote(sessionId)}
${commandLine} 2>> ${shellQuote(stderrPath)}
code=$?
printf '%s' "$code" > ${shellQuote(exitPath)}
echo "Agent process exited with code $code."
`;
      await fs.promises.writeFile(runScriptPath, script, {
        encoding: "utf8",
        mode: 0o700,
      });

      const name = `agent ${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const createTabArgs = [
        "tab",
        "create",
        "--cwd",
        cwd,
        "--label",
        name,
        ...(params.foreground ? ["--focus"] : ["--no-focus"]),
        "--env",
        "PI_SUBAGENT=1",
      ];
      const workspaceId = await findHerdrWorkspaceId();
      if (workspaceId) createTabArgs.push("--workspace", workspaceId);

      const created = await spawnAndCapture("herdr", createTabArgs, {
        env: process.env,
      });
      if (created.exitCode !== 0) {
        result.stderr += created.stderr || created.stdout;
        return await fallbackNative();
      }

      try {
        const payload = JSON.parse(created.stdout);
        tabId = payload?.result?.tab?.tab_id;
        paneId = payload?.result?.root_pane?.pane_id;
      } catch {
        result.stderr += created.stdout;
        return await fallbackNative();
      }
      if (!paneId) {
        result.stderr += created.stdout;
        if (tabId) await spawnAndCapture("herdr", ["tab", "close", tabId]);
        return await fallbackNative();
      }

      params.onHerdrCreated?.(tabId!, paneId, sessionId);
      const started = await spawnAndCapture(
        "herdr",
        ["pane", "run", paneId, `bash ${shellQuote(runScriptPath)}`],
        { env: process.env },
      );
      if (started.exitCode !== 0) {
        result.stderr += started.stderr || started.stdout;
        if (tabId) await spawnAndCapture("herdr", ["tab", "close", tabId]);
        return await fallbackNative();
      }

      const abort = async () => {
        wasAborted = true;
        if (tabId) await spawnAndCapture("herdr", ["tab", "close", tabId]);
        else if (paneId)
          await spawnAndCapture("herdr", ["pane", "close", paneId]);
        if (!params.background) await cleanupRunDir();
      };
      if (signal) {
        if (signal.aborted) await abort();
        else {
          abortHandler = () => void abort();
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      }

      try {
        while (true) {
          if (wasAborted) return 1;
          await pollSession();

          const agentSettled = await hasAgentSettled(settledPath);
          if (agentSettled && paneId && !quitSent) {
            quitSent = true;
            await spawnAndCapture("herdr", [
              "pane",
              "send-text",
              paneId,
              "/quit",
            ]);
            await spawnAndCapture("herdr", [
              "pane",
              "send-keys",
              paneId,
              "Enter",
            ]);
          }

          try {
            const exitText = await fs.promises.readFile(exitPath, "utf8");
            await pollSession();
            if (sessionBuffer.trim()) processSessionChunk("", true);
            try {
              result.stderr += await fs.promises.readFile(stderrPath, "utf8");
            } catch {
              // ignore missing stderr
            }
            const exitCode = parseExitCode(exitText);
            const keepTabOpen =
              exitCode !== 0 ||
              result.stopReason === "error" ||
              Boolean(result.errorMessage);
            if (params.background && tabId) {
              await spawnAndCapture("herdr", ["tab", "close", tabId]);
            } else if (tabId && keepTabOpen) {
              await spawnAndCapture("herdr", [
                "tab",
                "rename",
                tabId,
                `${name} failed`,
              ]);
              result.stderr += `\nHerdr agent tab left open for inspection: ${tabId}\n`;
              result.stderr += `Herdr agent files left at: ${runDir}\n`;
            } else if (tabId) {
              await spawnAndCapture("herdr", ["tab", "close", tabId]);
            }
            if (!keepTabOpen && !params.background) await cleanupRunDir();
            return exitCode;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      } finally {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
      }
    };

    const exitCode = process.env.HERDR_ENV === "1"
      ? await runHerdr()
      : await runNative();

    result.exitCode = exitCode;
    if (wasAborted) throw new Error("Agent was aborted");
    return result;
  } finally {
    if (tmpPromptPath)
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    if (tmpPromptDir)
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
  }
}

// ─── schema ───────────────────────────────────────────────────────────────────

const AgentParams = Type.Object({
  action: Type.Optional(Type.Union([
    Type.Literal("spawn"),
    Type.Literal("run"),
    Type.Literal("wait"),
    Type.Literal("cancel"),
    Type.Literal("check"),
    Type.Literal("list"),
    Type.Literal("foreground"),
    Type.Literal("restart"),
  ], { description: "Omit or use spawn to start a background agent; run waits synchronously." })),
  prompt: Type.Optional(Type.String({ description: "Task for the agent (required for spawn, run, and restart)" })),
  id: Type.Optional(Type.String({ description: "Agent ID for check, foreground, cancel, wait, or restart" })),
  ids: Type.Optional(Type.Array(Type.String(), { maxItems: 64, description: "Agent IDs for wait or cancel" })),
  systemPrompt: Type.Optional(Type.String({ description: "Full system prompt override" })),
  appendSystemPrompt: Type.Optional(Type.String({ description: "Text appended to the default system prompt" })),
  model: Type.Optional(Type.String({ description: "Model pattern or ID such as provider/model" })),
  thinking: Type.Optional(Type.String({ description: "Thinking level: off, minimal, low, medium, high, xhigh" })),
  tools: Type.Optional(Type.Array(Type.String(), { description: "Allowlist of tool names to enable" })),
  excludeTools: Type.Optional(Type.Array(Type.String(), { description: "Tools to exclude" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

// ─── extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const registry = new BackgroundRegistry();
  let activeOwner: string | undefined;
  let activeContext: any;
  const pendingResults = new Map<string, string>();
  const sessionId = (ctx: any) => ctx.sessionManager.getSessionId();
  const flushResults = (owner: string) => {
    if (activeOwner !== owner) return;
    for (const [id, text] of pendingResults) {
      const job = registry.get(owner, id);
      if (!job || !registry.claimDelivery(id)) {
        pendingResults.delete(id);
        continue;
      }
      try {
        pi.sendUserMessage(text, { deliverAs: "followUp" });
        pendingResults.delete(id);
        persist(activeContext);
      } catch {
        registry.releaseDelivery(id);
      }
    }
  };
  const persist = (ctx: any) => {
    try {
      pi.appendEntry("agent_jobs", { jobs: registry.snapshot(sessionId(ctx)) });
    } catch {
      // The session may already be shutting down.
    }
  };
  pi.on("session_start", async (_event, ctx) => {
    const owner = sessionId(ctx);
    activeOwner = owner;
    activeContext = ctx;
    let latestSnapshot: any;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "agent_jobs") latestSnapshot = entry;
    }
    if (latestSnapshot) registry.restore(owner, latestSnapshot.data?.jobs ?? []);
    for (const job of registry.list(owner)) {
      if (job.status !== "running" && !job.consumed && !job.delivered) {
        const output = job.result ? getFinalOutput(job.result.messages) : "(agent process ended before a result was recorded)";
        pendingResults.set(job.id, `Background agent ${job.id} ${job.status}: ${output || "(no output)"}`);
      }
    }
    if (ctx.isIdle?.()) flushResults(owner);
  });
  pi.on("agent_settled", async (_event, ctx) => flushResults(sessionId(ctx)));
  pi.on("session_shutdown", async (_event, ctx) => {
    const owner = sessionId(ctx);
    await registry.cancelOwner(owner);
    persist(ctx);
    for (const job of registry.list(owner)) pendingResults.delete(job.id);
    if (activeOwner === owner) {
      activeOwner = undefined;
      activeContext = undefined;
    }
  });

  const launch = (job: BackgroundJob, ctx: any) => {
    const sessionDir = ctx.sessionManager.getSessionDir?.();
    const runDir = job.runDir ?? (sessionDir
      ? path.join(sessionDir, "background-agents", job.id)
      : path.join(os.tmpdir(), `pi-agent-background-${job.id}`));
    const childSessionId = job.childSessionId ?? `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    job.runDir = runDir;
    job.childSessionId = childSessionId;
    persist(ctx);
    job.runner = fs.promises.mkdir(runDir, { recursive: true })
      .then(() => runAgent(job.cwd || ctx.cwd, {
        ...job.options,
        prompt: job.prompt,
        background: true,
        runDir,
        childSessionId,
        onHerdrCreated: (tabId, paneId, session) => {
          job.tabId = tabId;
          job.paneId = paneId;
          job.childSessionId = session;
          persist(ctx);
        },
      }, job.controller.signal, (partial) => {
        const result = partial.details?.result;
        if (result) job.result = result;
      }))
      .then((result) => {
        job.tabId = undefined;
        job.paneId = undefined;
        registry.settle(job.id,
          job.controller.signal.aborted ? "cancelled" : result.exitCode === 0 && result.stopReason !== "error" ? "completed" : "failed",
          result,
        );
        pendingResults.set(job.id, `Background agent ${job.id} ${job.status}: ${getFinalOutput(result.messages) || "(no output)"}`);
        if (activeContext?.isIdle?.()) flushResults(job.sessionId);
        persist(ctx);
      }, () => {
        registry.settle(job.id, job.controller.signal.aborted ? "cancelled" : "failed");
        pendingResults.set(job.id, `Background agent ${job.id} ${job.status}.`);
        if (activeContext?.isIdle?.()) flushResults(job.sessionId);
        persist(ctx);
      });
  };

  const foregroundJob = async (job: BackgroundJob, ctx: any): Promise<boolean> => {
    if (process.env.HERDR_ENV !== "1") return false;
    if (job.status === "running" && job.tabId) {
      const focused = await spawnAndCapture("herdr", ["tab", "focus", job.tabId], { env: process.env });
      return focused.exitCode === 0;
    }
    if (!job.runDir || !job.childSessionId) return false;
    const created = await spawnAndCapture("herdr", [
      "tab", "create", "--cwd", job.cwd || ctx.cwd,
      "--label", `agent ${job.id}`,
      "--focus", "--env", "PI_SUBAGENT=1",
      ...(process.env.HERDR_WORKSPACE_ID ? ["--workspace", process.env.HERDR_WORKSPACE_ID] : []),
    ], { env: process.env });
    if (created.exitCode !== 0) return false;
    let tabId: string | undefined;
    let paneId: string | undefined;
    try {
      const payload = JSON.parse(created.stdout);
      tabId = payload?.result?.tab?.tab_id;
      paneId = payload?.result?.root_pane?.pane_id;
    } catch {
      return false;
    }
    if (!tabId || !paneId) {
      if (tabId) await spawnAndCapture("herdr", ["tab", "close", tabId], { env: process.env });
      return false;
    }
    const args = ["--session-dir", job.runDir, "--session-id", job.childSessionId, ...inheritedResourceFlags];
    const invocation = getPiInvocation(args);
    const commandLine = [invocation.command, ...invocation.args].map(shellQuote).join(" ");
    const started = await spawnAndCapture("herdr", ["pane", "run", paneId, commandLine], { env: process.env });
    if (started.exitCode !== 0) {
      await spawnAndCapture("herdr", ["tab", "close", tabId], { env: process.env });
      return false;
    }
    job.tabId = tabId;
    job.paneId = paneId;
    persist(ctx);
    return true;
  };

  pi.registerCommand("agents", {
    description: "List and foreground background pi agents",
    handler: async (args, ctx) => {
      const jobs = registry.list(sessionId(ctx));
      const requestedId = args.trim();
      const target = requestedId ? registry.get(sessionId(ctx), requestedId) : jobs.find((job) => job.status === "running" && job.tabId);
      if (target && await foregroundJob(target, ctx)) return;
      const text = target
        ? `${target.id}: ${target.status}\n${target.result ? getFinalOutput(target.result.messages) : "(no output yet)"}`
        : jobs.map((job) => `${job.id}: ${job.status}`).join("\n") || "No background agents.";
      if (ctx.hasUI) ctx.ui.notify(text, "info");
    },
  });

  const executeBackgroundAction = async (params: Static<typeof AgentParams>, signal: AbortSignal | undefined, ctx: any) => {
      const action = params.action ?? "spawn";
      const owner = sessionId(ctx);
      const owned = registry.list(owner);
      const textResult = (text: string, isError = false) => ({
        content: [{ type: "text" as const, text }],
        details: undefined,
        ...(isError ? { isError: true } : {}),
      });
      const options: BackgroundRunOptions = {};
      if (params.systemPrompt !== undefined) options.systemPrompt = params.systemPrompt;
      if (params.appendSystemPrompt !== undefined) options.appendSystemPrompt = params.appendSystemPrompt;
      if (params.model !== undefined) options.model = params.model;
      if (params.thinking !== undefined) options.thinking = params.thinking;
      if (params.tools !== undefined) options.tools = params.tools;
      if (params.excludeTools !== undefined) options.excludeTools = params.excludeTools;
      if (action === "spawn") {
        if (!params.prompt?.trim()) return textResult("spawn requires prompt", true);
        const jobs = registry.list(owner);
        const oldestSettled = jobs.length >= 64 ? jobs.find((entry) => entry.status !== "running") : undefined;
        const job = registry.create(owner, params.prompt, params.cwd ?? ctx.cwd, options);
        if (!job) return textResult("Maximum of 8 running background agents reached.", true);
        if (oldestSettled?.runDir && !registry.get(owner, oldestSettled.id)) {
          await fs.promises.rm(oldestSettled.runDir, { recursive: true, force: true });
        }
        launch(job, ctx);
        return textResult(`Started background agent ${job.id}`);
      }

      if (action === "list") {
        return textResult(owned.map((item) => `${item.id}: ${item.status}`).join("\n") || "No background agents.");
      }
      const requestedIds: string[] = [...new Set<string>(params.ids ?? (params.id ? [params.id] : []))];
      if (action === "wait" || action === "cancel") {
        if (requestedIds.length === 0) return textResult(`${action} requires id or ids.`, true);
        const jobs = requestedIds.map((id) => registry.get(owner, id));
        if (jobs.some((job) => !job)) return textResult("One or more background agents were not found in this session.", true);
        const targets = jobs as BackgroundJob[];
        if (action === "wait") {
          await Promise.all(targets.map((job) => waitForBackgroundJob(job, signal)));
          for (const job of targets) {
            registry.consume(job.id);
            pendingResults.delete(job.id);
          }
          persist(ctx);
        } else {
          const reports: string[] = [];
          await Promise.all(targets.map(async (job) => {
            const wasRunning = job.status === "running";
            registry.consume(job.id);
            pendingResults.delete(job.id);
            if (wasRunning) {
              await registry.cancel(job, async () => {
                if (job.tabId && process.env.HERDR_ENV === "1") {
                  await spawnAndCapture("herdr", ["tab", "close", job.tabId], { env: process.env });
                }
              });
            }
            reports.push(wasRunning ? `Cancelled ${job.id}` : `${job.id} was already ${job.status}.`);
          }));
          persist(ctx);
          return textResult(reports.join("\n"));
        }
        return textResult(targets.map((job) => `${job.id}: ${job.status}\n${job.result ? getFinalOutput(job.result.messages) : "(no output)"}`).join("\n\n---\n\n"));
      }
      const job = params.id ? registry.get(owner, params.id) : undefined;
      if (!job) return textResult("This action requires a valid background agent id.", true);
      if (action === "restart") {
        if (!params.prompt?.trim()) return textResult("restart requires a prompt", true);
        const restarted = registry.restart(owner, job!.id, params.prompt, options);
        if (!restarted) return textResult("Agent cannot be restarted (it may still be running, have no saved session, or the running limit is reached).", true);
        launch(restarted, ctx);
        return textResult(`Restarted ${restarted.id} in its saved pi session.`);
      }
      if (action === "foreground") {
        if (await foregroundJob(job!, ctx)) return textResult(`Foregrounded ${job!.id}.`);
        const output = job!.result ? getFinalOutput(job!.result.messages) : "(no output yet)";
        const text = `${job!.id}: ${job!.status}\n${output}`;
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        return textResult(text);
      }
      const output = job.result ? getFinalOutput(job.result.messages) : "(no output yet)";
      return textResult(`${job.id}: ${job.status}\n${output}`);
  };

  pi.registerTool({
    name: "agent",
    label: "Agent",
    description: [
      "Manage isolated Pi agents. By default, spawn a background agent and use its ID with wait, check, cancel, foreground, or restart; use list to see this session's agents.",
      "Use action=run for the original synchronous one-shot behavior. Spawned agents accept the same model, thinking, tools, system prompt, and working-directory overrides.",
    ].join(" "),
    parameters: AgentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (params.action !== "run") {
        return await executeBackgroundAction(params, signal, ctx);
      }
      if (!params.prompt?.trim()) {
        return {
          content: [{ type: "text", text: "run requires a prompt" }],
          details: undefined,
          isError: true,
        };
      }
      const result = await runAgent(ctx.cwd, {
        prompt: params.prompt,
        systemPrompt: params.systemPrompt,
        appendSystemPrompt: params.appendSystemPrompt,
        model: params.model,
        thinking: params.thinking,
        tools: params.tools,
        excludeTools: params.excludeTools,
        cwd: params.cwd,
      }, signal, onUpdate);

      const isError =
        result.exitCode !== 0 ||
        result.stopReason === "error" ||
        result.stopReason === "aborted";
      if (isError) {
        const errorMsg =
          result.errorMessage ||
          result.stderr ||
          getFinalOutput(result.messages) ||
          "(no output)";
        return {
          content: [
            {
              type: "text",
              text: `Agent ${result.stopReason || "failed"}: ${errorMsg}`,
            },
          ],
          details: { result },
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: getFinalOutput(result.messages) || "(no output)",
          },
        ],
        details: { result },
      };
    },

    renderCall(args, theme, _context) {
      const parts: string[] = [];
      parts.push(theme.fg("toolTitle", theme.bold("agent ")));
      parts.push(theme.fg("muted", `[${args.action ?? "spawn"}]`));
      if (args.model) parts.push(theme.fg("accent", args.model));
      else parts.push(theme.fg("muted", "(default model)"));
      if (args.thinking)
        parts.push(theme.fg("dim", `thinking:${args.thinking}`));

      let text = parts.join(" ");

      const preview = args.prompt
        ? args.prompt.length > 60
          ? `${args.prompt.slice(0, 60)}...`
          : args.prompt
        : "...";
      text += `\n  ${theme.fg("dim", preview)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as AgentDetails | undefined;
      if (!details || details.result.messages.length === 0) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "(no output)",
          0,
          0,
        );
      }

      const r = details.result;
      const mdTheme = getMarkdownTheme();
      const isError =
        r.exitCode !== 0 ||
        r.stopReason === "error" ||
        r.stopReason === "aborted";
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      const displayItems = getDisplayItems(r.messages);
      const finalOutput = getFinalOutput(r.messages);

      const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
        const toShow = limit ? items.slice(-limit) : items;
        const skipped =
          limit && items.length > limit ? items.length - limit : 0;
        let text = "";
        if (skipped > 0)
          text += theme.fg("muted", `... ${skipped} earlier items\n`);
        for (const item of toShow) {
          if (item.type === "text") {
            const preview = expanded
              ? item.text
              : item.text.split("\n").slice(0, 3).join("\n");
            text += `${theme.fg("toolOutput", preview)}\n`;
          } else {
            text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
          }
        }
        return text.trimEnd();
      };

      if (expanded) {
        const container = new Container();
        let header = `${icon} ${theme.fg("toolTitle", theme.bold("agent"))}`;
        if (r.model) header += theme.fg("muted", ` (${r.model})`);
        if (isError && r.stopReason)
          header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
        container.addChild(new Text(header, 0, 0));
        if (isError && r.errorMessage)
          container.addChild(
            new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
          );
        container.addChild(new Spacer(1));

        container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
        if (displayItems.length === 0 && !finalOutput) {
          container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
        } else {
          for (const item of displayItems) {
            if (item.type === "toolCall")
              container.addChild(
                new Text(
                  theme.fg("muted", "→ ") +
                    formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                  0,
                  0,
                ),
              );
          }
          if (finalOutput) {
            container.addChild(new Spacer(1));
            container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
          }
        }

        const usageStr = formatUsageStats(r.usage, r.model);
        if (usageStr) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
        }
        return container;
      }

      // Collapsed view
      let text = `${icon} ${theme.fg("toolTitle", theme.bold("agent"))}`;
      if (r.model) text += theme.fg("muted", ` (${r.model})`);
      if (isError && r.stopReason)
        text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
      if (isError && r.errorMessage)
        text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
      else if (displayItems.length === 0)
        text += `\n${theme.fg("muted", "(no output)")}`;
      else {
        text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
        if (displayItems.length > COLLAPSED_ITEM_COUNT)
          text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
      }
      const usageStr = formatUsageStats(r.usage, r.model);
      if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
      return new Text(text, 0, 0);
    },
  });
}
