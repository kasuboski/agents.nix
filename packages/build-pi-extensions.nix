# Builds pi-extensions from source.
# All extensions use buildNpmPackage to resolve their dependency tree.
# The upstream lockfile is patched at eval time (before fetchNpmDeps) to add
# missing integrity hashes for peer dependency entries.
# Skills don't need building — just copied as-is.
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

  # NPM dependency hashes per extension.
  # Update by setting to lib.fakeSha256, building, and copying the "got:" value.
  npmDepsHashes = {
    tinyfish = "sha256-dsWpcEg/dsc2nT9EAiksI+4PJro5pVCQY51hd0Mnwzs="; # includes @tiny-fish/sdk
    subagent = "sha256-SHJTloDG4hQeF/4ODgG7mWqpPTj6+1q0VVz+pxg7ZxI=";
    status-tracker = "sha256-qiY0Xxe0huO1mePe+dXMhtXhEToyOBu4rlE270NMzjU=";
  };

  # Integrity hashes for 3 packages missing from the upstream lockfile.
  # These are transitive peer deps of pi-coding-agent (provided at runtime by pi).
  patchedIntegrities = {
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core" =
      "sha512-LHygOgsW2pgXKb3IkXkOAeZPovHr9VF+EixgXVsDNuB4jmhEOXgshy/zksZ7slkUAx10OQ9W1Ed/2jsnhd1NqA==";
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui" =
      "sha512-LkXUM1/49pvzzeI39Y5wjBMlgafcCf67HCLhB9Z7yuXHy4XgT+VqxWcZVW5hBdhQsHZd0znjJotfGH1BzxMfiA==";
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai" =
      "sha512-zf1F5kXk1pqZeFShXOqq9ibUk8QdtRoLCDPAjO+hj44e3EUs9/GFO2qnhTC5+JA2uwVCx+WCNe1PiCjlBYWm5w==";
  };

  # Patch the lockfile at eval time (returns a JSON string)
  patchLockfileJSON =
    extSrc:
    let
      lockfile = builtins.fromJSON (builtins.readFile "${extSrc}/package-lock.json");
    in
    builtins.toJSON (
      lockfile
      // {
        packages = lib.mapAttrs (
          path: pkg:
          if patchedIntegrities ? ${path} && pkg ? resolved && !(pkg ? integrity) then
            pkg // { integrity = patchedIntegrities.${path}; }
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

in
{
  inherit extensions skills;
}
# v2
