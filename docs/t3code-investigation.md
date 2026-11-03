# T3 Code packaging and integration investigation

## Pin update follow-up

The repository's `llm-agents` input has now been updated to `a854ddf4456f5fd67474e2d844cb4a29c32702d0` (2026-11-03). Nix evaluation confirms **T3 Code 0.1.6**, up from **0.0.45**, and **Pi 1.5.0**, up from **1.1.0**. Thus the newer native Pi-driver findings below are relevant to the updated input. Persistent sandbox integration is explicitly out of scope; native integration remains the next possible step. Native `t3code` / `t3code-work` wrappers have since been added: runtime-only parent sops decryption, bundled Pi resources without repeated decryption, per-profile T3 state, and telemetry off by default. Enable Pi in T3 provider settings with binary `pi`. Real builds of both wrappers and `pi-ext`, plus synthetic wrapper regression tests, passed on x86_64-linux; live T3/Pi conversation behavior remains unverified.

The original investigation below retains its old-pin/newer-upstream comparison as historical source evidence; references to the “current lock” there describe the pre-update lock. Validation passed on x86_64-linux: `nix build .#pi-ext --no-link --keep-going`, `nix fmt`, `nix flake check --no-build`, and `git diff --check`. This validates packaging, not end-to-end T3/Pi runtime compatibility.

## Scope and exact source

Investigated 2026-11-03 using Nix metadata/source/evaluation and GitHub API/raw source, without changing pins. **Verified** means directly present in source or evaluation; **inference** identifies an integration conclusion, not a tested deployment. Unless explicitly marked **0.1.6**, runtime findings describe the locally locked **0.0.45** source. Citations use immutable revisions; a separate section covers newer upstream behavior.

- The supplied `llm-agents.nix` revision is `b6bfce01933b231609a80fe13c68e29a6948739d`. Its package selects **T3 Code `0.0.45`**, GitHub tag `v0.0.45`, with source hash `sha256-8drTHjFqa2vJ96jhpRZXmNbtbXtKk1q40jOEp9dohNc=`. [Package source][pin]
- GitHub's tag API resolved that tag to commit **`6c8fed35dded9ff71c5b46807125457acbb76be6`**. I downloaded that commit's archive using `curl`; `nix hash path` on its extracted source produced **exactly the package's hash above**. Thus this is verified against the packaged source content, not merely today's potentially movable tag.
- The upstream server `package.json` at that commit still says `0.0.44`; this does **not** make the packaged version `0.0.44`: the Nix recipe runs `scripts/update-release-package-versions.ts 0.0.45` before building. [Upstream manifest][server-package], [version rewrite][version-rewrite]
- Separately, upstream `llm-agents.nix` HEAD resolved to **`30e10f1753e0f795f7f3c7521f11b2d2d2eb92d5`**, packaging **0.1.6**, whose tag resolves to T3 commit **`2359643cffa6ba9ee84d6f2694b935de54a8013e`**. That version materially changes Pi compatibility; it is **not** available through this repository's current lock. [Current package source](https://github.com/numtide/llm-agents.nix/blob/30e10f1753e0f795f7f3c7521f11b2d2d2eb92d5/packages/t3code/unwrapped.nix#L29-L40), [T3 revision](https://github.com/pingdotgg/t3code/commit/2359643cffa6ba9ee84d6f2694b935de54a8013e)
- No runtime build, provider login, model request, VM launch, or network penetration test was performed. No pins or `STATUS.md` were edited.

## Nix package interface

| Property | Locked llm-agents input | Upstream HEAD snapshot above |
| --- | --- | --- |
| Package attribute / pname | `t3code` | Same |
| Version | **0.0.45** | **0.1.6** |
| Default output / main binary | `out`, `bin/t3`; `meta.mainProgram = "t3"` | Same |
| Desktop | `t3code.desktop` output, `bin/t3code-desktop`; attribute `t3code-desktop` joins this output | Same |
| Published platforms | `x86_64-linux`, `aarch64-linux`, `aarch64-darwin`; **no `x86_64-darwin`** | Same |
| Default provider packages prefixed onto PATH | `codex`, `claude-code`, `cursor-agent`, `grok`, `opencode` | Same; **Pi is not bundled** |

