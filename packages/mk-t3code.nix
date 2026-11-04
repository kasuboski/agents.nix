# Native T3 launcher. Decrypt once in the parent; Pi subprocesses inherit keys.
{
  pkgs,
  t3code,
  sops-file,
  profile ? null,
}:
let
  name = if profile == null then "t3code" else "t3code-${profile}";
  browserLibraries = with pkgs; [
    glibc
    glib
    nspr
    nss
    at-spi2-core
    dbus
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxkbcommon
    libgbm
    expat
    alsa-lib
    udev
  ];
in
pkgs.writeShellApplication {
  inherit name;
  runtimeInputs = with pkgs; [
    sops
    jq
    git
    bash
  ];
  text = ''
    if ! SECRETS=$(sops -d --input-type json --output-type json "${sops-file}"); then
      echo "ERROR: Failed to decrypt ${sops-file}" >&2
      echo "Ensure sops can access your SSH key or a noninteractive age identity." >&2
      exit 1
    fi
    while IFS= read -r key; do
      value=$(printf '%s' "$SECRETS" | jq -r --arg k "$key" '.[$k]')
      export "''${key}=''${value}"
    done < <(printf '%s' "$SECRETS" | jq -r 'keys[]')
    unset SECRETS value

    # Keep GitHub CLI authentication personal in T3; Pi restores this token.
    unset AGENTS_GITHUB_TOKEN
    if [[ -n "''${GITHUB_TOKEN:-}" ]]; then
      export AGENTS_GITHUB_TOKEN="$GITHUB_TOKEN"
    elif [[ -n "''${GH_TOKEN:-}" ]]; then
      export AGENTS_GITHUB_TOKEN="$GH_TOKEN"
    fi
    unset GH_TOKEN GITHUB_TOKEN

    # Isolate T3 state by profile; explicit env/CLI overrides remain available.
    export T3CODE_HOME="''${T3CODE_HOME:-$HOME/.local/share/${name}}"
    export T3CODE_TELEMETRY_ENABLED="''${T3CODE_TELEMETRY_ENABLED:-false}"
    ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
      # T3 downloads an unpatched Chrome Headless Shell. On NixOS, nix-ld
      # needs both its libraries and the matching loader (host glibc may be older).
      export NIX_LD="${pkgs.stdenv.cc.bintools.dynamicLinker}"
      export NIX_LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath browserLibraries}''${NIX_LD_LIBRARY_PATH:+:$NIX_LD_LIBRARY_PATH}"
    ''}
    exec ${t3code}/bin/t3 "$@"
  '';
  meta = {
    description = "T3 Code (${name}) with runtime sops secrets and bundled Pi";
    mainProgram = name;
    inherit (t3code.meta) platforms;
  };
}
