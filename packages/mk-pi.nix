# Creates a wrapped pi binary that decrypts secrets at runtime and launches pi.
#
# Arguments:
#   pkgs         - nixpkgs set
#   llm-agents-pi - the upstream pi package from llm-agents.nix
#   sops-file    - path to the encrypted secrets file (e.g. ./secrets/personal.enc.json)
#   profile      - optional profile name suffix (e.g. "work"). When set, the binary is named "pi-<profile>"
{
  pkgs,
  llm-agents-pi,
  sops-file,
  profile ? null,
}:

let
  name = if profile == null then "pi" else "pi-${profile}";
  lib = pkgs.lib;
in
pkgs.writeShellApplication {
  inherit name;

  runtimeInputs = with pkgs; [
    sops
    jq
    llm-agents-pi
  ];

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

    # Launch the real pi binary with all passed arguments
    exec pi "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) with API keys from sops";
    platforms = lib.platforms.all;
    mainProgram = name;
  };
}
