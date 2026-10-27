/**
 * Status Tracker Extension
 *
 * Maintains a STATUS.md file in the project root that the agent keeps updated
 * with the current goal, step progress, unknowns, and discovered issues.
 *
 * - Creates STATUS.md from a template if it doesn't exist
 * - Injects its contents into the LLM context on every turn
 * - Appends status-tracking instructions to the system prompt
 * - Checks at agent_end whether STATUS.md was modified; if not, sends a
 *   follow-up reminder (once per turn — no infinite loops)
 * - Shows a condensed live widget above the editor
 * - Registers /status to display the full file and toggle tracking on/off
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_FILE = "STATUS.md";

const STATUS_TEMPLATE = `# Status

## Current Goal
<!-- Describe the current task or objective here -->

## Steps & Progress
<!-- List every identified step; check them off as they are completed -->
- [ ] (no steps identified yet)

## Unknowns
<!-- Things that still need investigation or clarification -->
- (none)

## Discovered Issues
<!-- Problems encountered during the work -->
- (none)
`;

/**
 * Extra instructions appended to the system prompt on every agent turn.
 * They tell the model why STATUS.md exists and when/how to update it.
 */
const SYSTEM_PROMPT_ADDITION = `
## STATUS.md — Work-State Tracker

A file called STATUS.md lives in the project root. It is your persistent memory
across turns. **You must update STATUS.md at the end of every response** to keep
it accurate. The file tracks:

- **Current Goal** — the overarching task or objective.
- **Steps & Progress** — every identified step, checked off as completed.
- **Unknowns** — things still needing investigation or clarification.
- **Discovered Issues** — problems found during the work.

Rules:
1. Read the existing STATUS.md at the start of each turn (it is provided below).
2. After completing your work for a turn, rewrite STATUS.md with the latest state.
3. Keep entries concise — bullet points are preferred.
4. Never delete the four sections; add "(none)" when a section is empty.
`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function statusPath(cwd: string): string {
  return join(cwd, STATUS_FILE);
}

async function readStatus(cwd: string): Promise<string | null> {
  try {
    return await readFile(statusPath(cwd), "utf8");
  } catch {
    return null;
  }
}

async function getMtime(cwd: string): Promise<number | null> {
  try {
    const s = await stat(statusPath(cwd));
    return s.mtimeMs;
  } catch {
    return null;
  }
}

async function ensureStatusFile(cwd: string): Promise<void> {
  if ((await readStatus(cwd)) === null) {
    await writeFile(statusPath(cwd), STATUS_TEMPLATE, "utf8");
  }
}

/**
 * Builds a single footer status-bar string from STATUS.md content.
 * Format:  STATUS.md  <goal>  <done>/<total> steps
 */
function buildStatusLine(content: string, theme: Theme): string {
  const lines = content.split("\n");
  const goalIdx = lines.findIndex((l) => l.startsWith("## Current Goal"));
  const stepsIdx = lines.findIndex((l) => l.startsWith("## Steps"));

  // First non-empty, non-comment body line after the heading
  let goal: string | null = null;
  if (goalIdx !== -1) {
    for (let i = goalIdx + 1; i < lines.length && i < goalIdx + 6; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("<!--") && !line.startsWith("##")) {
        goal = line.replace(/^<!--.*?-->$/, "").trim() || null;
        break;
      }
    }
  }

  // Count steps and how many are done
  let total = 0;
  let done = 0;
  if (stepsIdx !== -1) {
    for (let i = stepsIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("## ")) break;
      if (line.startsWith("- [")) {
        if (line.includes("(no steps identified yet)")) continue;
        total++;
        if (line.startsWith("- [x]") || line.startsWith("- [X]")) done++;
      }
    }
  }

  if (!goal) {
    return theme.fg("dim", "STATUS.md active");
  }

  const allDone = total > 0 && done === total;
  const stepColor = allDone ? "success" : "accent";
  const stepInfo = total > 0 ? `${done}/${total}` : "–";

  return (
    theme.fg("dim", "STATUS.md ") +
    theme.fg("text", goal) +
    theme.fg("dim", "  ") +
    theme.fg(stepColor, stepInfo + " steps")
  );
}

// ─── title helpers ───────────────────────────────────────────────────────────

const MAX_GOAL_LEN = 50;

