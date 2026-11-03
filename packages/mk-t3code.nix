# Native T3 launcher. Decrypt once in the parent; Pi subprocesses inherit keys.
{
  pkgs,
  t3code,
  sops-file,
  profile ? null,
}:
let
  name = if profile == null then "t3code" else "t3code-${profile}";
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

    # Isolate T3 state by profile; explicit env/CLI overrides remain available.
    export T3CODE_HOME="''${T3CODE_HOME:-$HOME/.local/share/${name}}"
    export T3CODE_TELEMETRY_ENABLED="''${T3CODE_TELEMETRY_ENABLED:-false}"
    exec ${t3code}/bin/t3 "$@"
  '';
  meta = {
    description = "T3 Code (${name}) with runtime sops secrets and bundled Pi";
    mainProgram = name;
    inherit (t3code.meta) platforms;
  };
}
