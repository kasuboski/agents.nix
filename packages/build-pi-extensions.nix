# Builds pi-extensions from source.
# All extensions use buildNpmPackage to resolve their dependency tree.
# The upstream lockfile is patched at eval time (before fetchNpmDeps) to add
# missing integrity hashes for peer dependency entries.
# Skills don't need building — just copied as-is. Root package dependencies
# provide additional resources such as themes.
#
# Arguments:
#   pkgs     - nixpkgs set
#   src      - path to the pi-extensions source tree
{
  pkgs,
  src,
}:

let
  lib = pkgs.lib;

  extensionNames = builtins.attrNames (builtins.readDir "${src}/extensions");
  skillNames = builtins.attrNames (builtins.readDir "${src}/skills");

  # Root package dependencies (currently the Catppuccin theme).
  packageResources = pkgs.buildNpmPackage {
    pname = "pi-extension-resources";
    version = "1.0.0";
    inherit src;

    dontBuild = true;
    npmDepsHash = "sha256-LT20QQWh73XxJ96JhtWAvScYC3P2qbc1i0fe3u9cJCc=";
    npmDepsFetcherVersion = 2;

    installPhase = ''
      mkdir -p $out
      cp -r node_modules/pi-coding-agent-catppuccin $out/catppuccin
    '';
  };

  # NPM dependency hashes per extension.
  # Update by setting to lib.fakeHash, building, and copying the "got:" value.
  npmDepsHashes = {
    tinyfish = "sha256-Vb/9Q825/y+KnOMeTK3EvIntEAzDgakq7LrKMaaJQ88="; # includes @tiny-fish/sdk
    agent = "sha256-Cky6DFM+mgjXOwDZiLv85BzQhwh79w/PUQ7/L1qwUbk=";
    morphllm = "sha256-edi32j+rEdGjkH8J8qjKwXSADfFrQzbRE9xa8vqfb3Q=";
    status-tracker = "sha256-qiY0Xxe0huO1mePe+dXMhtXhEToyOBu4rlE270NMzjU=";
  };

  # npm v7+ omits `integrity` for auto-installed peer deps of
  # @earendil-works/pi-coding-agent (they get a `resolved` tarball URL but no
  # hash). fetchNpmDeps requires integrity on every resolvable entry, so we
  # backfill it at eval time.
  #
  # Primary source: a sibling entry in the same lockfile with the same
  # `resolved` URL that already carries an integrity (npm usually has one).
  # This is version-agnostic, so it survives pi version bumps.
  #
  # Fallback: knownIntegrities below, keyed by resolved tarball URL. Add an
  # entry ONLY when sibling lookup fails for a URL (rare) — this is the only
  # version-pinned data, and far narrower than pinning by lockfile path.
  knownIntegrities = {
    "https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.75.5.tgz" =
      "sha512-LkXUM1/49pvzzeI39Y5wjBMlgafcCf67HCLhB9Z7yuXHy4XgT+VqxWcZVW5hBdhQsHZd0znjJotfGH1BzxMfiA==";
  };

  # Patch the lockfile at eval time (returns a JSON string): for every entry
  # with a resolved URL but no integrity, fill it from a sibling entry or the
  # knownIntegrities fallback. Siblings take precedence (lockfile-local).
  patchLockfileJSON =
    extSrc:
    let
      lockfile = builtins.fromJSON (builtins.readFile "${extSrc}/package-lock.json");

      # resolved URL -> integrity, from entries that already have both.
      siblingMap = lib.foldl' (
        acc: pkg:
        let
          resolved = pkg.resolved or null;
        in
        if resolved != null && pkg ? integrity then acc // { ${resolved} = pkg.integrity; } else acc
      ) { } (builtins.attrValues lockfile.packages);

      resolvedToIntegrity = knownIntegrities // siblingMap;
    in
    builtins.toJSON (
      lockfile
      // {
        packages = lib.mapAttrs (
          path: pkg:
          let
            resolved = pkg.resolved or null;
          in
          if resolved != null && !(pkg ? integrity) && resolvedToIntegrity ? ${resolved} then
            pkg // { integrity = resolvedToIntegrity.${resolved}; }
          else
            pkg
        ) lockfile.packages;
      }
    );

  # Create a patched source derivation for an extension
  # (replaces package-lock.json before buildNpmPackage reads it)
  patchedExtensionSrc =
    extName:
    let
      extSrc = "${src}/extensions/${extName}";
    in
    pkgs.runCommand "pi-${extName}-src" { } ''
      cp -r "${extSrc}" $out
      chmod -R u+w $out
      cat > $out/package-lock.json << 'LOCKFILE_EOF'
      ${patchLockfileJSON extSrc}
      LOCKFILE_EOF
    '';

  # Build a single extension
  buildExtension =
    extName:
    let
      patchedSrc = patchedExtensionSrc extName;
    in
    pkgs.buildNpmPackage {
      pname = "pi-${extName}";
      version = "1.0.0";
      src = patchedSrc;

      # Extensions are TypeScript loaded by pi at runtime — no build step
      dontBuild = true;

      npmDepsHash = npmDepsHashes.${extName} or lib.fakeSha256;
      npmDepsFetcherVersion = 2;

      installPhase = ''
        cp -r . $out
      '';
    };

  extensions = lib.genAttrs extensionNames buildExtension;

  skills = lib.genAttrs skillNames (
    skillName:
    pkgs.runCommand "pi-skill-${skillName}" { } ''
      cp -r "${src}/skills/${skillName}" $out
    ''
  );

  themes = {
    catppuccin = "${packageResources}/catppuccin";
  };

in
{
  inherit extensions skills themes;
}
# v2
