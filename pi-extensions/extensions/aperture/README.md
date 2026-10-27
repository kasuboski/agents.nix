# aperture

Minimal [Tailscale Aperture](https://tailscale.com/docs/features/aperture) provider for pi.

Registers a standalone `aperture` provider whose model catalog is discovered
from `/v1/models`, optionally enriched with Aperture's `/api/providers`
compatibility metadata. Without that metadata, models owned by `openai` use
`/v1/responses`; all other models use `/v1/chat/completions`. No proxy mode,
connectors, or settings UI. Adapted from
[@aliou/pi-ts-aperture](https://github.com/aliou/pi-ts-aperture) (MIT), which
is the full-featured alternative.

## Configure

`APERTURE_URL` env var wins, else `~/.pi/agent/extensions/aperture.json`:

```json
{ "baseUrl": "http://ai.your-tailnet.ts.net" }
```

Changing the URL requires a pi restart (read once at load).

## Use

- Models appear as `aperture/<model-id>` (ids exactly as the gateway reports; duplicate ids across gateway providers are deduped, first provider wins).
- Aperture compatibility metadata takes precedence when `/api/providers` is available. Otherwise `/v1/models` is enough for discovery: `owned_by: "openai"` routes to Responses, while other owners route to chat completions.
- First run: the catalog populates after `session_start` fires the networked
  refresh; a model pinned via `--model aperture/...` or default model settings
  only validates on the *next* start (from the persisted catalog in
  `~/.pi/agent/models-store.json`). Interactive `/model` works immediately.
- `PI_OFFLINE=1` disables pi's networked model refreshes, but this extension
  still lists models: after the first `session_start` it fetches the gateway
  catalog directly (the flag exists to keep pi's package manager read-only —
  a tailnet gateway is not what it protects against). The direct fetch is
  throttled to one attempt per 5 minutes per session and falls back to the
  cached catalog on failure, so a genuinely unreachable gateway costs nothing.
  Works with the Nix `mk-pi` wrapper's `PI_OFFLINE=1`. Streaming completions
  are never affected by `PI_OFFLINE`.
- Capability metadata (context window, reasoning, etc.) resolves from Pi's
  model registry; unknown models get safe defaults (128k / 8k / text-only).
  Costs come from gateway pricing. Override per model in
  `~/.pi/agent/models.json` under the `aperture` provider.
- No API keys stored: Aperture injects upstream credentials server-side.
- Requests carry `Referer: https://pi.dev` and `x-session-id` for dashboard
  grouping, and a versioned User-Agent `pi/<pi-version>
  pi-aperture/<extension-version>` (pi's OpenAI-SDK adapters otherwise leak
  the raw `OpenAI/JS x.y.z` SDK default); transient gateway errors
  ("aperture is restarting") are tagged retryable.

## Debug

`APERTURE_DEBUG=1` prints refresh traces to stderr.

## Dev

```bash
nix shell nixpkgs#nodejs -c npm install
nix shell nixpkgs#nodejs -c ./node_modules/.bin/tsc --noEmit --strict \
  --target esnext --module esnext --moduleResolution bundler --skipLibCheck index.ts
```

Dependencies are managed with npm (`package-lock.json`); node is provided by
`nix shell nixpkgs#nodejs` on NixOS.

Load without installing: `pi -e ./extensions/aperture` (from repo root), or
`./dev.sh --ext aperture`.