Sources: [locked wrapper/outputs/providers](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code/package.nix#L1-L79), [desktop attribute](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code-desktop/package.nix#L8-L28), [published systems](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/flake.nix#L36-L40), [current wrapper](https://github.com/numtide/llm-agents.nix/blob/30e10f1753e0f795f7f3c7521f11b2d2d2eb92d5/packages/t3code/package.nix#L1-L79), [current platforms](https://github.com/numtide/llm-agents.nix/blob/30e10f1753e0f795f7f3c7521f11b2d2d2eb92d5/flake.nix#L36-L40).

**Verified by evaluation, not execution:** the locked input evaluates with these values for all three published systems. The standalone desktop derivation has **no `version` attribute**; its contents come from the versioned T3 derivation. Upstream explicitly asserts this and checks that overriding `providerPackages = []` leaves the unwrapped derivation unchanged. These assertions were inspected, not run as a built check. The override changes wrapper PATH, not supported protocols. [Packaging assertions](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/checks/t3code-packaging.nix#L8-L36). Current HEAD was inspected as raw source, not built/evaluated.

The CLI wraps **Node.js 24** running `apps/server/dist/bin.mjs`; desktop wraps **Electron 44**. The recipe builds web/server/desktop assets and a Rust resource-monitor helper, and deploys production/native dependencies at build time rather than running `npx` to install T3 at launch. It embeds public relay/Clerk identifiers, **not model-provider credentials**. Desktop backend cwd is patched to the user's home, avoiding the read-only store. [Build environment](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code/unwrapped.nix#L111-L117), [patch/build/install](https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code/unwrapped.nix#L159-L269).

## Executive findings

1. **This is a persistent web/desktop control plane, not an interchangeable terminal-agent executable.** The `t3` command starts an HTTP server, serves the web client, exposes authenticated WebSocket RPC, and runs provider/terminal/workspace services in the same backend. Electron is optional for headless use. [CLI entrypoint][entrypoint], [server composition][server-composition], [static client][static-client]
2. **Pi compatibility is version-dependent: no in locked 0.0.45; yes in upstream 0.1.6.** The locked drivers are Codex, Claude, Cursor, Grok, OpenCode, and Antigravity; adding Pi to PATH cannot add an adapter. Newer upstream has a native Pi RPC driver, but its Nix wrapper still does not supply Pi. See the version comparison below. [Locked driver list][drivers]
3. **The actual default listener is `127.0.0.1`, not all interfaces**, including web mode. Web mode leaves the configuration's `host` undefined, but server construction explicitly substitutes `127.0.0.1`. [Configuration defaults][defaults], [actual listener][listener]
4. **Headless/remote access is supported**, including direct pairing, Tailscale HTTPS, SSH-managed environments, and optional T3 Connect. These are different access mechanisms, not automatic VM port forwarding. [Headless command][serve], [remote-access documentation at the pinned commit][remote-doc]
5. **There is real application authentication even on loopback.** Startup creates a pairing credential; clients exchange it for a cookie/access token. Ordinary paired clients can operate terminals and agents; pairing must be treated as granting powerful access, not merely viewing a dashboard. [Startup authentication][startup], [scope sets][scopes]

## CLI, environment, and defaults

`t3` and `t3 start` run the browser-oriented server. **`t3 serve`** runs the same backend headlessly, prints connection/token/pairing URL/QR information, forces browser opening off, and forces automatic project creation from cwd off. `t3 --no-browser` suppresses opening a browser but does **not** otherwise become `serve`. [Command handlers][serve], [headless overrides][defaults], [printed output][headless-output]

These are the shared server options implemented at this revision. Normally a flag overrides its corresponding environment variable; desktop bootstrap values are an additional lower-priority source where supported. `serve`'s forced settings take precedence over user options. [Flag declarations][flags], [environment configuration][env], [resolution][defaults]

| CLI | Environment | Default / meaning |
| --- | --- | --- |
| optional positional `cwd` | No dedicated cwd variable | `process.cwd()`; resolved, home-expanded, created if absent; working directory for provider sessions |
| `--mode web\|desktop` | `T3CODE_MODE` | `web`; `desktop` changes startup/bootstrap defaults, not a desktop GUI launcher |
| `--port` | `T3CODE_PORT` | Prefer **3773** in web mode; if occupied, choose a free ephemeral loopback port. Desktop mode uses 3773 absent an explicit/bootstrap port |
| `--host` | `T3CODE_HOST` | Effective listener **127.0.0.1**; explicit addresses such as a private IP or `0.0.0.0` widen access |
| `--base-dir` | `T3CODE_HOME` | **`~/.t3`**, not an XDG directory |
| `--no-browser` | `T3CODE_NO_BROWSER` | False in ordinary web startup, true in desktop mode; forced true by `serve` |
| `--auto-bootstrap-project-from-cwd` | `T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD` | True in ordinary web mode; forced false by `serve` |
| `--dev-url` | `VITE_DEV_SERVER_URL` | Unset; development web proxy/redirect, not a remote-public-URL setting |
| `--bootstrap-fd` | `T3CODE_BOOTSTRAP_FD` | Unset; one-time desktop bootstrap envelope on a file descriptor, not a general shared password |
| `--log-websocket-events` / `--log-ws-events` | `T3CODE_LOG_WS_EVENTS` | False normally, true by default with a dev URL |
| `--tailscale-serve` | `T3CODE_TAILSCALE_SERVE` | False |
| `--tailscale-serve-port` | `T3CODE_TAILSCALE_SERVE_PORT` | 443; only the HTTPS proxy's port, not the backend port |

Port fallback is an ephemeral allocation, **not** necessarily 3774, 3775, etc. For reproducible port forwarding, choose an explicit port. [Default constant][port], [port-selection implementation][port-selection]

Additional relevant environment variables:

- Logging/tracing: `T3CODE_LOG_LEVEL`, `T3CODE_TRACE_MIN_LEVEL`, `T3CODE_TRACE_TIMING_ENABLED`, `T3CODE_TRACE_FILE`, `T3CODE_TRACE_MAX_BYTES`, `T3CODE_TRACE_MAX_FILES`, `T3CODE_TRACE_BATCH_WINDOW_MS`.
- OTLP: `T3CODE_OTLP_TRACES_URL`, `T3CODE_OTLP_METRICS_URL`, `T3CODE_OTLP_LOGS_URL`, `T3CODE_OTLP_EXPORT_INTERVAL_MS`, `T3CODE_OTLP_HEADERS`, `T3CODE_OTLP_PROTOCOL`; the resolver also consumes standard OpenTelemetry environment configuration and persisted settings. [Observability configuration][env], [resolution][defaults]
- `T3CODE_DEV_ALLOWED_ORIGINS` adds development CORS origins. `T3CODE_DEV_AUTH_TOKEN` is a **development-only** reusable token, read only for web mode with a dev URL and requiring at least 32 characters. It is not the production authentication recipe. There is no production `--auth-token`/`T3CODE_AUTH_TOKEN` among these server options. [Development token validation][dev-token], [conditional loading][defaults]
- `T3CODE_TELEMETRY_ENABLED=false` disables the anonymous analytics service, which otherwise defaults enabled and posts batches to `https://us.i.posthog.com`. This is not a promise that every other network feature is disabled. [Telemetry defaults][telemetry], [delivery][telemetry-delivery]

Other registered commands include `app`, `pair`, `auth`, `project`, `service`, `update`, `uninstall`, `theme`, `trace`, and `triage`; `connect` is enabled only if cloud public configuration is available. [Entrypoint][entrypoint]

### Persistent data

The default base directory is `~/.t3`; ordinary runtime state lives in **`~/.t3/userdata`**. [Home resolution][home], [derived paths][paths]

| Path relative to base directory | Purpose |
| --- | --- |
| `userdata/state.sqlite` | Database; SQLite uses WAL mode |
| `userdata/settings.json`, `userdata/keybindings.json`, `userdata/themes/` | Configuration and themes |
| `userdata/secrets/` | Server secret files, including session-signing material; directory mode 0700, individual files 0600 |
| `userdata/attachments/`, `userdata/browser-artifacts/` | Attachments and browser artifacts |
| `userdata/logs/`, `userdata/logs/provider/`, `userdata/logs/terminals/` | Runtime/provider/terminal logs; default server trace is `logs/server.trace.ndjson` |
| `userdata/environment-id`, `userdata/anonymous-id`, `userdata/server-runtime.json` | Identity and live-server discovery |
| `worktrees/`, `caches/` | Worktrees and provider status caches, outside `userdata` |

With a dev URL and no explicit base directory, the state subdirectory is `dev` instead of `userdata`. [Path derivation][paths] The server secret store writes bytes to files; it is **not itself sops encryption at rest**. [Secret store][secret-store] **Inference:** preserve the whole writable base directory and provider credential homes for a persistent VM, protect its backups/logs, and use separate base directories for independently managed server instances. Preserving only the project checkout is insufficient. SQLite WAL files also matter to backup consistency. [SQLite setup][sqlite]

## Providers and Pi compatibility in locked 0.0.45

The static `BUILT_IN_DRIVERS` array contains **Codex, Claude, Cursor, Grok, OpenCode, and Antigravity**. Its source explicitly says that a driver missing from this list becomes an unavailable runtime snapshot, and describes adding a new source-level driver. Merely adding a provider instance named `pi` is therefore not an implementation. [Driver list][drivers]

The pinned upstream installation instructions require installing and authenticating at least one provider: `codex login`, `claude auth login`, `agent login` for Cursor, `grok login`, or `opencode auth login`. These provider logins are **separate from T3 Code browser pairing or T3 Connect authentication**. Antigravity has its own managed installation/authentication. [Pinned upstream installation instructions][provider-install]

| Driver | Actual integration | Authentication verified in source |
| --- | --- | --- |
| Codex | Executable launched with `app-server`; structured app-server protocol | Existing-account detection recognizes ChatGPT subscription, OpenAI API key, and Amazon Bedrock. Managed mode separately implements ChatGPT OAuth/token sharing and requires `chatgpt.tokens.use.direct`. [Launch][codex-protocol], [account types][codex-auth], [managed OAuth][codex-managed-auth] |
| Claude Code | Claude Agent SDK, supplied the configured Claude executable | Recognizes subscription login, API-key/auth-token modes, and Bedrock with external AWS credentials. [SDK launch][claude-protocol], [authentication classification][claude-auth] |
| Cursor | Configured executable with `acp`; ACP transport | Fixed ACP authentication method `cursor_login`; probes existing CLI account status. Its usage reader also recognizes Cursor token/key variables, but that alone does not establish those as T3-managed agent login flows. [ACP configuration][cursor-protocol], [usage credentials][cursor-usage-auth] |
| Grok | `grok agent stdio` plus permission arguments; ACP | Nonempty `XAI_API_KEY` selects `xai.api_key`; otherwise uses `cached_token` from CLI login. Sets `GROK_OAUTH2_REFERRER=t3code`. [Launch/auth configuration][grok-protocol] |
| OpenCode | Starts `opencode serve` or connects to a configured server URL; OpenCode HTTP SDK | Model-provider authentication is delegated to OpenCode and its connected-provider list. Separate optional server authentication is HTTP Basic `opencode:<password>`. [Runtime/server authentication][opencode-runtime], [connected providers][opencode-auth] |
| Antigravity | Google ACP executable plus sibling `localharness_external` | Implements Google personal OAuth, Gemini Enterprise OAuth with project/location, Gemini API key, and Agent Platform/Vertex AI with key or project/location. [Method selection][antigravity-auth], [ACP wiring][antigravity-protocol] |

These entries describe implemented/detected modes, **not** independent validation against the providers' live services or a claim that T3 supplies credentials automatically.

### Credential environment and runtime acquisition

- Provider-instance environment settings normally overlay the server's `process.env`: **inheritance, not a secret-isolation boundary**. Empty instance values can override inherited ones; `CODEX_HOME` and `CLAUDE_CONFIG_DIR` receive home expansion. Claude custom-home handling retains inherited `HOME` and sets `CLAUDE_CONFIG_DIR`, deliberately preserving macOS keychain access. [Environment overlay][provider-env], [Claude home][claude-home]
- Managed Codex is different: it injects its access token/home, removes inherited `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `T3CODE_CODEX_LAUNCH_ARGS`, and supplies fixed token-sharing configuration. **Inference:** do not assume a generic OpenAI key/base-URL secret wrapper configures this managed mode. [Managed environment][codex-managed-env]
- Antigravity deliberately removes ambient Google/Gemini credentials/project and harness/browser overrides, injects the selected authentication configuration and isolated `GEMINI_HOME`, and spawns with `extendEnv: false`. **Inference:** exporting a Google key to the parent is not equivalent to configuring Antigravity's selected auth method. [Environment sanitation][antigravity-env], [controlled spawn][antigravity-spawn]
- Antigravity's managed release is **`agy_acp_server_1.1.1`**, downloaded as a pinned/checksummed ZIP containing the ACP executable and harness. Listed targets include Linux x64/ARM64, macOS ARM64, and Windows x64/ARM64—not macOS x64. The Linux x64 ZIP is about **682 MB** and its two extracted members total about **2.01 GB**; source comments describe roughly 1 GB of PyInstaller temporary extraction per launch. This is material for VM disk/tmp sizing. Acquiring an already available executable does not itself trigger installation; managed installation is a separate operation. [Release manifest][antigravity-release], [installation validation/temp behavior][antigravity-install], [executable acquisition][antigravity-acquire]
- The OpenCode runtime checks minimum CLI version **`1.14.19`**. The JS SDK dependencies are separate versions; do not substitute the SDK's version for the executable requirement. [Minimum version][opencode-version]

### Can the existing Pi harness be wrapped in locked 0.0.45?

**Not by a thin executable substitution at this version.** Executable paths are consumed inside a particular provider implementation: Codex still sends `app-server` arguments; Claude passes the path to its SDK; ACP sessions still send ACP v1 `initialize`, `authenticate`, and session operations with provider-specific expectations. Unknown driver IDs become unavailable snapshots, not dynamically loaded plugins. [Codex invocation][codex-protocol], [Claude SDK invocation][claude-protocol], [ACP handshake][acp-protocol], [unknown-driver behavior][unknown-driver]

**Inference:** integrating Pi as a first-class agent into 0.0.45 requires either a new registered T3 driver or a genuine protocol bridge that implements the chosen adapter's transport, authentication, sessions, streaming, permissions, and cancellation semantics. Merely wrapping the existing Pi launcher to decrypt secrets does not provide that protocol. The existence of ACP adapters does not establish generic plug-and-play ACP/Pi compatibility. This investigation did not inspect or implement a Pi bridge.

**Limited alternative (inference):** because T3 includes an ordinary shell/PTY terminal, Pi could be launched manually there if installed in that environment. That would be terminal access, **not** a T3-native Pi conversation/provider integration. [Terminal implementation][terminal-runtime], [PTY spawn][pty-runtime]

## Network security and authentication

### What is verified

- **Transport:** the backend is built with Node `http.createServer`, not an HTTPS listener. `--host 0.0.0.0` widens binding; it does not add encryption, TLS certificates, a firewall, or a tunnel. [Listener][listener]
- **Startup:** ordinary web startup generates `/pair#token=...` and attempts to open it; `serve` prints the credential and QR code. The token is placed in the URL **fragment**, not the query string. Both modes expose the secret in local output/logging, so do not publish that output. [Startup URL][startup], [startup logging][startup-output], [headless output][headless-output]
- **Bootstrap:** production one-time pairing tokens default to **5 minutes**; the generator makes 12-character random tokens from its restricted alphabet. Successful exchanges consume the grant. Development startup grants have a separate 24-hour default. [Generation and TTL][pairing-ttl], [atomic consumption][pairing-consume]
- **Sessions:** browser exchanges issue an HTTP-only, `SameSite=Lax`, path `/` cookie; this cookie construction does **not** set the `Secure` attribute. Native/headless clients can exchange bootstrap credentials at `/oauth/token` for bearer or DPoP-bound tokens. Session TTL defaults to **30 days**; DPoP exchanges explicitly select one hour. [Browser-session handler][auth-http], [endpoint contracts][auth-endpoints], [exchange implementation][token-exchange], [session defaults][session-ttl]
- **Request authentication:** the backend verifies cookie/bearer/DPoP credentials; DPoP-bound sessions require matching authorization and proof. `/ws` authenticates its upgrade, accepting a short-lived `wsTicket` or normal request credentials; WebSocket ticket TTL defaults to five minutes. HTTP authenticated middleware and RPC scope mapping protect operations. [Credential verification][credential-checks], [WebSocket upgrade][ws-upgrade], [ticket handling][ws-auth], [scope enforcement][rpc-scopes], [HTTP middleware][auth-http]
- **Privilege:** ordinary pairing grants include orchestration read/operate, terminal operate, review write, and relay read. Startup pairing grants and `t3 auth session issue` use the broader administrative scope set, additionally including access management and relay write. These are not read-only observation tokens. [Scopes][scopes], [startup/session issuance][auth-issuance], [CLI issuance][auth-cli]
- **Management:** `t3 auth pairing create/list/revoke` and `t3 auth session issue/list/revoke` operate on the local auth store; they support `--base-dir`, TTL/labels as applicable, and JSON output. Session issuance also supports `--token-only`. `t3 pair` creates a fresh standard-client pairing for a discovered running server. [Auth CLI][auth-cli], [pair command][pair-command]
- **Browser origins:** production CORS uses the HTTP library's default wildcard origin policy; development supplies explicit origins and credentialed CORS. CORS is not a substitute for authentication or network isolation. Static web assets and discovery/bootstrap surfaces are intentionally reachable before authentication; do not interpret the presence of a login UI as authentication on every HTTP resource. [CORS][cors], [static client][static-client], [auth handlers][auth-http]
- **Remote access grants machine capabilities:** RPC authorization includes project file writes, provider installation/authentication, process signaling, and terminal operations. **Inference:** an authorized client should be treated as able to execute code as the backend's OS user. Use an appropriately isolated user/VM, not a privileged host account. [RPC operation/scope map][rpc-map]

### Headless VM / remote-access implications

**Recommended topology (inference):** keep the backend on loopback behind a trusted transport; persist its state; explicitly forward the chosen port; complete provider authentication inside the environment that actually runs the backend. A browser on the host is enough—Electron and a graphical session in the guest are not prerequisites for `serve`. No launch recipe below was exercised in a VM.

For example, inside a persistent Linux environment:

```bash
t3 serve --host 127.0.0.1 --port 3773 --base-dir /persistent/t3 /workspace
```

For an SSH-reachable environment, an operator-managed forward could be:

```bash
ssh -N -L 3773:127.0.0.1:3773 user@environment
```

Open the printed pairing URL through the forwarded local endpoint (adjust its host/port if the local forward differs). **A guest's `127.0.0.1` is not the host's loopback.** If the VM mechanism does not support forwarding to guest loopback, use an appropriate private guest interface plus restricted host-side forwarding/firewalling instead. This is a network-design requirement, not an upstream automatic feature.

Other upstream remote paths:

- **Direct private-network pairing:** `t3 serve --host <private-ip>` binds an address the other device must actually reach. Wildcard host output selects an external interface address; that selection does not establish routability through NAT/VM boundaries. Direct links are plain `http://`. A hosted HTTPS web app cannot simply turn such an endpoint into HTTPS; upstream documents that `app.t3.codes` requires an HTTPS backend. [Connection-string generation][headless-output], [remote-access documentation][remote-doc]
- **Tailscale Serve:** `--tailscale-serve` configures HTTPS forwarding, default port 443, to **`http://127.0.0.1:<backend-port>`**. It needs a working Tailscale CLI/daemon and tailnet setup; the backend attempts to disable its mapping on shutdown. Do not combine a specific non-loopback-only bind with this assumed loopback target without checking connectivity. Also, `serve`'s generic printed connection string remains HTTP; use `t3 pair --tailscale` to generate the tailnet HTTPS pairing URL. [Backend Tailscale lifecycle][tailscale-server], [Tailscale command][tailscale-command], [pair command][pair-command], [headless output][headless-output]
- **T3 Connect:** optional account-based remote exposure through relay/cloudflared. `t3 connect --headless` uses OAuth device authorization; `SSH_CONNECTION` or `SSH_TTY` also selects that flow. Thus no callback-port forwarding is required for this headless **Connect login**. Browser-mode Connect OAuth has its own loopback port **34338**, distinct from backend 3773. This does not automatically solve every provider's OAuth callback. [Device-flow selection][connect-headless], [cloud public/OAuth configuration][cloud-config]
- **Connect runtime dependency:** cloudflared can be selected by `T3CODE_CLOUDFLARED_PATH`, a managed executable under `<base>/tools/cloudflared/<version>/<platform>-<arch>/`, or PATH, in that order. The pinned source's managed release is `2026.5.2`, with download URLs and checksums; Connect setup can install it at runtime. Existing saved cloud links are reconciled on server startup. **Inference:** a persistent previously linked state directory may resume remote exposure; `serve`/`--no-browser` is not an offline/security mode. [Relay resolution/downloads][relay-client], [Connect installation][connect-install], [saved-link reconciliation][cloud-startup]
- **Desktop-managed SSH:** upstream supports launching/reusing a backend and forwarding it from its desktop app. Its pinned documentation says the initial remote launch downloads a runtime under `~/.t3/runtime` and requires `curl`/`wget`, `tar`, checksum tools, and providers on a noninteractive login shell's PATH. This is a distinct, downloading deployment path—not evidence that a custom Nix/VM wrapper will be selected automatically. [SSH requirements][remote-doc]

## Runtime dependency and offline notes

- The server manifest requires **Node `^22.16 || ^23.11 || >=24.10`**. SQLite comes through Node's native `node:sqlite` API, not an external database server. Production JS dependencies include the Claude agent SDK, OpenCode SDK, Effect, `node-pty`, native `@ff-labs/fff-node`, and `@napi-rs/keyring`; these are runtime/native compatibility concerns, not just build tools. [Manifest][server-package], [SQLite client][node-sqlite]
- A useful runtime also needs the relevant provider executable(s), **Git**, and a functioning shell/PTY environment. The terminal manager falls back through shell candidates including bash/sh; native `node-pty` actually spawns the shell. Host resource monitoring has native/helper and `ps` paths. [Git subprocess][git-runtime], [terminal defaults/fallbacks][terminal-runtime], [PTY spawn][pty-runtime], [process-table fallback][process-runtime]
- Browser-opening tools such as macOS `open` or Linux `xdg-open` are optional convenience dependencies; headless startup avoids them. Tailscale/cloudflared/SSH tooling are feature-dependent, not prerequisites for purely local browser access. [Browser command selection][browser-runtime], [headless command][serve]
- Pinning this source does **not** make its runtime fully offline or all runtime data immutable. For example, provider model metadata refreshes from `raw.githubusercontent.com/pingdotgg/t3code/main/...`, with cache/bundled fallbacks. Telemetry, Connect, provider authentication/model traffic, installation, and update features have separate network behavior. [Model manifest URL][model-manifest-url], [cache/fallback behavior][model-manifest], [telemetry][telemetry], [relay client][relay-client]

## What changes in upstream 0.1.6

These facts describe T3 commit **`2359643cffa6ba9ee84d6f2694b935de54a8013e`**, not the locked application. No upgrade was performed.

### Pi is a native supported backend

- The registered drivers add **Pi, fx, Muse, and ACP Registry**, alongside the previous six. This is actual source registration, not an assumption based on an executable name. [Built-in drivers](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/provider/builtInDrivers.ts#L31-L42)
- Pi is **disabled by default**, supports a configurable `binaryPath` (default `pi`) and additional `launchArgs`, and is launched with **`--mode rpc`**. T3 owns session/mode/resume arguments and injects its permission/MCP extension. It therefore manages Pi subprocess conversations rather than wrapping an existing interactive TUI session. [Settings](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/settings.ts#L11-L39), [reserved arguments](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/mcpInjection.ts#L15-L32), [launch construction](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/mcpInjection.ts#L240-L311), [session spawn](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/adapter.ts#L437-L499)
- Minimum Pi version is **0.80.5**. Model/command discovery uses Pi RPC; authentication is considered usable when Pi reports available models. Missing credentials direct the user to Pi `/login` or provider API-key configuration. Version probes have a **4-second timeout** and RPC discovery a **30-second timeout**. [Version/timeouts](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/status.ts#L60-L67), [RPC discovery](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/status.ts#L167-L196), [auth diagnostics](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-pi/src/server/status.ts#L247-L300)
- Cursor changes from the old ACP implementation to its **SDK**, with browser sign-in or `CURSOR_API_KEY`. fx and Muse direct users to their own CLI login; ACP Registry authentication depends on the selected agent. Provider support is broader than the five default Nix provider packages. [Cursor](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-cursor/src/server/driver.ts#L135-L184), [fx](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-fx/src/server/status.ts#L199-L210), [Muse](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-muse/src/server/status.ts#L125-L147), [ACP](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/packages/provider-acp-registry/src/server/driver.ts#L310-L351)

### Server and state changes

- Existing foreground flags/default port remain. **`--lan` / `T3CODE_LAN`** is new: ordinary startup still binds loopback, whereas LAN mode binds `0.0.0.0` and enforces private-range IPv4 socket endpoints. An explicit host bypasses this private-network-only mode; it is not equivalent to `--lan`. [Flags](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/cli/config.ts#L30-L94), [host resolution](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/cli/config.ts#L420-L438), [socket enforcement](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/server.ts#L306-L325)
- New **`t3 up` / `t3 status`** support setup/status; `t3 connect` aliases Connect setup. `t3 up --connect` enables separate T3-account-based remote access; ordinary LAN pairing is not provider-account authentication. [Setup](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/cli/up.ts#L405-L454)
- State still defaults under `~/.t3`, but the database becomes **`userdata/statev2.sqlite`**. Initial migration snapshots the legacy database read-only and leaves it intact for legacy transcript import. **Inference:** back up the whole base directory before any future upgrade. [Paths](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/config.ts#L140-L174), [migration](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/persistence/initializeV2Database.ts#L44-L80)
- **Service setup does not simply retain the Nix-store executable:** it installs an upstream versioned runtime under the data directory and launches that. Foreground Nix execution and `t3 up`/service execution need separate validation; the downloaded runtime is versioned to the CLI but is not the Nix-built artifact. [Service command](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/cloud/bootService.ts#L575-L600), [runtime installation](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/cloud/bootService.ts#L728-L744)
- Analytics remain enabled by default, but the default ingest host changes to `https://ingest.t3.codes`; actual emission is identity-gated. `T3CODE_TELEMETRY_ENABLED=false` is separate from Pi's offline setting. [Analytics configuration](https://github.com/pingdotgg/t3code/blob/2359643cffa6ba9ee84d6f2694b935de54a8013e/apps/server/src/telemetry/AnalyticsService.ts#L64-L75)

## Fit with this repository's harness

**Verified locally:** the [README](../README.md#add-a-new-agent) documents thin per-profile runtime-sops wrappers, not a generic provider bridge. [`mk-pi.nix`](../packages/mk-pi.nix) decrypts only at launch, exports configured keys, sets `PI_OFFLINE=1`, appends Pi-specific resource flags, and forwards `"$@"`. [`flake.nix`](../flake.nix) currently exports Pi packages/apps, **not `.#t3code`**. Evaluation of its locked upstream Pi package reports **1.1.0**, above the new T3 driver's minimum.

**Feasibility / inference:**

1. **Native T3 with locked providers:** straightforward new wrapper pattern—reuse runtime-only sops handling and launch `t3`. Do not forward Pi resource flags or assume `PI_OFFLINE` controls T3. Supply Git/shell/provider tools and writable persistent state. This would be a new T3 application, not a frontend for the existing Pi harness.
2. **T3-native Pi with newer upstream:** plausible without writing a new bridge. Enable the Pi instance and configure its binary path to the existing native `pi`, `pi-work`, or bundled wrapper; alternatively supply it through a provider-package override/PATH. Pinning/upgrading is a separate future decision, not performed here. The plain wrapper forwards T3's RPC arguments and can inject credentials while retaining Pi's own authentication/configuration. Bundled extensions/skills remain Pi resources—not converted into T3 UI components automatically.
3. **Noninteractive credentials are essential:** T3 probes version/auth/models before a conversation. A sops passphrase prompt on every spawned probe may hang/fail within the short timeouts. Use the README's noninteractive age identity approach, or decrypt once in a parent T3 wrapper and invoke Pi with an appropriate environment. Never decrypt during Nix evaluation/build. [Local credential guidance](../README.md#set-up-non-interactive-decryption)
4. **VM reuse needs additional work:** [`mk-pi-boxed.nix`](../packages/mk-pi-boxed.nix) is a one-shot Pi launch; [`mk-pi-session.nix`](../packages/mk-pi-session.nix) persists a VM and mounts `/workspace`, but neither launch command configures a T3 listener/port forward. Their current secret host mappings cover GitHub/Tinyfish/ZAI, not an exhaustive T3/provider/OAuth domain set. A T3 VM needs the Linux T3/provider closure, durable writable base/credential directories, explicit host/browser access and forwarding, and validated secret-proxy/auth flows. A VM-local T3 server plus its Pi subprocess is simpler to reason about than treating `pi-session`'s lifecycle CLI as a Pi RPC executable.

**Unknown until tested:** RPC compatibility of every bundled extension/TUI hook, startup output/probe latency, approval/cancellation behavior with T3's injected extension, model discovery for custom provider extensions, VM loopback/tunnel reachability, and whether credential refresh works with the TLS-placeholder proxy. No claim of a working end-to-end harness integration is made.

## Suggested implementation sequence

1. **Choose the backend first.** Keep the current pin for Codex/Claude/etc.; update `llm-agents` if the objective is a T3 UI for this Pi harness. Follow the README's mandatory real `pi-ext` build before accepting a pin update.
2. **Native first:** add `packages/mk-t3code.nix` and per-profile `t3code` / `t3code-work` packages/apps in `flake.nix`. Use the upstream `t3` CLI, runtime-only sops decryption, and separate writable base directories per profile. Start with foreground `t3`/`t3 serve`, not the runtime-downloading service installer.
3. **For Pi:** use the newer registered Pi driver, enable it, and select an absolute packaged Pi executable. Prefer decrypting once in the parent T3 launcher and a Pi launcher that only sets resource/offline flags; alternatively use existing wrappers with noninteractive decryption. Test plain Pi before `pi-ext`, then add extensions individually. Preserve T3's injected permission/MCP extension and verify it still loads alongside explicit Pi extensions.
4. **Keep provider closure intentional:** `t3code.override { providerPackages = [ ... ]; }` avoids dragging all five default providers into a Pi-only deployment. The override changes PATH only, not driver registration. Measure the resulting closure before choosing defaults.
5. **Persistent VM second:** generalize the session/rootfs builders' agent-specific naming and entrypoint inputs rather than passing T3 RPC arguments to `pi-session`. Include Linux T3/Pi/resources and Git/shell tools, publish a fixed backend port, preserve application/provider state, and explicitly restart the backend after VM start.
6. **Acceptance tests:** build the chosen packages; check CLI/version/model probes without interactive prompts; pair a browser; send a Pi request; exercise custom tools, approvals and cancellation; restart and resume; verify profile separation, forwarding and secret behavior. No live model request is needed for the packaging/probe/HTTP subset.

### Microsandbox source findings

The pinned microsandbox revision is `8263a391ad4d664a21c1921c0edeb1dbeb68332e` (v0.4.6). It supports repeatable `-p/--port HOST:GUEST`, with host localhost binding by default. The current wrappers do not expose it. A guest backend must listen on a guest-network-reachable interface for this forwarding topology; guest loopback alone is insufficient. Port mappings are creation-time persisted configuration, and backend startup still needs orchestration after `msb start`. These are source findings, not a tested VM recipe. [CLI ports](https://github.com/superradcompany/microsandbox/blob/8263a391ad4d664a21c1921c0edeb1dbeb68332e/crates/cli/lib/commands/common.rs#L132-L137), [network defaults](https://github.com/superradcompany/microsandbox/blob/8263a391ad4d664a21c1921c0edeb1dbeb68332e/crates/network/lib/builder.rs#L81-L95), [start](https://github.com/superradcompany/microsandbox/blob/8263a391ad4d664a21c1921c0edeb1dbeb68332e/crates/cli/lib/commands/start.rs).

**Security caveat:** microsandbox serializes its sandbox configuration on the host, including `SecretEntry.value`. Placeholder injection protects the guest from receiving those raw keys; it does not establish memory-only host storage. Current session start also does not re-decrypt sops to refresh rotated keys. Guest-acquired OAuth credentials are ordinary guest-readable credentials, not automatically protected by placeholder injection. [Config persistence](https://github.com/superradcompany/microsandbox/blob/8263a391ad4d664a21c1921c0edeb1dbeb68332e/crates/microsandbox/lib/sandbox/mod.rs#L1900-L1921), [serialized secret fields](https://github.com/superradcompany/microsandbox/blob/8263a391ad4d664a21c1921c0edeb1dbeb68332e/crates/network/lib/secrets/config.rs#L21-L40).

### Build attempt during this investigation

A real build of the locked default `t3code` package was started, then deliberately stopped after Nix planned 38 derivations and approximately 915 MiB of downloads / 3.8 GiB unpacked on this host, including provider and Electron build dependencies. **No successful build or executable smoke test is claimed.** This illustrates the cost of the default provider set and combined upstream build, not a measured final runtime closure size.

## Limits and follow-up validation

- Findings above are source inspection plus content-hash verification, not a successful launch or end-to-end compatibility test. Provider subscriptions, remote callback handling, filesystem permissions, native dependencies, shell discovery, and network reachability still need validation in the intended environment.
- This is not a complete security audit: CSRF/DNS-rebinding coverage, all proxy/asset/MCP routes, rate limiting, tunnel trust boundaries, and immediate revocation of already-open streams were not exhaustively established. Authentication at upgrade and per-RPC scope checks do not by themselves prove immediate termination of every existing connection after revocation/expiry.
- Locked 0.0.45 cannot become a Pi provider merely by changing the executable. Upstream 0.1.6 has the needed native adapter, but compatibility with these wrappers remains untested. Neither revision makes all provider credentials interchangeable or encrypts plain HTTP through application authentication.
- Before a future input update, follow the README's real-build validation (`nix build .#pi-ext --no-link --keep-going`), formatting, and evaluation guidance; metadata/evaluation alone is not a successful build. This investigation did not change any input pin.

## Primary-source references

[pin]: https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code/unwrapped.nix#L30-L40
[version-rewrite]: https://github.com/numtide/llm-agents.nix/blob/b6bfce01933b231609a80fe13c68e29a6948739d/packages/t3code/unwrapped.nix#L175-L179
[server-package]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/package.json#L1-L59
[entrypoint]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/bin.ts#L56-L95
[server-composition]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/server.ts#L475-L634
[static-client]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/http.ts#L533-L668
[listener]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/server.ts#L245-L263
[serve]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/server.ts#L21-L36
[flags]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/config.ts#L27-L84
[env]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/config.ts#L86-L165
[defaults]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/config.ts#L278-L393
[dev-token]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/config.ts#L167-L185
[port]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/config.ts#L23-L29
[port-selection]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/shared/src/Net.ts#L190-L202
[home]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/os-jank.ts#L105-L111
[paths]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/config.ts#L130-L165
[secret-store]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/ServerSecretStore.ts#L155-L206
[sqlite]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/persistence/Layers/Sqlite.ts#L14-L44
[drivers]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/builtInDrivers.ts#L1-L56
[provider-install]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/README.md#L15-L23
[startup]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/serverRuntimeStartup.ts#L307-L337
[headless-output]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/startupAccess.ts#L47-L148
[pairing-ttl]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/PairingGrantStore.ts#L239-L292
[pairing-consume]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/PairingGrantStore.ts#L505-L550
[auth-http]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/http.ts#L171-L315
[token-exchange]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/EnvironmentAuth.ts#L804-L859
[session-ttl]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/SessionStore.ts#L423-L424
[credential-checks]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/EnvironmentAuth.ts#L638-L689
[ws-upgrade]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/ws.ts#L4112-L4133
[ws-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/EnvironmentAuth.ts#L1075-L1095
[rpc-scopes]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/ws.ts#L677-L730
[scopes]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/contracts/src/auth.ts#L81-L115
[auth-issuance]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/EnvironmentAuth.ts#L932-L1016
[auth-cli]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/auth.ts#L59-L246
[pair-command]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/pair.ts#L435-L537
[cors]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/http.ts#L234-L257
[rpc-map]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/auth/RpcAuthorization.ts#L24-L184
[remote-doc]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/docs/user/remote-access.md#L1-L169
[tailscale-server]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/server.ts#L681-L740
[tailscale-command]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/tailscale/src/tailscale.ts#L340-L363
[connect-headless]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/connect.ts#L65-L135
[cloud-config]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cloud/publicConfig.ts#L21-L218
[relay-client]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/shared/src/relayClient.ts#L22-L259
[connect-install]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/cli/connect.ts#L223-L266
[cloud-startup]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/server.ts#L813-L933
[node-sqlite]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/shared/src/nodeSqliteClient.ts#L1-L100
[git-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/vcs/GitVcsDriverCore.ts#L850-L868
[terminal-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/terminal/Manager.ts#L480-L610
[pty-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/terminal/NodePtyAdapter.ts#L270-L292
[browser-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/process/externalLauncher.ts#L230-L248
[model-manifest]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/ModelManifest.ts#L339-L423
[telemetry]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/telemetry/AnalyticsService.ts#L32-L43
[telemetry-delivery]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/telemetry/AnalyticsService.ts#L125-L158
[model-manifest-url]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/ModelManifest.ts#L40-L50
[startup-output]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/serverRuntimeStartup.ts#L1021-L1035
[auth-endpoints]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/packages/contracts/src/environmentHttp.ts#L410-L447
[codex-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1325-L1365
[codex-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/CodexProvider.ts#L102-L106
[codex-managed-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/CodexChatGptAuth.ts#L508-L531
[claude-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/ClaudeAdapter.ts#L4986-L5023
[claude-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/ClaudeProvider.ts#L110-L237
[cursor-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/acp/CursorAcpSupport.ts#L48-L86
[cursor-usage-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/cursorUsageLimits.ts#L62-L89
[grok-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/acp/GrokAcpSupport.ts#L14-L94
[opencode-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/opencodeRuntime.ts#L649-L709
[opencode-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/OpenCodeProvider.ts#L543-L566
[antigravity-auth]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/antigravityAuthSupport.ts#L113-L165
[antigravity-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/acp/AntigravityAcpSupport.ts#L50-L82
[provider-env]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/ProviderInstanceEnvironment.ts#L5-L21
[claude-home]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Drivers/ClaudeHome.ts#L36-L53
[codex-managed-env]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/CodexManagedRuntime.ts#L20-L109
[antigravity-env]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/antigravityAuthSupport.ts#L217-L252
[antigravity-spawn]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/antigravityAuthSupport.ts#L434-L460
[antigravity-release]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/antigravityRelease.ts#L1-L75
[antigravity-install]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/AntigravityInstallation.ts#L521-L694
[antigravity-acquire]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/AntigravityInstallation.ts#L365-L465
[opencode-version]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/opencodeRuntime.ts#L42-L43
[acp-protocol]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/acp/AcpSessionRuntime.ts#L732-L790
[unknown-driver]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts#L131-L145
[process-runtime]: https://github.com/pingdotgg/t3code/blob/6c8fed35dded9ff71c5b46807125457acbb76be6/apps/server/src/terminal/Manager.ts#L741-L790