/** Extract the goal text from STATUS.md content. Returns null when absent. */
function extractGoal(content: string): string | null {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("## Current Goal"));
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length && i < idx + 6; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith("<!--") && !line.startsWith("##")) {
      const cleaned = line.replace(/^<!--.*?-->$/, "").trim();
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** Count checked / total steps in STATUS.md content. */
function countSteps(content: string): { done: number; total: number } {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("## Steps"));
  let total = 0;
  let done = 0;
  if (idx !== -1) {
    for (let i = idx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("## ")) break;
      if (line.startsWith("- [")) {
        if (line.includes("(no steps identified yet)")) continue;
        total++;
        if (line.startsWith("- [x]") || line.startsWith("- [X]")) done++;
      }
    }
  }
  return { done, total };
}

/**
 * Build a terminal title from STATUS.md content.
 * Shows cwd + truncated goal + step progress.
 * Falls back to just cwd when no goal is set.
 */
function buildTitle(content: string | null): string {
  const cwd = basename(process.cwd());
  if (!content) return `π - ${cwd}`;

  const goal = extractGoal(content);
  if (!goal) return `π - ${cwd}`;

  const short = goal.length > MAX_GOAL_LEN ? goal.slice(0, MAX_GOAL_LEN - 1) + "…" : goal;
  const { done, total } = countSteps(content);
  const stepInfo = total > 0 ? ` · ${done}/${total}` : "";

  return `π - ${cwd} · ${short}${stepInfo}`;
}

