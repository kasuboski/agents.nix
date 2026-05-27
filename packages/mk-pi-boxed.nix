# Creates a boxed pi binary that runs pi inside a microsandbox VM
# with unexploitable secrets (TLS proxy substitutes placeholders).
#
# Approach: copies the aarch64-linux nix closure to a temp dir at runtime,
# then mounts it into an ubuntu VM at /nix/store. Extensions and skills are
# included in the closure and loaded via -e/--skill flags.
#
# Arguments:
#   pkgs          - nixpkgs set (native system, e.g. aarch64-darwin)
#   llm-agents-pi - the upstream pi package from llm-agents.nix (native)
#   llm-agents-pi-linux - the upstream pi package (aarch64-linux, for VM)
#   msb           - the microsandbox CLI package
#   closure       - path to the nix closure directory (from mk-pi-rootfs)
#   sops-file     - path to the encrypted secrets file
#   profile       - optional profile name suffix
#   extensions    - optional attrset of extension name → nix store path (linux)
#   skills        - optional attrset of skill name → nix store path (linux)
{
  pkgs,
  llm-agents-pi,
  llm-agents-pi-linux,
  msb,
  closure,
  sops-file,
  profile ? null,
  extensions ? { },
  skills ? { },
}:

let
  name = if profile == null then "pi-boxed" else "pi-${profile}-boxed";
  lib = pkgs.lib;

  # Maps secret env var names to the API host they're allowed to be sent to.
  secretHosts = {
    GITHUB_TOKEN = "github.com";
    TINYFISH_API_KEY = "agent.tinyfish.ai";
    ZAI_API_KEY = "api.z.ai";
  };

  # Generate the shell code for building --secret flags.
  mkSecretFlag = key: host: ''
    val=$(echo "$SECRETS" | jq -r '.${key}')
    if [ "$val" != "null" ] && [ -n "$val" ]; then
      MSB_SECRET_ARGS+=(--secret "${key}=$val@${host}")
    fi
  '';

  # Build -e <path> flags for each extension (using linux paths)
  extensionFlags = lib.concatMapStringsSep " " (path: "-e ${path}") (
    lib.attrValues extensions
  );

  # Build --skill <path> flags for each skill
  skillFlags = lib.concatMapStringsSep " " (path: "--skill ${path}") (
    lib.attrValues skills
  );
in
pkgs.writeShellApplication {
  inherit name;

  runtimeInputs = with pkgs; [
    sops
    jq
    msb
    coreutils
  ];

  text = ''
    # Decrypt secrets at runtime. sops finds the SSH private key automatically
    # and prompts for the passphrase via /dev/tty when run from a terminal.
    if ! SECRETS=$(sops -d --input-type json --output-type json "${sops-file}"); then
      echo "ERROR: Failed to decrypt ${sops-file}" >&2
      echo "Ensure sops can access your SSH key (passphrase prompt or ssh-agent)." >&2
      echo "Alternatively, create an age identity:" >&2
      echo "  ssh-to-age -private-key -i ~/.ssh/id_ed25519 -o ~/.config/sops/age/keys.txt" >&2
      exit 1
    fi

    # Build --secret flags for microsandbox.
    MSB_SECRET_ARGS=()

    ${lib.concatStringsSep "\n    " (lib.mapAttrsToList mkSecretFlag secretHosts)}

    # Copy the nix closure to a temp dir.
    # The nix store has root-owned read-only files that msb's virtiofs
    # can't read on macOS (HVF permission denied). A user-owned copy
    # in /tmp works fine.
    NIX_CLOSURE=$(mktemp -d /tmp/pi-boxed-closure.XXXXXX)
    trap 'rm -rf "$NIX_CLOSURE"' EXIT
    cp -a "${closure}/nix/store/." "$NIX_CLOSURE/"
    chmod -R u+w "$NIX_CLOSURE" 2>/dev/null || true

    # Run pi inside a microsandbox ubuntu VM.
    # Mount the nix closure at /nix/store so pi finds its dependencies.
    # Extensions and skills are loaded via flags pointing at /nix/store paths.
    exec msb run ubuntu \
      --volume "$NIX_CLOSURE:/nix/store" \
      "''${MSB_SECRET_ARGS[@]}" \
      -- ${llm-agents-pi-linux}/bin/pi ${extensionFlags} ${skillFlags} "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) in a microsandbox VM with unexploitable secrets";
    # microsandbox is not available on x86_64-darwin
    platforms = lib.platforms.linux ++ [ "aarch64-darwin" ];
    mainProgram = name;
  };
}
