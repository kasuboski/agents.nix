# agents.nix

Personal AI coding agent wrappers. Takes agents from [llm-agents.nix](https://github.com/numtide/llm-agents.nix) and wraps them with secrets from [sops](https://github.com/getsops/sops) and optional sandboxing via [microsandbox](https://github.com/superradcompany/microsandbox). Extensions and skills come from [pi-extensions](https://github.com/kasuboski/pi-extensions).

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

Native packages come in two variants. The bundled variant disables automatic extension and skill discovery, then loads only its explicit Nix store paths, avoiding conflicts with user-installed copies in `~/.pi/agent/`:

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

Loaded from [kasuboski/pi-extensions](https://github.com/kasuboski/pi-extensions):

**Extensions** (3): status-tracker, subagent, tinyfish (with `@tiny-fish/sdk` + transitive deps)
**Skills**: agent-browser, deepwiki, develop-testing-strategy, github-actions, grugbrain, mattpocock, using-agents

**Themes**: Catppuccin Latte, Frappé, Macchiato, and Mocha

Extensions and dependency-provided resources are built with `buildNpmPackage`. Extension lockfiles are patched to add missing integrity hashes for peer dependency entries, and transitive npm dependencies are fully resolved.

Native wrappers set `PI_OFFLINE=1`. The plain variant can load local paths and packages already installed under `~/.pi/agent`, but startup never clones git packages, runs npm, reconciles package checkouts, checks for updates, or sends install telemetry. The `pi-ext` resources are passed as local Nix store paths with automatic extension, skill, and theme discovery disabled, so it uses the bundle without touching user package installations.

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

### Update extension npm dependency hashes

When pi-extensions adds or changes npm dependencies:

1. Set the hash to `""` in `packages/build-pi-extensions.nix` for the affected extension
2. Build and copy the `got:` value from the error:

```bash
nix build .#pi-ext --accept-flake-config
# error: hash mismatch ... got: sha256-XXXXX
```

3. Paste the correct hash back into `npmDepsHashes`

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