// ─── extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Subagents get PI_SUBAGENT=1 in their env. Disable status tracking entirely
  // to prevent conflicts with the parent's STATUS.md and UI widgets.
  if (process.env.PI_SUBAGENT === "1") {
    return;
  }

  // Tracking is enabled by default to preserve the extension's existing behavior.
  // `/status` remains available for viewing STATUS.md even when tracking is off.
  let statusEnabled = true;

  // mtime of STATUS.md captured just before each agent turn
  let mtimeBeforeAgent: number | null = null;

  // Prevents chaining multiple consecutive reminders
  let justReminded = false;

  // ── session_start: bootstrap file + initial widget ─────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    await ensureStatusFile(ctx.cwd);

    const content = await readStatus(ctx.cwd);
    if (content !== null) {
      ctx.ui.setStatus("status-tracker", buildStatusLine(content, ctx.ui.theme));
    } else {
      ctx.ui.setStatus("status-tracker", ctx.ui.theme.fg("dim", "STATUS.md active"));
    }
    ctx.ui.setTitle(buildTitle(content));
  });

  // ── before_agent_start: snapshot mtime + inject context ───────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    if (!statusEnabled) return;

    await ensureStatusFile(ctx.cwd);
    mtimeBeforeAgent = await getMtime(ctx.cwd);

    const content = await readStatus(ctx.cwd);
    const statusBlock = content
      ? `Current STATUS.md:\n\n${content}`
      : "STATUS.md does not exist yet — you should create it now.";

    return {
      // Append tracking instructions to the system prompt
      systemPrompt: event.systemPrompt + SYSTEM_PROMPT_ADDITION,

      // Inject the file contents into the LLM context (hidden from the chat UI)
      message: {
        customType: "status-tracker-context",
        content: statusBlock,
        display: false,
      },
    };
  });

  // ── agent_end: verify STATUS.md was updated; remind if not ─────────────────
  pi.on("agent_end", async (event, ctx) => {
    if (!statusEnabled) {
      mtimeBeforeAgent = null;
      justReminded = false;
      return;
    }

    // Never chain reminders back-to-back
    if (justReminded) {
      justReminded = false;
      return;
    }

    // Check if the agent was aborted (user cancelled)
    const wasAborted = event.messages.some(
      (msg) => msg.role === "assistant" && (msg as { stopReason?: string }).stopReason === "aborted",
    );

    if (wasAborted) {
      console.log("[status-tracker] Agent was aborted — skipping reminder");
    }

    const mtimeAfter = await getMtime(ctx.cwd);

    // Refresh the status bar regardless
    const content = await readStatus(ctx.cwd);
    if (content !== null) {
      ctx.ui.setStatus("status-tracker", buildStatusLine(content, ctx.ui.theme));
    }
    ctx.ui.setTitle(buildTitle(content));

    // Skip the reminder if the agent was aborted
    if (wasAborted) {
      mtimeBeforeAgent = null;
      return;
    }

    const wasUpdated =
      mtimeAfter !== null &&
      (mtimeBeforeAgent === null || mtimeAfter > mtimeBeforeAgent);

    if (!wasUpdated) {
      justReminded = true;
      ctx.ui.notify("STATUS.md was not updated this turn — asking agent to fix that.", "warning");
      pi.sendUserMessage(
        "You did not update STATUS.md at the end of your last response. " +
          "Please update it now to accurately reflect the current goal, " +
          "step progress (check off anything completed), current unknowns, " +
          "and any newly discovered issues.",
        { deliverAs: "steer" },
      );
    }

    mtimeBeforeAgent = null;
  });

  // ── tool_result: live-update title + status bar when STATUS.md is written ──
  pi.on("tool_result", async (event, ctx) => {
    if (!statusEnabled) return;

    const fileName =
      event.toolName === "write" || event.toolName === "edit"
        ? (event.input as { path?: string }).path
        : undefined;
    if (!fileName || !fileName.endsWith(STATUS_FILE)) return;

    const content = await readStatus(ctx.cwd);
    if (content !== null) {
      ctx.ui.setStatus("status-tracker", buildStatusLine(content, ctx.ui.theme));
    }
    ctx.ui.setTitle(buildTitle(content));
  });

  // ── session_shutdown: clear widget / status ────────────────────────────────
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("status-tracker", undefined);
    ctx.ui.setTitle(`π - ${basename(ctx.cwd)}`);
  });

  // ── /status command: floating modal overlay ────────────────────────────────
  pi.registerCommand("status", {
    description:
      "Show STATUS.md or toggle status tracking. Usage: /status | /status [on|off|status]",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on" || arg === "off") {
        const enable = arg === "on";
        if (enable === statusEnabled) {
          ctx.ui.notify(`Status tracking is already ${enable ? "ON" : "OFF"}.`, "info");
          return;
        }

        statusEnabled = enable;
        if (enable) {
          await ensureStatusFile(ctx.cwd);
          const content = await readStatus(ctx.cwd);
          if (content !== null) {
            ctx.ui.setStatus("status-tracker", buildStatusLine(content, ctx.ui.theme));
          }
          ctx.ui.setTitle(buildTitle(content));
          ctx.ui.notify("Status tracking ON.", "info");
        } else {
          mtimeBeforeAgent = null;
          justReminded = false;
          ctx.ui.setStatus("status-tracker", undefined);
          ctx.ui.setTitle(`π - ${basename(ctx.cwd)}`);
          ctx.ui.notify("Status tracking OFF.", "info");
        }
        return;
      }

      if (arg === "status") {
        ctx.ui.notify(
          statusEnabled ? "Status tracking is currently ON." : "Status tracking is currently OFF.",
          "info",
        );
        return;
      }

      if (arg) {
        ctx.ui.notify(`Unknown argument "${arg}". Usage: /status [on|off|status]`, "error");
        return;
      }

      const content = await readStatus(ctx.cwd);
      if (!content) {
        ctx.ui.notify("STATUS.md not found in " + ctx.cwd, "warning");
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          const modal = new StatusModal(content, theme, done);
          return {
            render: (w: number) => modal.render(w),
            invalidate: () => modal.invalidate(),
            handleInput: (data: string) => {
              modal.handleInput(data);
              tui.requestRender();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "72%",
            minWidth: 60,
          },
        },
      );
    },
  });

  // ── /status-reset command: overwrite with blank template ──────────────────
  pi.registerCommand("status-reset", {
    description: "Reset STATUS.md to the blank template",
    handler: async (_args, ctx) => {
      const ok = await ctx.ui.confirm(
        "Reset STATUS.md?",
        "This will overwrite STATUS.md with the blank template. Continue?",
      );
      if (!ok) return;
      await writeFile(statusPath(ctx.cwd), STATUS_TEMPLATE, "utf8");
      if (statusEnabled) {
        ctx.ui.setStatus("status-tracker", buildStatusLine(STATUS_TEMPLATE, ctx.ui.theme));
        ctx.ui.setTitle(buildTitle(STATUS_TEMPLATE));
      }
      ctx.ui.notify("STATUS.md has been reset.", "success");
    },
  });
}

// ─── StatusModal ──────────────────────────────────────────────────────────────

/**
 * Number of content lines visible in the modal at once.
 * Borders + footer add 3 lines on top of this.
 */
const VIEWPORT_H = 22;

