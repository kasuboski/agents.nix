# Run without a VM or real Pi: nix build --impure --file tests/pi-rootfs.nix --no-link -L
{
  pkgs ? import (builtins.getFlake (toString ../.)).inputs.nixpkgs {
    system = builtins.currentSystem;
  },
}:
let
  mkRootfs = import ../packages/mk-pi-rootfs.nix;
  leaf = pkgs.writeText "rootfs-transitive-dependency" "transitive dependency\n";
  dependency = pkgs.runCommand "rootfs-node-module" { } ''
    mkdir -p "$out"
    ln -s ${leaf} "$out/data"
  '';
  extension = pkgs.runCommand "rootfs-extension" { } ''
    mkdir -p "$out/extension/node_modules"
    echo 'export default () => {};' > "$out/extension/index.ts"
    ln -s ${dependency} "$out/extension/node_modules/dependency"
  '';
  skillDependency = pkgs.writeText "rootfs-skill-dependency" "skill helper\n";
  skill = pkgs.runCommand "rootfs-skill" { } ''
    mkdir -p "$out/skills/example"
    echo 'See ${skillDependency}' > "$out/skills/example/SKILL.md"
  '';
  themeDependency = pkgs.writeText "rootfs-theme-dependency" "theme dependency\n";
  themes = pkgs.runCommand "rootfs-themes" { } ''
    mkdir -p "$out/catppuccin" "$out/other"
    echo '{"name":"mocha","dependency":"${themeDependency}"}' > "$out/catppuccin/palette.json"
    echo '{"name":"other"}' > "$out/other/palette.json"
  '';
  plainTheme = pkgs.writeText "rootfs-plain-theme.json" ''{"name":"plain"}'';
  extraDependency = pkgs.writeText "rootfs-extra-dependency" "extra dependency\n";
  extraPackage = pkgs.writeTextDir "share/extra" "${extraDependency}";
  entrypointDependency = pkgs.writeText "rootfs-entrypoint-dependency" "entrypoint dependency\n";
  # Deliberately no Bash reference: the builder must include its own /bin/sh target.
  entrypoint = pkgs.writeText "rootfs-entrypoint" "${entrypointDependency}";
  fakePi = pkgs.writeTextDir "bin/pi" "fake Pi\n";
  rootfs = mkRootfs {
    inherit pkgs entrypoint;
    llm-agents-pi = fakePi;
    extensions.example = "${extension}/extension";
    skills.example = "${skill}/skills/example";
    themes = {
      mocha = "${themes}/catppuccin/palette.json";
      other = "${themes}/other/palette.json";
      plain = plainTheme;
    };
    extraPackages = [ extraPackage ];
  };
  minimalRootfs = mkRootfs {
    inherit pkgs;
    llm-agents-pi = fakePi;
  };
in
pkgs.runCommand "pi-rootfs-regression" { } ''
  failures=0
  check() {
    if ! "$@"; then
      echo "FAIL: $*" >&2
      failures=$((failures + 1))
    fi
  }

  # Exact absolute paths passed by wrappers, including nested resources and
  # same-basename palettes, must exist beneath the rootfs prefix.
  check cmp ${extension}/extension/index.ts ${rootfs}${extension}/extension/index.ts
  check cmp ${skill}/skills/example/SKILL.md ${rootfs}${skill}/skills/example/SKILL.md
  check cmp ${themes}/catppuccin/palette.json ${rootfs}${themes}/catppuccin/palette.json
  check cmp ${themes}/other/palette.json ${rootfs}${themes}/other/palette.json
  check cmp ${plainTheme} ${rootfs}${plainTheme}
  check test ! -e ${rootfs}/nix/store/palette.json
  check test ! -e ${rootfs}/nix/store/extension
  check test ! -e ${rootfs}/nix/store/example

  # Check targets under the rootfs prefix, not host-resolved absolute symlinks:
  # otherwise the host store can mask missing sandbox dependencies.
  check test "$(readlink ${rootfs}${extension}/extension/node_modules/dependency)" = ${dependency}
  check test "$(readlink ${rootfs}${dependency}/data)" = ${leaf}
  ${pkgs.lib.concatMapStringsSep "\n"
    (path: ''
      check cmp ${path} ${rootfs}${path}
    '')
    [
      leaf
      skillDependency
      themeDependency
      extraDependency
      entrypoint
      entrypointDependency
    ]
  }
  check cmp ${extraPackage}/share/extra ${rootfs}${extraPackage}/share/extra
  check cmp ${fakePi}/bin/pi ${rootfs}${fakePi}/bin/pi
  for fs in ${rootfs} ${minimalRootfs}; do
    check test "$(readlink "$fs/bin/sh")" = ${pkgs.bash}/bin/bash
    check test "$(readlink "$fs/bin/bash")" = ${pkgs.bash}/bin/bash
    check cmp ${pkgs.bash}/bin/bash "$fs${pkgs.bash}/bin/bash"
    check test -d "$fs/tmp"
    check test -d "$fs/etc"
  done
  if [ "$failures" -ne 0 ]; then
    echo "$failures rootfs regression assertion(s) failed" >&2
    exit 1
  fi
  echo 'PASS exact resource paths, plain files, transitive closures, extras, entrypoint, and Bash' > "$out"
''
