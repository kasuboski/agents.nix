# Creates a wrapped pi binary that decrypts secrets at runtime and launches pi
# with optional extensions and skills loaded via -e/--skill flags.
#
# Arguments:
#   pkgs          - nixpkgs set
#   llm-agents-pi - the upstream pi package from llm-agents.nix
#   sops-file     - path to the encrypted secrets file (e.g. ./secrets/personal.enc.json)
#   profile       - optional profile name suffix (e.g. "work"). When set, the binary is named "pi-<profile>"
#   extensions    - optional attrset of extension name → nix store path
#   skills        - optional attrset of skill name → nix store path
#   extraPackages - optional list of additional packages to add to PATH
{
  pkgs,
  llm-agents-pi,
  sops-file,
  profile ? null,
  extensions ? { },
  skills ? { },
  extraPackages ? [ ],
}:

let
  name = if profile == null then "pi" else "pi-${profile}";
  lib = pkgs.lib;

  # Build -e <path> flags for each extension
  extensionFlags = lib.concatMapStringsSep " " (path: "-e ${path}") (lib.attrValues extensions);

  # Build --skill <path> flags for each skill
  skillFlags = lib.concatMapStringsSep " " (path: "--skill ${path}") (lib.attrValues skills);
in
pkgs.writeShellApplication {
  inherit name;

  runtimeInputs =
    (with pkgs; [
      sops
      jq
      llm-agents-pi
    ])
    ++ extraPackages;

  text = ''
    # Decrypt secrets at runtime. sops finds the SSH private key automatically
    # and prompts for the passphrase via /dev/tty when run from a terminal.
    # For non-interactive use, set up ~/.config/sops/age/keys.txt via ssh-to-age.
    if ! SECRETS=$(sops -d --input-type json --output-type json "${sops-file}"); then
      echo "ERROR: Failed to decrypt ${sops-file}" >&2
      echo "Ensure sops can access your SSH key (passphrase prompt or ssh-agent)." >&2
      echo "Alternatively, create an age identity:" >&2
      echo "  ssh-to-age -private-key -i ~/.ssh/id_ed25519 -o ~/.config/sops/age/keys.txt" >&2
      exit 1
    fi

    # Export each key from the secrets file as an environment variable.
    # Only exports keys that exist in the encrypted file.
    for key in $(echo "$SECRETS" | jq -r 'keys[]'); do
      value=$(echo "$SECRETS" | jq -r --arg k "$key" '.[$k]')
      export "''${key}=''${value}"
    done

    # Launch the real pi binary with any passed arguments.
    # If extensions/skills were provided, they're passed via -e/--skill flags.
    # The user's ~/.pi/agent/ settings are fully preserved — this wrapper is
    # additive and does not set PI_CODING_AGENT_DIR.
    exec pi ${extensionFlags} ${skillFlags} "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) with API keys from sops";
    platforms = lib.platforms.all;
    mainProgram = name;
  };
}
