# agents.nix

Personal AI coding agent wrappers. Takes agents from [llm-agents.nix](https://github.com/numtide/llm-agents.nix) and wraps them with secrets from [sops](https://github.com/getsops/sops) and optional sandboxing via [microsandbox](https://github.com/superradcompany/microsandbox). First-party Pi extensions and skills are maintained in [`pi-extensions/`](pi-extensions/).

## How it works

Each package is a thin wrapper script that:

1. Decrypts a sops-encrypted JSON file at runtime using your SSH key
2. Exports the secrets as environment variables
3. Launches the agent

**Boxed variants** run the agent inside a microsandbox microVM as a one-shot command. At build time, nix computes the linux closure and assembles it into a rootfs. At runtime, the wrapper copies the closure to a temp dir (bypassing macOS HVF restrictions on /nix/store), mounts it into an ubuntu VM at `/nix/store`, and runs the agent. Secrets are passed via `--secret` flags — the VM sees only placeholders (`$MSB_KEY`) and a TLS proxy injects the real value exclusively for requests to the allowed API host. The agent cannot exfiltrate secrets. The VM is destroyed when the command exits.

**Session variants** provide persistent microsandbox VMs with a docker-style lifecycle. Instead of running a single command, `pi-session` boots a VM and drops you into a shell. The VM's filesystem persists across stop/start cycles — you can pause work and resume later. Your current directory is bind-mounted at `/workspace` inside the VM. Optionally, [zmx](https://zmx.sh/) is auto-detected for persistent terminal sessions (shell and running processes survive disconnect).

### Profiles

Secrets are organized into profiles — separate encrypted files for different contexts (personal, work). Each profile produces its own set of packages.

### Variants

Native packages come in two variants. The bundled variant disables automatic extension and theme discovery, then loads only its explicit Nix store paths for those resources. Skills remain discoverable from project and user locations as well as explicit Nix bundles:

| Variant | Secrets | Extensions | Skills | Themes | Use when |
|---|---|---|---|---|---|
| `pi` / `pi-work` | ✅ | ❌ | ❌ | ❌ | Use resources already available locally; never download them |
| `pi-ext` / `pi-work-ext` | ✅ | ✅ | ✅ | ✅ | Use Nix-bundled resources; never download them at runtime |
| `pi-boxed` / `pi-work-boxed` | ✅ | ✅ | ✅ | ✅ | One-shot sandboxed execution — always includes bundled resources |
| `pi-session` / `pi-work-session` | ✅ | ✅ | ✅ | ✅ | Persistent sandboxed session — drop into a shell, run pi yourself |

```bash
# Secrets only — loads local/already-installed resources without downloading
nix run .#pi

# Secrets + extensions + skills from nix, without runtime downloads
nix run .#pi-ext

# Fully sandboxed, one-shot (always includes extensions)
nix run .#pi-boxed

# Persistent sandboxed session
nix run .#pi-session
```

### T3 Code (native)

```bash
nix run .#t3code                # personal secrets
nix run .#t3code-work           # work secrets
nix run .#t3code -- serve --port 3773  # headless foreground server
```

These launch T3 Code with secrets decrypted once at startup. T3's provider subprocesses inherit those keys; the bundled `pi` executable does not decrypt again. It includes the same extensions, skills, themes, tools and offline resource policy as `pi-ext`. T3 unsets `GH_TOKEN` and `GITHUB_TOKEN` so its GitHub commands use your saved login. The token is passed as `AGENTS_GITHUB_TOKEN`; bundled Pi restores both GitHub variables at launch. Upstream's other default provider executables remain available too.

In T3's provider settings, **enable Pi** (disabled by default) and leave its binary path as `pi` to use the bundled harness. Pi extensions are not T3 UI plugins; RPC compatibility of every bundled extension is not yet verified. Existing host provider logins remain available. Secrets in the environment are not isolated from providers or terminal subprocesses.

T3 state defaults to `~/.local/share/t3code` or `~/.local/share/t3code-work`. Override with `T3CODE_HOME` or T3's `--base-dir`. Pi still uses its normal user/project configuration and login state; separate T3 directories do not isolate Pi's user configuration. Both profiles prefer T3's default port; pass distinct `--port` values when running concurrently. Telemetry defaults off (`T3CODE_TELEMETRY_ENABLED=false`) but can be explicitly enabled. T3 itself is not offline: authentication, model requests and optional remote features use the network. Prefer foreground execution; upstream service/setup commands can download a runtime outside Nix. No T3 sandbox variant is provided.

On Linux, the wrapper supplies `NIX_LD` and `NIX_LD_LIBRARY_PATH` for T3's downloaded Chrome Headless Shell, using a matching loader and browser libraries from this flake. Existing `NIX_LD_LIBRARY_PATH` entries are appended. On NixOS, enable `programs.nix-ld.enable = true;` in your host configuration; installing libraries in `environment.systemPackages` alone is insufficient. The host must also provide Fontconfig and fonts (for example `fonts.packages = [ pkgs.liberation_ttf ];`). T3 downloads its pinned browser on first use; `PLAYWRIGHT_BROWSERS_PATH` does not select it. Chrome's sandbox remains enabled; run T3 as a non-root user. On hosts restricting unprivileged user namespaces through AppArmor, the host policy still needs to allow Chrome. `t3 browser setup` uses apt for dependencies and is not a NixOS installer. Restart the T3 server through the updated wrapper to pick up this environment.

Wrapper regression test (fake sops/provider, no real secrets or model requests):

```bash
nix build --impure --file tests/t3code-wrapper.nix --no-link
```

### Encryption

Secrets are encrypted to SSH Ed25519 public keys via sops/age. Decryption works automatically — sops finds your SSH private key and prompts for the passphrase when run from a terminal (same as [litellm-proxy](https://github.com/getsops/sops)). For non-interactive use, you can [create an age identity](#set-up-non-interactive-decryption).

## Quick start

```bash
# Edit secrets with your real API keys
nix develop
sops secrets/personal.enc.json

# Run (sops will prompt for your SSH key passphrase)
nix run .#pi          # secrets only
nix run .#pi-ext      # secrets + extensions + skills
nix run .#pi-boxed    # one-shot sandboxed
nix run .#pi-session  # persistent sandboxed session
```

### Session usage

```bash
# Create a session and drop into a shell (the primary command)
pi-session run my-project
# You're now in a bash shell inside an ubuntu VM.
# /workspace is your host's current directory.
# All nix tools (pi, gh, fd, ripgrep, etc.) are on PATH.

# Run pi yourself
pi

# Detach (Ctrl+\ if zmx is installed) — VM keeps running
# Close terminal — shell dies but VM keeps running

# Reconnect later
pi-session attach my-project

# Stop to free resources (disk state preserved)
pi-session stop my-project

# Resume
pi-session start -a my-project

# Done forever
pi-session rm my-project
```

All session commands follow docker conventions:

| Command | Description |
|---|---|
| `pi-session run <name>` | Create + attach (primary command) |
| `pi-session run <name> -d` | Create without attaching (detached) |
| `pi-session create <name>` | Create VM only |
| `pi-session start <name>` | Start a stopped VM |
| `pi-session start <name> -a` | Start + attach |
| `pi-session attach <name>` | Connect to a running VM's shell |
| `pi-session stop <name>` | Halt VM, preserve disk |
| `pi-session rm <name>` | Destroy VM and local data |
| `pi-session exec <name> <cmd>` | Run a one-off command in the VM |
| `pi-session ls` | List sandboxes |

Session data (nix closure copy) is stored at `~/.local/share/pi-session/<name>/`. If [zmx](https://zmx.sh/) is installed, `attach` creates persistent terminal sessions — your shell, scrollback, and running processes survive disconnect.

### Set up non-interactive decryption

Only needed if you want to use the wrappers without a passphrase prompt (e.g. CI, agents):

```bash
nix shell nixpkgs#ssh-to-age -c ssh-to-age -private-key -i ~/.ssh/id_ed25519 -o ~/.config/sops/age/keys.txt
```

## Platforms

| Package | x86_64-linux | aarch64-linux | aarch64-darwin | x86_64-darwin |
|---|---|---|---|---|
| `pi` / `pi-work` | ✅ | ✅ | ✅ | ✅ |
| `pi-ext` / `pi-work-ext` | ✅ | ✅ | ✅ | ✅ |
| `pi-boxed` / `pi-work-boxed` | ✅ | ✅ | ✅ | ❌ |
| `pi-session` / `pi-work-session` | ✅ | ✅ | ✅ | ❌ |

## Extensions, Skills & Themes

Loaded from the first-party [`pi-extensions/`](pi-extensions/) source tree:

**Extensions** (7): agent, aperture, background-terminals, morphllm, status-tracker, telemetry, tinyfish (with `@tiny-fish/sdk` + transitive deps)
**Skills** (15): agent-browser, babysit-pr, deepwiki, design-control-loop, develop-testing-strategy, diagram-design, github-actions, gleam, grugbrain, herdr, leaving-pr-comments, mattpocock, pi-usage, share-output, using-agents

`babysit-pr` and `leaving-pr-comments` are vendored from [t3dotgg/tstack](https://github.com/t3dotgg/tstack/tree/1085050f3baed1ac724caa4a8166145fb2ac88af/skills) at commit `1085050f3baed1ac724caa4a8166145fb2ac88af`, with upstream license copies in each skill directory. They are bundled automatically in `pi-ext` and T3's bundled Pi. Outside T3, the `babysit-pr` helper requires Python 3 and an authenticated `gh` on PATH.

The source snapshot originated at `kasuboski/pi-extensions` revision `92e0c102e4a6bb60d822ab481aad9bb5fc031a9d`; future edits are maintained here.

**Themes**: Catppuccin Latte, Frappé, Macchiato, and Mocha. The root npm lockfile pins the upstream theme package; Nix installs it at build time and passes the four palette JSON files explicitly to Pi. The package directory itself is not passed as a theme directory, since Pi would also try to parse its `package.json` as a theme.

Extensions and dependency-provided resources are built with `buildNpmPackage`. Extension lockfiles are patched to add missing integrity hashes for peer dependency entries, and transitive npm dependencies are fully resolved.

Native wrappers set `PI_OFFLINE=1`. The plain `pi` wrapper decrypts sops secrets at launch. It can load local paths and packages already installed under `~/.pi/agent`, but startup never clones git packages, runs npm, reconciles package checkouts, checks for updates, or sends install telemetry. The `pi-ext` bundled extensions and themes are passed as local Nix store paths with their automatic discovery disabled. Built-in `mcp`, `codemode`, and `tool-search` extensions are explicitly enabled (also in `pi-work-ext` and T3's bundled Pi); `llama.cpp` remains disabled. MCP reads user `~/.pi/agent/mcp.json` and trusted project `.pi/mcp.json` configurations. Skills are passed explicitly but project (`.agents/skills/`, `.pi/skills/`) and user skills remain discoverable. The wrapper does not touch user package installations.

Run `nix shell nixpkgs#python3 --command bash tests/pi-ext-skills.sh` to verify project, user, and bundled skill discovery against the built `pi-ext` package. The test uses an isolated fixture and requires project trust because Pi intentionally gates project skills on trust; it stubs `sops` only in the test process and never decrypts real secrets.

Run `nix shell nixpkgs#nodejs --command bash tests/pi-ext-builtins.sh` to verify the three built-in extensions load while automatic extension discovery and `llama.cpp` remain disabled. The test isolates user/project configuration and stubs decryption; it never decrypts secrets or contacts a model provider.

Run `mise exec node@24.20.0 -- bash tests/pi-ext-themes.sh` to verify that the built wrapper's theme flags load all four palettes without diagnostics. This test uses the packaged Pi's real resource loader in an isolated fixture and intercepts decryption and the final launch; it never decrypts secrets or contacts a model provider.

Run `nix shell nixpkgs#nodejs_24 --command bash tests/pi-aperture-rpc.sh` to verify that late Aperture discovery failures cannot access a replaced session context or terminate Pi. It also exercises real RPC session switching against a delayed local fake gateway, without decrypting secrets or making model requests.

Run `nix build --impure --file tests/pi-rootfs.nix --no-link -L` to test the actual sandbox rootfs builder with small synthetic Pi, extension, skill, and theme fixtures. No VM, KVM, secrets, or model access is needed. The rootfs includes one combined runtime closure for Pi, Bash, bundled resources, extra packages, and the optional entrypoint. Resource subpaths retain their complete original `/nix/store/<output>/...` locations; dependencies (including extension `node_modules` symlink targets) are included transitively. The regression checks those locations, same-basename nested themes, plain-file outputs, dependency references, and the minimal rootfs's Bash links.

## Operations

### Add a secret

```bash
nix develop
sops secrets/personal.enc.json
# opens your editor — add a new key/value, save, and sops re-encrypts
```

If the new secret is used by a boxed variant, add a host mapping in the relevant `packages/mk-*-boxed.nix`:

```nix
secretHosts = {
  GITHUB_TOKEN = "github.com";
  NEW_API_KEY = "api.example.com";  # add this
};
```

### Add an SSH key (grant decryption access)

1. Get the SSH Ed25519 public key
2. Add it to `.sops.yaml` as a YAML anchor under `keys:`
3. Reference it in the relevant `key_groups`
4. Re-encrypt all affected files:

```bash
nix develop
sops updatekeys secrets/personal.enc.json
sops updatekeys secrets/work.enc.json
```

### Rotate keys

Remove the old key from `.sops.yaml`, then re-encrypt:

```bash
nix develop
sops updatekeys secrets/personal.enc.json
sops updatekeys secrets/work.enc.json
```

### Add a new profile

1. Create a plaintext JSON file with the secret keys:

```bash
echo '{"GITHUB_TOKEN": "...", "TINYFISH_API_KEY": "...", "ZAI_API_KEY": "..."}' > secrets/newprofile.json
```

2. Encrypt it:

```bash
nix shell nixpkgs#sops -c sops --config /dev/null encrypt \
  --age "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJzR7zD/n14hIPjRWN8lGIj2zSmmFaqBX2Qhf80TOmdQ" \
  --input-type json --output-type json \
  secrets/newprofile.json > secrets/newprofile.enc.json
rm secrets/newprofile.json
```

3. Add a creation rule in `.sops.yaml` for `secrets/newprofile\.enc\.json$`
4. Add the profile to `flake.nix`:

```nix
profiles = {
  personal = ./secrets/personal.enc.json;
  work = ./secrets/work.enc.json;
  newprofile = ./secrets/newprofile.enc.json;  # add this
};
```

5. Rebuild: `nix build .#pi-newprofile`

### Automatic npm dependency hashes

Same-repository Renovate PRs run `.github/workflows/renovate-npm-hashes.yml`. It refreshes hashes for changed extension/root npm lockfiles, using the actual Nix dependency derivations (including peer-integrity patches). It then runs formatting, a real `pi-ext` build, flake evaluation, and built-in/theme/skill regression tests. Only after validation succeeds does a separate job push a hash-only commit to the PR. Failed fetches or builds never get committed; concurrent branch updates are rejected rather than overwritten. Fork and non-Renovate PRs cannot use the write job.

The build job has read-only permissions; only the separate push job has write access, and that job never executes PR scripts or dependency builds. No personal access token is needed. Repository Actions policy must allow `GITHUB_TOKEN` write permissions. Pushes using that token do not trigger another workflow run, so the action publishes a `pi-ext-build` commit status on the new validated commit; use that status for branch protection if desired. This validates packaging/resource loading, not every upstream API or live provider interaction, and does not auto-merge PRs.

Once the workflow is on `main`, rebase existing Renovate PRs onto it to pick up the updater and trigger the workflow. Local use (Python 3 and Nix required):

```bash
python3 scripts/update-npm-deps-hashes.py                    # all npm caches
python3 scripts/update-npm-deps-hashes.py --base origin/main # only changed lockfiles
python3 tests/test-update-npm-deps-hashes.py
nix build .#pi-ext --no-link --keep-going
```

The updater intentionally builds each selected dependency cache with a fake hash and extracts the actual fixed-output hash. These expected mismatch errors are captured; unrelated errors abort without partially changing the hash file. It also supports `--root /path/to/source` for isolated source snapshots. Root resources and all extension caches are supported; flakes and npm lockfiles are never rewritten by the updater.

### Update pinned inputs safely

Update only the intended inputs:

```bash
nix flake update llm-agents
```

Pi extension and skill sources are maintained in `pi-extensions/`, so source changes no longer require a flake input update. Changes to extension or root npm lockfiles may make fixed-output hashes in `packages/build-pi-extensions.nix` stale. `nix flake check --no-build` will not catch this because it only evaluates the derivations; always perform a real build:

```bash
nix build .#pi-ext --no-link --keep-going
```

If the build reports that an `npmDepsHash` is out of date:

1. Temporarily replace the affected hashes in `npmDepsHashes` with `lib.fakeHash`. When several lockfiles changed, replace all extension hashes and use `--keep-going` to collect every mismatch in one build.
2. If the root `package-lock.json` changed, also replace `packageResources.npmDepsHash` with `lib.fakeHash`.
3. Run the real build again and copy each `got: sha256-...` value into the corresponding hash.
4. Restore hashes that did not change, then rerun the build until it succeeds.

Derivation names describe the bundled extension being built: for example, `pi-agent-1.0.0` means `pi-extensions/extensions/agent`, not the upstream pi package from `llm-agents.nix`.

Finish by formatting and checking the flake:

```bash
nix fmt
nix flake check --no-build
git diff --check
```

Do not commit or push a pin update unless the real `pi-ext` build succeeds.

### Add a new agent

Copy an existing package function and adapt it. For example, to wrap `claude-code`:

1. Copy `packages/mk-pi.nix` → `packages/mk-claude-code.nix`
2. Change the upstream package reference and binary name:

```nix
# packages/mk-claude-code.nix
{ pkgs, llm-agents-claude-code, sops-file, profile ? null }:
let
  name = if profile == null then "claude-code" else "claude-code-${profile}";
in
pkgs.writeShellApplication {
  inherit name;
  runtimeInputs = with pkgs; [ sops jq llm-agents-claude-code ];
  text = ''
    if ! SECRETS=$(sops -d --input-type json --output-type json "${sops-file}"); then
      echo "ERROR: Failed to decrypt ${sops-file}" >&2; exit 1
    fi
    for key in $(echo "$SECRETS" | jq -r 'keys[]'); do
      value=$(echo "$SECRETS" | jq -r --arg k "$key" '.[$k]')
      export "''${key}=''${value}"
    done
    exec claude "$@"
  '';
  # ...
}
```

3. Wire it into `flake.nix` following the same pattern as `mkPi`/`mkPiPackages`

## Formatting

```bash
nix fmt
```