/**
 * Floating overlay that renders STATUS.md as styled markdown with scrolling.
 *
 * Layout:
 *   ╭── STATUS.md ─────────────────────────────╮
 *   │ (rendered markdown lines, one per row)   │
 *   │ ...                                      │
 *   ╰── ↑↓/PgUp/PgDn · esc ─────── [5-26/42] ─╯
 */
class StatusModal {
  private scrollOffset = 0;
  private allLines: string[] | null = null;
  private cachedInnerW = -1;

  constructor(
    private readonly content: string,
    private readonly theme: Theme,
    private readonly done: () => void,
  ) {}

  // ── input ────────────────────────────────────────────────────────────────

  handleInput(data: string): void {
    const maxScroll = Math.max(0, (this.allLines?.length ?? 0) - VIEWPORT_H);

    if (matchesKey(data, "escape") || data === "q") {
      this.done();
    } else if (matchesKey(data, "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, "down")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
    } else if (matchesKey(data, "pageup")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - VIEWPORT_H);
    } else if (matchesKey(data, "pagedown")) {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + VIEWPORT_H);
    } else if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
    } else if (matchesKey(data, "end")) {
      this.scrollOffset = maxScroll;
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  render(width: number): string[] {
    const th = this.theme;
    // Inner width excludes the two side-border characters (│ ... │)
    const innerW = width - 2;

    // Render full markdown once (or when width changes)
    if (this.cachedInnerW !== innerW || this.allLines === null) {
      const md = new Markdown(this.content, 1, 0, getMarkdownTheme());
      this.allLines = md.render(innerW);
      this.cachedInnerW = innerW;
      // Re-clamp scroll after content re-render
      const maxScroll = Math.max(0, this.allLines.length - VIEWPORT_H);
      this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
    }

    const all = this.allLines;
    const total = all.length;
    const maxScroll = Math.max(0, total - VIEWPORT_H);
    this.scrollOffset = Math.min(this.scrollOffset, maxScroll);

    const lines: string[] = [];

    // ── top border ──────────────────────────────────────────────────────────
    const rawTitle = " STATUS.md ";
    const titleStyled = th.fg("accent", rawTitle);
    const titleW = visibleWidth(rawTitle);
    const leftDashes = Math.floor((innerW - titleW) / 2);
    const rightDashes = Math.max(0, innerW - titleW - leftDashes);
    lines.push(
      th.fg("border", "╭" + "─".repeat(leftDashes)) +
        titleStyled +
        th.fg("border", "─".repeat(rightDashes) + "╮"),
    );

    // ── content rows ────────────────────────────────────────────────────────
    const viewSlice = all.slice(this.scrollOffset, this.scrollOffset + VIEWPORT_H);
    // Pad to full viewport height so the modal doesn't shrink when near the end
    while (viewSlice.length < VIEWPORT_H) {
      viewSlice.push("");
    }

    for (const raw of viewSlice) {
      // Pad to innerW (respecting existing ANSI styling in the line)
      const vw = visibleWidth(raw);
      const padded = raw + " ".repeat(Math.max(0, innerW - vw));
      lines.push(th.fg("border", "│") + truncateToWidth(padded, innerW) + th.fg("border", "│"));
    }

    // ── bottom border with help + scroll position ────────────────────────────
    const helpText = " ↑↓/PgUp/PgDn scroll · esc close ";
    const scrollText =
      total <= VIEWPORT_H
        ? ""
        : ` [${this.scrollOffset + 1}–${Math.min(this.scrollOffset + VIEWPORT_H, total)}/${total}] `;

    const helpStyled = th.fg("dim", helpText);
    const scrollStyled = scrollText ? th.fg("muted", scrollText) : "";
    const footerVisW = visibleWidth(helpText) + visibleWidth(scrollText);
    const fillDashes = Math.max(0, innerW - footerVisW);

    lines.push(
      th.fg("border", "╰" + "─".repeat(Math.floor(fillDashes / 2))) +
        helpStyled +
        th.fg("border", "─".repeat(Math.ceil(fillDashes / 2))) +
        scrollStyled +
        th.fg("border", "╯"),
    );

    return lines;
  }

  // ── invalidate (called on theme change) ──────────────────────────────────

  invalidate(): void {
    // Discard cached markdown lines so they're re-rendered with the new theme
    this.allLines = null;
    this.cachedInnerW = -1;
  }
}
