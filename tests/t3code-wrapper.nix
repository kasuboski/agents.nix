# nix build --impure --file tests/t3code-wrapper.nix --no-link
let
  flake = builtins.getFlake (toString ../.);
  pkgs = flake.inputs.nixpkgs.legacyPackages.${builtins.currentSystem};
  fakeSops = pkgs.writeShellScriptBin "sops" ''
    echo call >> "$TEST_CALLS"
    if [ "''${TEST_FAIL:-0}" = 1 ]; then exit 1; fi
    printf '%s' '{"TEST_API_KEY":"secret with spaces","GITHUB_TOKEN":"agent-token"}'
  '';
  fakePi = pkgs.writeShellScriptBin "pi" ''
    set -e
    test "$GH_TOKEN" = agent-token
    test "$GITHUB_TOKEN" = agent-token
    test "''${AGENTS_GITHUB_TOKEN+x}" != x
    test "$PI_OFFLINE" = 1
    test "$TEST_API_KEY" = 'secret with spaces'
    printf '%s\n' "$@" >> "$TEST_ARGS"
  '';
  pi = import ../packages/mk-pi.nix {
    inherit pkgs;
    llm-agents-pi = fakePi;
    restoreGithubToken = true;
  };
  t3 = pkgs.writeShellApplication {
    name = "t3";
    runtimeInputs = [ pi ];
    text = ''
      test "$T3CODE_HOME" = "$EXPECTED_HOME"
      test "$T3CODE_TELEMETRY_ENABLED" = false
      ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
        test "$NIX_LD" = "${pkgs.stdenv.cc.bintools.dynamicLinker}"
        "$NIX_LD" --version > /dev/null
        case "$NIX_LD_LIBRARY_PATH" in
          *:/extra-browser-libs) ;;
          *) echo 'existing browser library path was lost' >&2; exit 1 ;;
        esac
        for library in libglib-2.0.so.0 libnss3.so libnspr4.so libatk-1.0.so.0 \
          libatk-bridge-2.0.so.0 libatspi.so.0 libdbus-1.so.3 libX11.so.6 \
          libxcb.so.1 libXcomposite.so.1 libXdamage.so.1 libXext.so.6 \
          libXfixes.so.3 libXrandr.so.2 libxkbcommon.so.0 libgbm.so.1 \
          libexpat.so.1 libasound.so.2 libudev.so.1 libc.so.6; do
          found=0
          IFS=: read -r -a directories <<< "$NIX_LD_LIBRARY_PATH"
          for directory in "''${directories[@]}"; do
            if [[ -e "$directory/$library" ]]; then found=1; break; fi
          done
          if [[ "$found" != 1 ]]; then
            echo "missing browser library: $library" >&2
            exit 1
          fi
        done
      ''}
      test "''${GH_TOKEN+x}" != x
      test "''${GITHUB_TOKEN+x}" != x
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
  export GH_TOKEN=ambient-token
  export NIX_LD=/old-loader NIX_LD_LIBRARY_PATH=/extra-browser-libs
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
