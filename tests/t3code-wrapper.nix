# nix build --impure --file tests/t3code-wrapper.nix --no-link
let
  flake = builtins.getFlake (toString ../.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
  fakeSops = pkgs.writeShellScriptBin "sops" ''
    echo call >> "$TEST_CALLS"
    if [ "''${TEST_FAIL:-0}" = 1 ]; then exit 1; fi
    printf '%s' '{"TEST_API_KEY":"secret with spaces"}'
  '';
  fakePi = pkgs.writeShellScriptBin "pi" ''
    test "$PI_OFFLINE" = 1
    test "$TEST_API_KEY" = 'secret with spaces'
    printf '%s\n' "$@" >> "$TEST_ARGS"
  '';
  pi = import ../packages/mk-pi.nix {
    inherit pkgs;
    llm-agents-pi = fakePi;
  };
  t3 = pkgs.writeShellApplication {
    name = "t3";
    runtimeInputs = [ pi ];
    text = ''
      test "$T3CODE_HOME" = "$EXPECTED_HOME"
      test "$T3CODE_TELEMETRY_ENABLED" = false
      pi --mode rpc "$@"
      pi --version
    '';
    meta.platforms = pkgs.lib.platforms.all;
  };
  mkWrapper =
    profile:
    import ../packages/mk-t3code.nix {
      pkgs = pkgs // {
        sops = fakeSops;
      };
      t3code = t3;
      sops-file = pkgs.writeText "encrypted-fixture" "not a real secret";
      inherit profile;
    };
  personal = mkWrapper null;
  work = mkWrapper "work";
in
pkgs.runCommand "t3code-wrapper-tests" { } ''
  export HOME="$TMPDIR/home"
  mkdir -p "$HOME"
  export TEST_CALLS="$TMPDIR/calls" TEST_ARGS="$TMPDIR/args"
  export EXPECTED_HOME="$HOME/.local/share/t3code"
  ${personal}/bin/t3code 'argument with spaces'
  test "$(wc -l < "$TEST_CALLS")" = 1
  grep -Fx -- 'argument with spaces' "$TEST_ARGS"
  grep -Fx -- '--mode' "$TEST_ARGS"
  export EXPECTED_HOME="$HOME/.local/share/t3code-work"
  ${work}/bin/t3code-work
  test "$(wc -l < "$TEST_CALLS")" = 2
  export T3CODE_HOME="$TMPDIR/custom" EXPECTED_HOME="$TMPDIR/custom"
  ${work}/bin/t3code-work
  export TEST_FAIL=1
  if ${personal}/bin/t3code; then
    echo 'decryption failure should abort' >&2
    exit 1
  fi
  touch "$out"
''
