/**
 * MorphLLM Extension — Morph integrations for pi
 *
 * Three features (all gated on MORPH_API_KEY):
 *  - `/fast-compact` + `session_before_compact` hook: summarize via the Morph
 *    Compact API instead of the built-in LLM summarization.
 *  - `codebase_search` tool: agentic natural-language code search (Morph
 *    WarpGrep).
 *  - `/fast-apply` toggle (default OFF): when enabled, replaces the built-in
 *    `edit` tool with Morph Fast Apply (`edit_file`) — semantic edits that
 *    output only the changed lines using `// ... existing code ...` markers.
 *
 * API docs: https://docs.morphllm.com
 */

import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionCommandContext,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { MorphClient } from "@morphllm/morphsdk";
import {
	formatResult,
	WARP_GREP_DESCRIPTION,
	WARP_GREP_TOOL_NAME,
} from "@morphllm/morphsdk/tools/warp-grep";
import type { WarpGrepResult } from "@morphllm/morphsdk/tools/warp-grep";
import { EDIT_FILE_TOOL_DESCRIPTION } from "@morphllm/morphsdk/tools/fastapply";
import type { EditFileResult } from "@morphllm/morphsdk/tools/fastapply";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MORPH_API_URL = "https://api.morphllm.com/v1/compact";
const MAX_OUTPUT_LENGTH = 200_000;
const TRUNCATION_MARKER = "\n\n[compact output truncated at 200,000 characters]";

// ---------------------------------------------------------------------------
// Lazy API key resolution
// ---------------------------------------------------------------------------

function getApiKey(): string | undefined {
	return process.env.MORPH_API_KEY || undefined;
}

// ---------------------------------------------------------------------------
// Session message → Morph messages conversion
// ---------------------------------------------------------------------------

interface ChatMessage {
	role: string;
	content: string;
}

/**
 * Convert AgentMessage[] to simple {role, content} pairs for the Morph API.
 * Skips message types that don't carry text content.
 */
function convertMessages(messages: any[]): ChatMessage[] {
	const result: ChatMessage[] = [];

	for (const msg of messages) {
		const role = msg.role as string;
		if (!msg.content) continue;
		const text = extractTextFromContent(msg.content);
		if (text.trim()) {
			result.push({ role, content: text });
		}
	}

	return result;
}

/**
 * Extract plain text from various content shapes:
 *   - string → string
 *   - Array<{ type: "text", text: string }> → joined text
 */
function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part: any) => part.type === "text" && typeof part.text === "string")
			.map((part: any) => part.text)
			.join("\n");
	}
	return "";
}

// ---------------------------------------------------------------------------
// Morph Compact API call
// ---------------------------------------------------------------------------

interface CompactResponse {
	id: string;
	object: string;
	model: string;
	output: string;
	messages: Array<{
		role: string;
		content: string;
		compacted_line_ranges: Array<{ start: number; end: number }>;
		kept_line_ranges: Array<{ start: number; end: number }>;
	}>;
	usage: {
		input_tokens: number;
		output_tokens: number;
		compression_ratio: number;
		processing_time_ms: number;
	};
}

async function callCompactAPI(
	messages: ChatMessage[],
	query?: string,
	signal?: AbortSignal,
): Promise<CompactResponse> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("MORPH_API_KEY environment variable is not set.");
	}

	const body: Record<string, unknown> = { messages };
	if (query) body.query = query;

	const response = await fetch(MORPH_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		let detail = "";
		try {
			const parsed = JSON.parse(text);
			detail = parsed.error?.message || parsed.message || text;
		} catch {
			detail = text;
		}

		switch (response.status) {
			case 401:
				throw new Error(
					`Morph authentication failed (401): ${detail}. Check MORPH_API_KEY at https://morphllm.com/dashboard/api-keys`,
				);
			case 400:
				throw new Error(`Morph bad request (400): ${detail}`);
			case 503:
				throw new Error(`Morph model not loaded (503): ${detail}`);
			case 504:
				throw new Error(`Morph request timed out (504): ${detail}`);
			default:
				throw new Error(`Morph API error (${response.status}): ${detail}`);
		}
	}

	return (await response.json()) as CompactResponse;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function truncateText(text: string): string {
	if (text.length <= MAX_OUTPUT_LENGTH) return text;
	return text.slice(0, MAX_OUTPUT_LENGTH) + TRUNCATION_MARKER;
}

