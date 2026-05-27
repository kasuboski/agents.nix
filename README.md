# agents.nix

Personal AI coding agent wrappers. Takes agents from [llm-agents.nix](https://github.com/numtide/llm-agents.nix) and wraps them with secrets from [sops](https://github.com/getsops/sops) and optional sandboxing via [microsandbox](https://github.com/superradcompany/microsandbox). Extensions and skills come from [pi-extensions](https://github.com/kasuboski/pi-extensions).

## How it works

Each package is a thin wrapper script that:

1. Decrypts a sops-encrypted JSON file at runtime using your SSH key
2. Exports the secrets as environment variables
3. Launches the agent

**Boxed variants** run the agent inside a microsandbox microVM. At build time, nix computes the linux closure and assembles it into a rootfs. At runtime, the wrapper copies the closure to a temp dir (bypassing macOS HVF restrictions on /nix/store), mounts it into an ubuntu VM at `/nix/store`, and runs the agent. Secrets are passed via `--secret` flags — the VM sees only placeholders (`$MSB_KEY`) and a TLS proxy injects the real value exclusively for requests to the allowed API host. The agent cannot exfiltrate secrets.

### Profiles

Secrets are organized into profiles — separate encrypted files for different contexts (personal, work). Each profile produces its own set of packages.

### Extensions vs no extensions

Extensions loaded via `-e` flags conflict with user-installed copies in `~/.pi/agent/`. To avoid this, native packages come in two variants:

| Variant | Secrets | Extensions | Skills | Use when |
|---|---|---|---|---|
| `pi` / `pi-work` | ✅ | ❌ | ❌ | You have extensions installed locally already |
| `pi-ext` / `pi-work-ext` | ✅ | ✅ | ✅ | You want everything from nix, no local setup |
| `pi-boxed` / `pi-work-boxed` | ✅ | ✅ | ✅ | Always — no conflict inside a VM |

```bash
# Secrets only — won't conflict with your installed extensions
nix run .#pi

# Secrets + extensions + skills from nix
nix run .#pi-ext

# Fully sandboxed (always includes extensions)
nix run .#pi-boxed
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
nix run .#pi-boxed    # sandboxed (requires Linux or Apple Silicon)
```

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

## Extensions & Skills

Loaded from [kasuboski/pi-extensions](https://github.com/kasuboski/pi-extensions):

**Extensions** (3): status-tracker, subagent, tinyfish (with `@tiny-fish/sdk` + transitive deps)
**Skills** (5): agent-browser, deepwiki, develop-testing-strategy, github-actions, grugbrain

Extensions are built with `buildNpmPackage`, which patches the upstream lockfile to add missing integrity hashes for 3 peer dependency entries. Transitive npm dependencies (e.g. `p-retry` inside `@tiny-fish/sdk`) are fully resolved.

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
