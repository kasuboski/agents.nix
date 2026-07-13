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
#   themes        - optional attrset of theme package name → nix store path
#   extraPackages - optional list of additional packages to add to PATH
{
  pkgs,
  llm-agents-pi,
  sops-file,
  profile ? null,
  extensions ? { },
  skills ? { },
  themes ? { },
  extraPackages ? [ ],
}:

let
  name = if profile == null then "pi" else "pi-${profile}";
  lib = pkgs.lib;

  # Build -e <path> flags for each extension
  extensionFlags = lib.concatMapStringsSep " " (path: "-e ${path}") (lib.attrValues extensions);

  # Build --skill/--theme flags for each bundled resource path
  skillFlags = lib.concatMapStringsSep " " (path: "--skill ${path}") (lib.attrValues skills);
  themeFlags = lib.concatMapStringsSep " " (path: "--theme ${path}") (lib.attrValues themes);

  # Bundled variants load only their explicit Nix resources. Pi keeps explicit
  # resource paths enabled when automatic discovery is disabled.
  discoveryFlags = lib.concatStringsSep " " (
    lib.optional (extensions != { }) "--no-extensions"
    ++ lib.optional (skills != { }) "--no-skills"
    ++ lib.optional (themes != { }) "--no-themes"
  );
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

    # Keep package resolution read-only. Pi still loads local paths and already
    # installed packages from the user's settings, but it does not clone, run
    # npm, reconcile packages, check for updates, or emit install telemetry.
    # Bundled resources are local Nix store paths passed below.
    export PI_OFFLINE=1

    # Launch the real pi binary with any passed arguments. Bundled variants
    # disable resource discovery and load only the explicit resource paths.
    exec pi ${discoveryFlags} ${extensionFlags} ${skillFlags} ${themeFlags} "$@"
  '';

  meta = {
    description = "Pi coding agent (${name}) with API keys from sops";
    platforms = lib.platforms.all;
    mainProgram = name;
  };
}