function formatSummary(data: CompactResponse): string {
	const usage = data.usage;
	const reduction = ((1 - usage.compression_ratio) * 100).toFixed(1);
	const lines: string[] = [];

	lines.push(
		`[Morph Compact: ${usage.input_tokens} → ${usage.output_tokens} tokens, ${reduction}% reduction, ${usage.processing_time_ms}ms]`,
	);
	lines.push("");
	lines.push(truncateText(data.output));

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Morph WarpGrep — codebase_search tool
// ---------------------------------------------------------------------------

/**
 * Description sent to the model. Built on the SDK's canonical WarpGrep
 * description plus two extra directives (always use full-English queries, and
 * prefer it for multi-file exploration) per Morph's integration guidance.
 */
const CODEBASE_SEARCH_DESCRIPTION =
	`${WARP_GREP_DESCRIPTION} ` +
	"You MUST talk to this tool in full, coherent English sentences. " +
	"When a task requires exploration beyond a single known file, ALWAYS default to the codebase_search tool before other search mechanisms.";

const CodebaseSearchParams = Type.Object({
	search_term: Type.String({
		description:
			"A targeted natural-language query describing what to find or accomplish " +
			'(e.g. "Find where authentication requests are handled in the Express routes"). ' +
			"Use full English sentences — NOT regex, keywords, or bare symbol names.",
	}),
});

// Lazy MorphClient singleton. MorphClient throws if constructed without an API
// key, so build it on first use (when getApiKey() is available) and rebuild if
// the key changes.
let _morphClient: MorphClient | null = null;
let _morphCachedKey: string | undefined;

function getMorphClient(): MorphClient | null {
	const key = getApiKey();
	if (!key) return null;
	if (!_morphClient || _morphCachedKey !== key) {
		_morphClient = new MorphClient({ apiKey: key });
		_morphCachedKey = key;
	}
	return _morphClient;
}

function makeToolResult(text: string, details: unknown = {}): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function makeToolError(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
		isError: true,
	} as AgentToolResult<unknown> & { isError: true };
}

function formatMorphError(error: unknown, label = "codebase_search"): string {
	const msg = error instanceof Error ? error.message : String(error);
	if (/\b401\b|unauthor|api[ _-]?key/i.test(msg)) {
		return `Morph authentication failed: ${msg}. Check MORPH_API_KEY at https://morphllm.com/dashboard/api-keys`;
	}
	if (/\b429\b|rate[ _-]?limit/i.test(msg)) {
		return `Morph rate limit hit: ${msg}. Wait and retry.`;
	}
	return `${label} failed: ${msg}`;
}

// ---------------------------------------------------------------------------
// Morph Fast Apply — `edit_file` tool (toggled on by /fast-apply)
// ---------------------------------------------------------------------------

/**
 * Tool name for Morph Fast Apply. The canonical `EDIT_FILE_TOOL_DESCRIPTION`
 * refers to "edit_file" throughout, so we keep this exact name to stay
 * consistent with the description text and the model's training.
 */
const FAST_APPLY_TOOL_NAME = "edit_file";
const FAST_APPLY_TOOL_LABEL = "Fast Apply Edit";

const FastApplyParams = Type.Object({
	target_filepath: Type.String({
		description: "Path of the file to modify, relative to the project root.",
	}),
	instructions: Type.String({
		description:
			"A single first-person sentence describing what you are changing, " +
			'to disambiguate the edit (e.g. "I am adding a null check before creating the session"). ' +
			"Generated by you, never hardcoded.",
	}),
	code_edit: Type.String({
		description:
			"Specify ONLY the precise lines to edit. Use `// ... existing code ...` markers for " +
			"every unchanged region — omitting the marker will DELETE those lines. Include minimal " +
			"surrounding context for disambiguation and preserve exact indentation. Batch all edits " +
			"to this file into this one call.",
	}),
});

