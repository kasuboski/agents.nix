# Creates a sandboxed pi binary that runs pi inside a microsandbox VM
# with unexploitable secrets (TLS proxy substitutes placeholders).
#
# Arguments:
#   pkgs          - nixpkgs set
#   llm-agents-pi - the upstream pi package from llm-agents.nix
#   msb           - the microsandbox CLI package
#   sops-file     - path to the encrypted secrets file
#   profile       - optional profile name suffix
{
  pkgs,
  llm-agents-pi,
  msb,
  sops-file,
  profile ? null,
}:

let
  name = if profile == null then "pi-sandboxed" else "pi-${profile}-sandboxed";
  lib = pkgs.lib;

  # Maps secret env var names to the API host they're allowed to be sent to.
  # The sandbox sees a placeholder ($MSB_<KEY>) and the TLS proxy only injects
  # the real value when the request goes to the matching host.
  secretHosts = {
    GITHUB_TOKEN = "github.com";
    TINYFISH_API_KEY = "agent.tinyfish.ai";
    Z_API_KEY = "api.z.ai";
  };

  # Generate the shell code for building --secret flags.
  # Uses an array approach to avoid shellcheck issues with dynamic variable names.
  mkSecretFlag = key: host: ''
    val=$(echo "$SECRETS" | jq -r '.${key}')
    if [ "$val" != "null" ] && [ -n "$val" ]; then
      MSB_SECRET_ARGS+=(--secret "${key}=$val@${host}")
    fi
  '';
in
pkgs.writeShellApplication {
  inherit name;

  runtimeInputs = with pkgs; [
    sops
    jq
    msb
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
    # Format: --secret "KEY=value@api.host.com"
    # The VM sees a placeholder $MSB_KEY; the TLS proxy substitutes
    # the real value only for requests matching the host.
    MSB_SECRET_ARGS=()

    ${lib.concatStringsSep "\n    " (lib.mapAttrsToList mkSecretFlag secretHosts)}

    # Run pi inside a microsandbox VM.
    # We mount the nix store read-only so the VM can access the pi binary
    # and its runtime dependencies (fd, ripgrep, node, etc).
    exec msb run alpine \
      --volume /nix/store:/nix/store:ro \
      "''${MSB_SECRET_ARGS[@]}" \
      -- ${llm-agents-pi}/bin/pi "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) sandboxed in microsandbox VM with unexploitable secrets";
    # microsandbox is not available on x86_64-darwin
    platforms = lib.platforms.linux ++ [ "aarch64-darwin" ];
    mainProgram = name;
  };
}
