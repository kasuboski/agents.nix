/**
 * Aperture Extension — minimal dedicated provider for Tailscale Aperture
 *
 * Registers a standalone `aperture` provider whose model catalog comes from
 * `/v1/models`, optionally enriched by Aperture's `/api/providers` metadata.
 * Each model is routed through its compatible Pi API. Aperture injects
 * upstream credentials server-side, so no
 * API keys are stored.
 *
 * Deliberately minimal: no proxy mode, no connectors, no settings UI, no
 * onboarding. Configure via `APERTURE_URL` or
 * `~/.pi/agent/extensions/aperture.json` (`{"baseUrl": "..."}`), then
 * restart pi.
 *
 * Requires pi >= 0.84 (refreshModels `stored`/`publish` context).
 * Model discovery/caching patterns adapted from @aliou/pi-ts-aperture (MIT).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model,
	ModelsStoreEntry,
	RefreshModelsContext,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), ".pi/agent/extensions/aperture.json");

interface ApertureConfig {
	baseUrl?: string;
}

async function loadConfig(): Promise<ApertureConfig> {
	if (process.env.APERTURE_URL) return { baseUrl: process.env.APERTURE_URL };
	try {
		return JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ApertureConfig;
	} catch {
		return {};
	}
}

/** Normalize user input to a bare origin (`scheme://host[:port]`). */
function normalizeGatewayUrl(raw: string): string | null {
	let url = raw.trim();
	if (!url) return null;
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		url = `http://${url}`;
	}
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Aperture gateway client
// ---------------------------------------------------------------------------

interface GatewayProvider {
	id: string;
	name: string;
	models: string[];
	compatibility: Record<string, boolean | undefined>;
	/** Pricing per model id, from `/v1/models`. */
	pricingById: Partial<Record<string, Record<string, string | undefined>>>;
}

/** `/api/providers` body may be an array, `{providers: [...]}`, or a map. */
function parseProvidersBody(body: unknown): GatewayProvider[] {
	let list: unknown[] = [];
	if (Array.isArray(body)) {
		list = body;
	} else if (body && typeof body === "object") {
		const providers = (body as { providers?: unknown }).providers;
		if (Array.isArray(providers)) list = providers;
		else if (providers && typeof providers === "object") {
			list = Object.entries(providers as Record<string, unknown>).map(
				([id, p]) => ({ ...(p as object), id }),
			);
		}
	}
	return list.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const r = entry as Record<string, unknown>;
		const id = typeof r.id === "string" ? r.id : null;
		if (!id) return [];
		const models = Array.isArray(r.models)
			? r.models.filter((m): m is string => typeof m === "string")
			: [];
		return [
			{
				id,
				name: typeof r.name === "string" ? r.name : id,
				models,
				compatibility:
					r.compatibility && typeof r.compatibility === "object"
						? (r.compatibility as Record<string, boolean | undefined>)
						: {},
				pricingById: {},
			},
		];
	});
}

/** Gateway client: bundles the base URL with the endpoints that use it. */
class GatewayClient {
	constructor(private readonly baseUrl: string) {}

