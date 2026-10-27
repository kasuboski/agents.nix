/**
 * TinyFish Extension — web_search and web_fetch tools
 *
 * Provides two tools backed by the TinyFish Search and Fetch APIs.
 * Uses @tiny-fish/sdk which reads TINYFISH_API_KEY from the environment.
 *
 * - web_search: Find URLs and information via web search
 * - web_fetch: Render URLs with a real browser and extract clean content
 */

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TinyFish } from "@tiny-fish/sdk";

// ---------------------------------------------------------------------------
// Lazy SDK client singleton
// ---------------------------------------------------------------------------

let _client: TinyFish | null = null;

function getClient(): TinyFish {
	if (!_client) {
		if (!process.env.TINYFISH_API_KEY) {
			throw new Error(
				"TINYFISH_API_KEY environment variable is not set. " +
					"Get a key at https://agent.tinyfish.ai/api-keys",
			);
		}
		_client = new TinyFish();
	}
	return _client;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FETCH_TEXT_LENGTH = 50_000;
const TRUNCATION_MARKER = "\n\n[content truncated at 50,000 characters]";

// ---------------------------------------------------------------------------
// Tool parameter schemas (TypeBox)
// ---------------------------------------------------------------------------

const WebSearchParams = Type.Object({
	query: Type.String({
		description: "Search query. Supports operators: site:domain.com, -site:domain.com, quoted phrases",
	}),
	location: Type.Optional(
		Type.String({
			description: "Country code for geo-targeting (US, GB, FR, DE, JP, etc). Default: US",
		}),
	),
	language: Type.Optional(
		Type.String({
			description: "Language code for results (en, fr, de, ja, etc). Default: en",
		}),
	),
	num_results: Type.Optional(
		Type.Number({
			description: "Max results to return (1-10). Default: 10",
			minimum: 1,
			maximum: 10,
		}),
	),
});

const WebFetchParams = Type.Object({
	urls: Type.Array(Type.String({ description: "URL to fetch (http or https)" }), {
		description: "URLs to fetch and extract content from (1-10)",
		minItems: 1,
		maxItems: 10,
	}),
	format: Type.Optional(
		Type.String({
			description: 'Output format: "markdown" (default, best for LLMs), "html", "json"',
		}),
	),
	links: Type.Optional(
		Type.Boolean({
			description: "Include all hyperlinks found on the page. Default: false",
		}),
	),
	image_links: Type.Optional(
		Type.Boolean({
			description: "Include all image URLs found on the page. Default: false",
		}),
	),
});

// Parameter types inferred from schemas
type WebSearchInput = {
	query: string;
	location?: string;
	language?: string;
	num_results?: number;
};

type WebFetchInput = {
	urls: string[];
	format?: string;
	links?: boolean;
	image_links?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateText(text: string): string {
	if (text.length <= MAX_FETCH_TEXT_LENGTH) return text;
	return text.slice(0, MAX_FETCH_TEXT_LENGTH) + TRUNCATION_MARKER;
}

function formatSearchResults(
	query: string,
	results: Array<{ position: number; title: string; snippet: string; url: string }>,
	total: number,
): string {
	const lines: string[] = [`Found ${total} results for "${query}":\n`];
	for (const r of results) {
		lines.push(`${r.position}. ${r.title}`);
		lines.push(`   ${r.snippet}`);
		lines.push(`   ${r.url}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function formatFetchResults(
	results: Array<{
		url: string;
		final_url?: string | null;
		title?: string | null;
		description?: string | null;
		text?: string | null;
		links?: string[];
		image_links?: string[];
	}>,
	errors: Array<{ url: string; error: string }>,
): string {
	const parts: string[] = [];

	for (const page of results) {
		const title = page.title || "(no title)";
		parts.push(`## ${title}`);
		parts.push(`URL: ${page.url}`);
		if (page.final_url && page.final_url !== page.url) {
			parts.push(`Redirected to: ${page.final_url}`);
		}
		if (page.description) {
			parts.push(`Description: ${page.description}`);
		}
		parts.push("");
		if (page.text) {
			const text = typeof page.text === "string" ? page.text : JSON.stringify(page.text, null, 2);
			parts.push(truncateText(text));
		} else {
			parts.push("(no content extracted)");
		}
		parts.push("");

		if (page.links && page.links.length > 0) {
			parts.push(
				`Links (${page.links.length}): ${page.links.slice(0, 20).join(", ")}${page.links.length > 20 ? " ..." : ""}`,
			);
		}
		if (page.image_links && page.image_links.length > 0) {
			parts.push(
				`Images (${page.image_links.length}): ${page.image_links.slice(0, 10).join(", ")}${page.image_links.length > 10 ? " ..." : ""}`,
			);
		}
		parts.push("---");
	}

	if (errors.length > 0) {
		parts.push("");
		parts.push("Failed URLs:");
		for (const err of errors) {
			parts.push(`  ${err.url}: ${err.error}`);
		}
	}

	return parts.join("\n").trimEnd();
}

function formatApiError(error: unknown): string {
	if (error && typeof error === "object" && "status" in error && "message" in error) {
		return `TinyFish API error (${(error as any).status}): ${(error as any).message}`;
	}
	if (error instanceof Error) {
		// Check for known patterns in the message
		const msg = error.message;
		if (msg.includes("401") || msg.includes("auth") || msg.includes("API key")) {
			return `TinyFish authentication failed: ${msg}. Check TINYFISH_API_KEY at https://agent.tinyfish.ai/api-keys`;
		}
		if (msg.includes("429") || msg.includes("rate")) {
			return `TinyFish rate limit exceeded: ${msg}. Search allows ~5 requests/minute. Wait and retry.`;
		}
		return msg;
	}
	return String(error);
}

function makeErrorResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
		// isError is recognized at runtime by the tool execution pipeline
	} as AgentToolResult<unknown> & { isError: true };
}

function makeResult(text: string, details: unknown = {}): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: [
			"Search the web and return ranked results with titles, snippets, and URLs.",
			"Use this to discover pages and information. Supports search operators: site: to limit results to a domain, -site: to exclude domains.",
			"Does not consume credits. Rate limited to ~5 requests/minute.",
			"For getting actual page content from URLs, use web_fetch instead.",
		].join(" "),
		parameters: WebSearchParams,

		async execute(_toolCallId, params, signal) {
			const p = params as WebSearchInput;
			if (signal?.aborted) return makeResult("Aborted before search started.");

			let client: TinyFish;
			try {
				client = getClient();
			} catch (err) {
				return makeErrorResult(formatApiError(err));
			}

			try {
				const response = await client.search.query({
					query: p.query,
					location: p.location,
					language: p.language,
				});

				if (signal?.aborted) return makeResult("Aborted after search completed.");

				let results = response.results;
				if (p.num_results && p.num_results < results.length) {
					results = results.slice(0, p.num_results);
				}

				if (results.length === 0) {
					return makeResult(`No results found for "${p.query}".`);
				}

				const text = formatSearchResults(p.query, results, response.total_results);
				return makeResult(text, response);
			} catch (err) {
				return makeErrorResult(`Search failed: ${formatApiError(err)}`);
			}
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: [
			"Fetch and extract clean content from one or more URLs using a real browser (JavaScript is fully executed).",
			"Returns page title, description, and extracted text in your chosen format.",
			"Supports 1-10 URLs per call. Markdown format (default) is best for readability.",
			"Does not consume credits.",
			"Use web_search first if you need to discover relevant URLs.",
		].join(" "),
		parameters: WebFetchParams,

		async execute(_toolCallId, params, signal) {
			const p = params as WebFetchInput;
			if (signal?.aborted) return makeResult("Aborted before fetch started.");

			let client: TinyFish;
			try {
				client = getClient();
			} catch (err) {
				return makeErrorResult(formatApiError(err));
			}

			try {
				const response = await client.fetch.getContents({
					urls: p.urls,
					format: p.format as "markdown" | "html" | "json" | undefined,
					links: p.links,
					image_links: p.image_links,
				});

				if (signal?.aborted) return makeResult("Aborted after fetch completed.");

				// All URLs failed
				if (response.results.length === 0 && response.errors.length > 0) {
					const errorList = response.errors.map((e) => `${e.url}: ${e.error}`).join("\n");
					return makeErrorResult(`All URLs failed:\n${errorList}`);
				}

				const text = formatFetchResults(response.results as any[], response.errors);
				return makeResult(text, response);
			} catch (err) {
				return makeErrorResult(`Fetch failed: ${formatApiError(err)}`);
			}
		},
	});
}