/**
 * Format a successful Fast Apply result for the model: a one-line change
 * summary plus the unified diff so the model can verify what was applied.
 */
function formatFastApplyResult(result: EditFileResult): string {
	const c = result.changes;
	const summary =
		`Applied edit to ${result.filepath} via Morph Fast Apply ` +
		`(+${c.linesAdded} -${c.linesRemoved} ~${c.linesModified} lines).`;
	return result.udiff ? `${summary}\n\n${result.udiff}` : summary;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Flag: set by /fast-compact so the hook knows to use Morph instead of
	// letting pi fall through to built-in LLM summarization.
	let morphRequested = false;

	// Fast Apply toggle state. The edit_file tool is registered lazily on first
	// enable (registerTool auto-activates a new tool, so we cannot register it at
	// load time without breaking the default-off behavior). `editWasActive`
	// records whether the built-in `edit` tool was active before we replaced it,
	// so disabling restores the original activation state instead of always
	// forcing `edit` back on.
	let fastApplyEnabled = false;
	let fastApplyRegistered = false;
	let editWasActive: boolean | null = null;

	// ── Hook into compaction: use Morph API only when /fast-compact triggers it ─
	pi.on("session_before_compact", async (event: SessionBeforeCompactEvent) => {
		// Only intercept when /fast-compact explicitly requested Morph
		if (!morphRequested) return;
		morphRequested = false; // Consume the flag

		if (!getApiKey()) return;

		const { preparation, customInstructions, signal } = event;

		try {
			const messages = convertMessages(preparation.messagesToSummarize);

			if (messages.length === 0) return;

			const result = await callCompactAPI(messages, customInstructions, signal);

			const summary = formatSummary(result);

			return {
				compaction: {
					summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					details: {
						backend: "morph-compact",
						usage: result.usage,
					},
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[morphllm] Compact failed, falling back to built-in:", message);
			// Return undefined → let pi use built-in LLM summarization
		}
	});

	// ── /fast-compact command: trigger compaction via Morph ─────────────────────
	pi.registerCommand("fast-compact", {
		description:
			"Compact current session using Morph Compact API. Usage: /fast-compact [focus query]",

		async handler(args: string, ctx: ExtensionCommandContext) {
			const query = args.trim() || undefined;

			if (!getApiKey()) {
				ctx.ui.notify(
					"MORPH_API_KEY not set. Get a key at https://morphllm.com/dashboard/api-keys",
					"error",
				);
				return;
			}

			// Set flag so our session_before_compact hook intercepts with Morph
			morphRequested = true;

			ctx.compact({
				customInstructions: query,
				onComplete: () => {
					ctx.ui.notify("Morph compact complete.", "info");
				},
				onError: (error: Error) => {
					ctx.ui.notify(`Compact failed: ${error.message}`, "error");
				},
			});
		},
	});

	// ── codebase_search tool: agentic natural-language code search ─────────────
	// Spins up a Morph WarpGrep sub-agent that runs ripgrep + file reads in its
	// own context window and returns relevant code snippets. Input is plain
	// English, NOT regex.
	pi.registerTool({
		name: WARP_GREP_TOOL_NAME, // "codebase_search" — see tool-name rule above
		label: "Codebase Search",
		description: CODEBASE_SEARCH_DESCRIPTION,
		promptSnippet:
			"Agentic natural-language code search across the codebase (Morph WarpGrep)",
		promptGuidelines: [
			"Use codebase_search to explore unfamiliar code, find implementations across multiple files, or understand how a feature works before changing it.",
			"Use codebase_search at the START of an exploration task to orient yourself, then follow up with read/grep for targeted lookups.",
			'codebase_search takes plain English describing what you are looking for (e.g. "Find the authentication middleware"), NOT regex or bare symbol names — use grep directly for exact pattern or symbol matches.',
			"Prefer codebase_search over grep/read when you do not already know the exact file or when the task spans multiple files.",
		],
		parameters: CodebaseSearchParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const searchTerm =
				((params as { search_term?: string }).search_term ?? "").trim();
			if (!searchTerm) {
				throw new Error(
					"search_term is required: a natural-language description of what to find.",
				);
			}
			if (signal?.aborted) {
				return makeToolResult("Search cancelled before it started.");
			}

			const client = getMorphClient();
			if (!client) {
				throw new Error(
					"MORPH_API_KEY is not set. Get a key at https://morphllm.com/dashboard/api-keys",
				);
			}

			onUpdate?.({
				content: [{ type: "text", text: "Searching codebase via Morph WarpGrep…" }],
				details: {},
			});

			let result: WarpGrepResult;
			try {
				result = await client.warpGrep.execute({
					searchTerm,
					repoRoot: ctx.cwd,
				});
			} catch (err) {
				return makeToolError(formatMorphError(err));
			}

			if (signal?.aborted) {
				return makeToolResult("Search cancelled after completing.");
			}

			const files = result.contexts ?? [];
			const formatted = formatResult(result);
			const details = {
				success: result.success,
				fileCount: files.length,
				files: files.map((c) => c.file),
				summary: result.summary,
				error: result.error,
			};

			if (!result.success) {
				// Flag as a tool error so the agent accounts for the failure, while still
				// passing the formatted reason (formatResult already says "Search failed:")
				// and the structured details. A successful search with zero matches is NOT
				// an error — it returns normally with "No relevant code found.".
				return {
					content: [{ type: "text", text: formatted }],
					details,
					isError: true,
				} as AgentToolResult<unknown> & { isError: true };
			}

			return { content: [{ type: "text", text: formatted }], details };
		},
	});

	// ── Morph Fast Apply: edit_file tool + /fast-apply toggle ───────────────────
	// Registers the edit_file tool (lazy, first enable only) and the /fast-apply
	// command. When enabled, the built-in `edit` tool is deactivated and
	// edit_file is activated in its place; setActiveTools rebuilds the system
	// prompt so the tool and its guidelines appear/disappear with the toggle.
	const registerFastApplyTool = () => {
		pi.registerTool({
			name: FAST_APPLY_TOOL_NAME,
			label: FAST_APPLY_TOOL_LABEL,
			description: EDIT_FILE_TOOL_DESCRIPTION,
			promptSnippet:
				"Semantic edits to existing files via Morph Fast Apply — output only the changed lines using // ... existing code ... markers",
			promptGuidelines: [
				"Use edit_file to modify existing files instead of rewriting whole files — output only the changed lines.",
				"In edit_file, mark EVERY unchanged region with `// ... existing code ...`; omitting the marker deletes those lines. Preserve exact indentation.",
				"Batch all edits to a single file into one edit_file call.",
				"For every edit_file call, write a first-person `instructions` sentence describing what you are changing.",
			],
			parameters: FastApplyParams,

			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				const p = params as {
					target_filepath?: string;
					instructions?: string;
					code_edit?: string;
				};
				const targetFilepath = (p.target_filepath ?? "").trim();
				const instructions = (p.instructions ?? "").trim();
				const codeEdit = p.code_edit ?? "";

				if (!targetFilepath) {
					throw new Error("target_filepath is required: the file to modify.");
				}
				if (!codeEdit.trim()) {
					throw new Error(
						"code_edit is required: the changed lines with `// ... existing code ...` markers.",
					);
				}
				if (signal?.aborted) {
					return makeToolResult("Edit cancelled before it started.");
				}

				const client = getMorphClient();
				if (!client) {
					throw new Error(
						"MORPH_API_KEY is not set. Get a key at https://morphllm.com/dashboard/api-keys",
					);
				}

				onUpdate?.({
					content: [
						{ type: "text", text: `Applying edit via Morph Fast Apply to ${targetFilepath}…` },
					],
					details: {},
				});

				let result: EditFileResult;
				try {
					// The SDK reads, merges, and writes the file itself, resolving
					// target_filepath against baseDir (= the agent's cwd). `instruction`
					// (singular) is the current field; `instructions` is deprecated.
					result = await client.fastApply.execute(
						{
							target_filepath: targetFilepath,
							instruction: instructions,
							code_edit: codeEdit,
						},
						{ baseDir: ctx.cwd },
					);
				} catch (err) {
					return makeToolError(formatMorphError(err, "Fast Apply"));
				}

				if (signal?.aborted) {
					return makeToolResult("Edit applied, then cancelled.");
				}

				const details = {
					success: result.success,
					filepath: result.filepath,
					changes: result.changes,
					completionId: result.completionId,
					error: result.error,
				};

				if (!result.success) {
					return {
						content: [
							{
								type: "text",
								text: `Fast Apply failed: ${result.error ?? "unknown error"}`,
							},
						],
						details,
						isError: true,
					} as AgentToolResult<unknown> & { isError: true };
				}

				return {
					content: [{ type: "text", text: formatFastApplyResult(result) }],
					details,
				};
			},
		});
	};

	pi.registerCommand("fast-apply", {
		description:
			"Toggle Morph Fast Apply edit mode (default off). When on, replaces the built-in edit tool with Morph's semantic edit_file. Usage: /fast-apply [on|off|status]",

		async handler(args: string, ctx: ExtensionCommandContext) {
			const arg = args.trim().toLowerCase();
			let enable: boolean;
			if (arg === "on") {
				enable = true;
			} else if (arg === "off") {
				enable = false;
			} else if (arg === "status") {
				ctx.ui.notify(
					fastApplyEnabled
						? "Morph Fast Apply is currently ON."
						: "Morph Fast Apply is currently OFF.",
					"info",
				);
				return;
			} else if (arg === "") {
				// Bare "/fast-apply" → toggle.
				enable = !fastApplyEnabled;
			} else {
				ctx.ui.notify(
					`Unknown argument "${arg}". Usage: /fast-apply [on|off|status]`,
					"error",
				);
				return;
			}

			if (enable === fastApplyEnabled) {
				ctx.ui.notify(`Morph Fast Apply is already ${enable ? "ON" : "OFF"}.`, "info");
				return;
			}

			if (enable) {
				// Key check belongs on the ON path only — off/status must work without
				// a key (e.g. to recover after the key is removed).
				if (!getApiKey()) {
					ctx.ui.notify(
						"MORPH_API_KEY not set. Get a key at https://morphllm.com/dashboard/api-keys",
						"error",
					);
					return;
				}
				if (!fastApplyRegistered) {
					registerFastApplyTool();
					fastApplyRegistered = true;
				}
				const current = pi.getActiveTools();
				editWasActive = current.includes("edit");
				pi.setActiveTools(
					Array.from(
						new Set([...current.filter((t) => t !== "edit"), FAST_APPLY_TOOL_NAME]),
					),
				);
				fastApplyEnabled = true;
				ctx.ui.notify("Morph Fast Apply ON — edit replaced with edit_file.", "info");
			} else {
				const current = pi.getActiveTools();
				const restored = editWasActive
					? Array.from(
							new Set([...current.filter((t) => t !== FAST_APPLY_TOOL_NAME), "edit"]),
						)
					: current.filter((t) => t !== FAST_APPLY_TOOL_NAME);
				pi.setActiveTools(restored);
				fastApplyEnabled = false;
				ctx.ui.notify(
					editWasActive
						? "Morph Fast Apply OFF — built-in edit restored."
						: "Morph Fast Apply OFF — Fast Apply disabled.",
					"info",
				);
				editWasActive = null;
			}
		},
	});
}