	private async fetchJson<T>(
		path: string,
		signal?: AbortSignal,
	): Promise<T> {
		const timeout = AbortSignal.timeout(5000);
		const res = await fetch(`${this.baseUrl}${path}`, {
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (!res.ok) {
			throw new Error(
				`[aperture] GET ${path} -> ${res.status} ${res.statusText}`,
			);
		}
		return res.json() as Promise<T>;
	}

	/**
	 * `/v1/models` is the source of truth for callable models. Aperture's
	 * `/api/providers` adds compatibility metadata, but OpenAI-compatible
	 * proxies may not expose it; in that case classify OpenAI-owned models as
	 * Responses and all other models as chat completions.
	 */
	async providers(signal?: AbortSignal): Promise<GatewayProvider[]> {
		const [providersBody, modelsBody] = await Promise.all([
			this.fetchJson<unknown>("/api/providers", signal).catch(() => null),
			this.fetchJson<{ data?: unknown }>("/v1/models", signal),
		]);
		const listedModels =
			modelsBody && typeof modelsBody === "object" &&
				Array.isArray((modelsBody as { data?: unknown }).data)
				? ((modelsBody as { data: unknown[] }).data)
				: [];
		let providers = parseProvidersBody(providersBody);
		if (providers.length === 0) {
			const byOwner = new Map<string, GatewayProvider>();
			for (const entry of listedModels) {
				if (!entry || typeof entry !== "object") continue;
				const model = entry as Record<string, unknown>;
				if (typeof model.id !== "string") continue;
				const owner =
					typeof model.owned_by === "string" && model.owned_by.trim()
						? model.owned_by.trim()
						: "unknown";
				let provider = byOwner.get(owner);
				if (!provider) {
					provider = {
						id: owner,
						name: owner,
						models: [],
						compatibility:
							owner.toLowerCase() === "openai"
								? { openai_responses: true }
								: { openai_chat: true },
						pricingById: {},
					};
					byOwner.set(owner, provider);
				}
				provider.models.push(model.id);
			}
			providers = [...byOwner.values()];
		}

		const enabled = new Map<
			string,
			Record<string, string | undefined> | undefined
		>();
		if (modelsBody && typeof modelsBody === "object") {
			const data = (modelsBody as { data?: unknown }).data;
			if (Array.isArray(data)) {
				for (const entry of data) {
					if (!entry || typeof entry !== "object") continue;
					const r = entry as Record<string, unknown>;
					if (typeof r.id !== "string") continue;
					enabled.set(
						r.id,
						(r.pricing && typeof r.pricing === "object"
							? (r.pricing as Record<string, string | undefined>)
							: undefined),
					);
				}
			}
		}
		if (enabled.size === 0) return providers;

		return providers
			.map((p) => {
				const models = p.models.filter((id) => enabled.has(id));
				const pricingById: GatewayProvider["pricingById"] = {};
				for (const id of models) pricingById[id] = enabled.get(id);
				return { ...p, models, pricingById };
			})
			.filter((p) => p.models.length > 0);
	}
}

// ---------------------------------------------------------------------------
// Compatibility -> Pi API mapping
// ---------------------------------------------------------------------------

/** Compatibility flag → Pi API, in preference order (first true flag wins). */
const COMPAT_FLAG_APIS: ReadonlyArray<readonly [string, Api]> = [
	// Responses preferred over chat when both are offered: subscription-backed
	// providers (e.g. ChatGPT via litellm) advertise openai_chat but their
	// chat/completions translation is unreliable, while responses is native.
	["openai_responses", "openai-responses"],
	["openai_chat", "openai-completions"],
	["anthropic_messages", "anthropic-messages"],
	["gemini_generate_content", "google-generative-ai"],
	["google_generate_content", "google-vertex"],
	["bedrock_converse", "bedrock-converse-stream"],
];

function getApiForCompatibility(
	compatibility: Record<string, boolean | undefined>,
): Api {
	for (const [flag, api] of COMPAT_FLAG_APIS) {
		if (compatibility[flag] === true) return api;
	}
	return "openai-completions";
}

// ---------------------------------------------------------------------------
// Base URL routing
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible adapters append `/chat/completions` or `/responses` to
 * their base URL. Keep the gateway's standard `/v1` prefix regardless of the
 * upstream provider's native URL: the configured URL is the gateway, not the
 * upstream, and gateways such as llms require `/v1/chat/completions`.
 * Anthropic and other adapters append their own full API paths.
 */
function getBaseUrlForApi(api: Api, gatewayUrl: string): string {
	switch (api) {
		case "anthropic-messages":
			return gatewayUrl;
		case "google-generative-ai":
			return `${gatewayUrl}/v1beta`;
		case "google-vertex":
			return `${gatewayUrl}/v1`;
		case "bedrock-converse-stream":
			return `${gatewayUrl}/bedrock`;
		case "openai-codex-responses":
			return gatewayUrl;
		default:
			// OpenAI-SDK adapters append /chat/completions or /responses.
			return `${gatewayUrl}/v1`;
	}
}

// ---------------------------------------------------------------------------
// Model building
// ---------------------------------------------------------------------------

/** Model config with the upstream Pi API embedded for stream-time routing. */
type ApertureModelConfig = ProviderModelConfig & { upstreamApi: Api };

/** Dedicated model as seen at stream time (the stamp survives composition). */
type ApertureRoutedModel = Model<Api> & { upstreamApi?: Api };

const TOKENS_PER_MILLION = 1_000_000;

function parsePrice(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n * TOKENS_PER_MILLION : undefined;
}

/** Copy capability metadata from a matching Pi registry model, if any. */
function registryMetadata(
	registryModels: Model<Api>[],
	providerId: string,
	modelId: string,
): Partial<ProviderModelConfig> | undefined {
	// Exclude the aperture provider's own entries (stale defaults from a
	// previous refresh). Prefer provider-id match, then model-id match.
	const candidates = registryModels.filter((m) => m.provider !== "aperture");
	const match =
		candidates.find((m) => m.provider === providerId && m.id === modelId) ??
		candidates.find((m) => m.id === modelId);
	if (!match) return undefined;
	return {
		name: match.name,
		reasoning: match.reasoning,
		thinkingLevelMap: match.thinkingLevelMap,
		input: match.input,
		cost: match.cost,
		contextWindow: match.contextWindow,
		maxTokens: match.maxTokens,
		compat: match.compat,
	};
}

function buildModels(
	providers: GatewayProvider[],
	gatewayUrl: string,
	registryModels: Model<Api>[],
): ApertureModelConfig[] {
	const models: ApertureModelConfig[] = [];
	const seen = new Set<string>(); // gateway providers can list the same model id; first wins
	for (const provider of providers) {
		const api = getApiForCompatibility(provider.compatibility);
		for (const modelId of provider.models) {
			if (seen.has(modelId)) continue;
			seen.add(modelId);
			const meta = registryMetadata(registryModels, provider.id, modelId);
			const pricing = provider.pricingById[modelId];
			const cost = meta?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
			models.push({
				id: modelId,
				name: meta?.name ?? modelId,
				api: "aperture",
				baseUrl: getBaseUrlForApi(api, gatewayUrl),
				reasoning: meta?.reasoning ?? false,
				thinkingLevelMap: meta?.thinkingLevelMap,
				input: meta?.input ?? ["text"],
				cost: {
					...cost,
					input: parsePrice(pricing?.input) ?? cost.input,
					output: parsePrice(pricing?.output) ?? cost.output,
					cacheRead: parsePrice(pricing?.input_cache_read) ?? cost.cacheRead,
					cacheWrite: parsePrice(pricing?.input_cache_write) ?? cost.cacheWrite,
				},
				contextWindow: meta?.contextWindow ?? 128_000,
				maxTokens: meta?.maxTokens ?? 8_192,
				compat: meta?.compat,
				upstreamApi: api,
			});
		}
	}
	return models;
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

/**
 * Stream by dispatching to the upstream Pi API stamped on each model config.
 * Pi's provider composition spreads the full model definition, so the extra
 * `upstreamApi` field survives registration and the models store.
 */
function streamSimple(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const api = (model as ApertureRoutedModel).upstreamApi ?? "openai-completions";
	const provider = getApiProvider(api);
	if (!provider) throw new Error(`[aperture] unsupported upstream API: ${api}`);
	return provider.streamSimple({ ...model, api }, context, options);
}

/** Store entry tagged with the gateway origin it was built for. */
type ApertureStoreEntry = ModelsStoreEntry & { gatewayOrigin?: string };

function refreshModels(
	getModels: () => Model<Api>[],
	hasRegistrySnapshot: () => boolean,
) {
	// When pi runs offline (PI_OFFLINE=1, e.g. Nix wrappers that only want the
	// package manager read-only), pi never grants a networked refresh. The
	// gateway is a tailnet LAN host, not what that flag protects against, so
	// fetch it directly in that case — throttled so pi's repeated cache-only
	// refresh phases do not hammer the gateway. Stale on failure = cache.
	// Deferred until the first session_start (hasRegistrySnapshot): the
	// registration-phase refresh runs before the registry snapshot exists,
	// and without it the upstream base-URL inference (Z.ai /v4 → gateway
	// root) degrades to /v1.
	const OFFLINE_FETCH_TTL_MS = 5 * 60 * 1000;
	let lastFetchAttempt = 0;

	return async (
		context: RefreshModelsContext,
	): Promise<ProviderModelConfig[]> => {
		const gatewayUrl = normalizeGatewayUrl(config.baseUrl ?? "");
		if (process.env.APERTURE_DEBUG) {
			console.error(
				`[aperture:debug] refresh allowNetwork=${context.allowNetwork} gateway=${gatewayUrl}`,
			);
		}
		if (!gatewayUrl) return [];

		const stored = context.stored as ApertureStoreEntry | undefined;
		// Cache-only restore: replay only when built for the same gateway.
		const restore = (): ProviderModelConfig[] =>
			!stored || stored.gatewayOrigin !== gatewayUrl
				? []
				: [...(stored.models as unknown as ProviderModelConfig[])];

		const piOffline = /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
		const shouldFetch =
			context.allowNetwork ||
			(piOffline && hasRegistrySnapshot() && Date.now() - lastFetchAttempt > OFFLINE_FETCH_TTL_MS);
		if (!shouldFetch) return restore();

		if (process.env.APERTURE_DEBUG && !context.allowNetwork) {
			console.error("[aperture:debug] pi offline mode: fetching gateway catalog directly");
		}

		try {
			const providers = await new GatewayClient(gatewayUrl).providers(
				context.signal,
			);
			const models = buildModels(providers, gatewayUrl, getModels());
			context.signal?.throwIfAborted();
			const entry: ApertureStoreEntry = {
				models: models as unknown as Model<Api>[],
				checkedAt: Date.now(),
				gatewayOrigin: gatewayUrl,
			};
			const published = await context.publish({ persist: entry });
			// Stamp the TTL only after a successful publish: concurrent refresh
			// phases supersede each other's generations (publish returns false and
			// the result is silently discarded), so a superseded fetch must not
			// block the surviving phase from fetching again.
			if (published) lastFetchAttempt = Date.now();
			return models;
		} catch (error) {
			if (context.signal?.aborted) return restore();
			lastFetchAttempt = Date.now(); // avoid hammering a failing gateway
			if (process.env.APERTURE_DEBUG) {
				console.error(
					`[aperture:debug] gateway fetch failed (${
						error instanceof Error ? error.message : String(error)
					}); using cache`,
				);
			}
			return restore();
		}
	};
}

// Config is read once at factory time; changing it requires a pi restart.
const config: ApertureConfig = await loadConfig();

/** Extension version from the adjacent package.json ("dev" if unreadable). */
const EXTENSION_VERSION: string = (() => {
	try {
		return (
			JSON.parse(
				readFileSync(new URL("./package.json", import.meta.url), "utf8"),
			).version ?? "dev"
		);
	} catch {
		return "dev";
	}
})();

const USER_AGENT = `pi/${PI_VERSION} pi-aperture/${EXTENSION_VERSION}`;

// Marker API id. Must match between provider registration and model configs:
// pi dispatches to the provider's streamSimple only when model.api equals it.
const APERTURE_API = "aperture";

export default async function apertureExtension(
	pi: ExtensionAPI,
): Promise<void> {
	const gatewayUrl = normalizeGatewayUrl(config.baseUrl ?? "");
	if (!gatewayUrl) {
		console.warn(
			`[aperture] no baseUrl configured; set APERTURE_URL or ${CONFIG_PATH}. Extension disabled.`,
		);
		return;
	}

	// Snapshot of Pi's native registry models, for capability metadata and
	// upstream base URL inference. Deliberately plain data: ctx accessors are
	// invalid after session replacement, a snapshot can only go slightly stale.
	let knownModels: Model<Api>[] = [];
	const getModels = () => knownModels;
	// Set once session_start has captured the registry snapshot; the offline
	// self-fetch waits for it so base-URL inference has native models to use.
	let registrySnapshotReady = false;
	const hasRegistrySnapshot = () => registrySnapshotReady;

	pi.registerProvider("aperture", {
		name: "Aperture",
		baseUrl: `${gatewayUrl}/v1`,
		apiKey: "-", // Aperture injects upstream credentials server-side
		api: APERTURE_API,
		streamSimple,
		refreshModels: refreshModels(getModels, hasRegistrySnapshot),
	});

	// Provenance header + live session id (kept current across /fork, /new,
	// /resume) for request grouping in the Aperture dashboard.
	// `x-litellm-session-id` is load-bearing for cache hits: litellm's chatgpt
	// provider strips body-level prompt_cache_key and mints a fresh upstream
	// session_id (which the ChatGPT backend uses as its prompt_cache_key) per
	// request unless litellm_session_id is set — the proxy extracts it from
	// this header. Without it, prefix cache hit rate through the gateway is ~0%.
	pi.on("before_provider_headers", (event, ctx) => {
		event.headers.Referer = "https://pi.dev";
		const sessionId = ctx.sessionManager.getSessionId();
		event.headers["x-session-id"] = sessionId;
		event.headers["x-litellm-session-id"] = sessionId;
		// Override whatever UA the adapter set (pi's OpenAI-SDK adapters leak the
		// raw SDK default; its anthropic/codex adapters set their own) so gateway
		// dashboards always see both pi and extension versions.
		event.headers["User-Agent"] = USER_AGENT;
	});

	// Tag transient gateway errors so pi's auto-retry picks them up.
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.stopReason !== "error" || !message.errorMessage) return;
		if (!/aperture is restarting/i.test(message.errorMessage)) return;
		if (message.errorMessage.toLowerCase().includes("service unavailable")) {
			return;
		}
		return {
			message: {
				...message,
				errorMessage: `${message.errorMessage} (service unavailable)`,
			},
		};
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		knownModels = ctx.modelRegistry.getAll();
		registrySnapshotReady = true;
		// pi's own startup refresh runs before extensions load, so trigger the
		// networked refresh for the aperture provider here. Failures fall back
		// to the stored catalog. Note: PI_OFFLINE=1 disables networked refreshes
		// entirely (pi constructs the model runtime with networking off).
		void ctx.modelRegistry
			.refresh({ providers: ["aperture"] })
			.then((result) => {
				if (process.env.APERTURE_DEBUG) {
					console.error(
						`[aperture:debug] refresh done, errors=${
							[...(result?.errors ?? [])]
								.map(([k, e]) => `${k}:${e.message}`)
								.join(",") || "none"
						}`,
					);
				}
				const error = result?.errors?.get("aperture");
				if (error) {
					ctx.ui.notify(
						`[aperture] model refresh failed: ${error.message}`,
						"warning",
					);
				}
			})
			.catch((error: unknown) => {
				ctx.ui.notify(
					`[aperture] model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			});
	});
}
