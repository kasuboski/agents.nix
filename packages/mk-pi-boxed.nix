# Creates a boxed pi binary that runs pi inside a microsandbox VM
# with unexploitable secrets (TLS proxy substitutes placeholders).
#
# Approach: copies the aarch64-linux nix closure to a temp dir at runtime,
# then mounts it into an ubuntu VM at /nix/store. Extensions, skills, and
# themes are included in the closure and loaded via explicit flags.
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
#   themes        - optional attrset of theme package name → nix store path (linux)
#   entrypoint    - path to the entrypoint script (linux derivation) that sets PATH
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
  themes ? { },
  entrypoint,
}:

let
  name = if profile == null then "pi-boxed" else "pi-${profile}-boxed";
  lib = pkgs.lib;

  # Maps secret env var names to the hosts they're allowed to be sent to.
  # Each secret can be scoped to multiple hosts (e.g. GITHUB_TOKEN needs both
  # github.com and api.github.com because msb host matching is exact, not
  # suffix-based — github.com does NOT match api.github.com).
  secretHosts = {
    GITHUB_TOKEN = [
      "github.com"
      "api.github.com"
    ];
    TINYFISH_API_KEY = [ "agent.tinyfish.ai" ];
    ZAI_API_KEY = [ "api.z.ai" ];
  };

  # Generate the shell code for building --secret flags.
  # Produces one --secret flag per host (e.g. GITHUB_TOKEN is repeated for
  # each of its allowed hosts).
  mkSecretFlags = key: hosts: ''
    val=$(echo "$SECRETS" | jq -r '.${key}')
    if [ "$val" != "null" ] && [ -n "$val" ]; then
    ${lib.concatStringsSep "\n    " (
      map (host: ''MSB_SECRET_ARGS+=(--secret "${key}=$val@${host}")'') hosts
    )}
    fi
  '';

  # Build -e <path> flags for each extension (using linux paths)
  extensionFlags = lib.concatMapStringsSep " " (path: "-e ${path}") (lib.attrValues extensions);

  # Build --skill/--theme flags for each bundled resource path
  skillFlags = lib.concatMapStringsSep " " (path: "--skill ${path}") (lib.attrValues skills);
  themeFlags = lib.concatMapStringsSep " " (path: "--theme ${path}") (lib.attrValues themes);

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

    ${lib.concatStringsSep "\n    " (lib.mapAttrsToList mkSecretFlags secretHosts)}

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
    # The entrypoint script sets PATH inside the VM so tools are discoverable.
    # Using an entrypoint script instead of --env because --env interferes
    # with msb's --secret mechanism for unexploitable secrets.
    exec msb run ubuntu \
      --volume "$NIX_CLOSURE:/nix/store" \
      "''${MSB_SECRET_ARGS[@]}" \
      -- ${entrypoint} ${llm-agents-pi-linux}/bin/pi ${extensionFlags} ${skillFlags} ${themeFlags} "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) in a microsandbox VM with unexploitable secrets";
    # microsandbox is not available on x86_64-darwin
    platforms = lib.platforms.linux ++ [ "aarch64-darwin" ];
    mainProgram = name;
  };
}
