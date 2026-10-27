# Builds a minimal rootfs containing the nix store closure for pi (Linux).
# Used by the boxed wrapper to run pi inside a microsandbox VM.
#
# The rootfs contains the full nix runtime closure at /nix/store paths,
# plus minimal FHS directories (/bin/sh, /tmp, /etc).
# Optionally includes extension, skill, and theme paths and their runtime closures.
#
# Arguments:
#   pkgs          - nixpkgs set (aarch64-linux)
#   llm-agents-pi - the upstream pi package (must be for the target Linux arch)
#   extensions    - optional attrset of extension name → nix store path
#   skills        - optional attrset of skill name → nix store path
#   themes        - optional attrset of theme package name → nix store path
#   extraPackages - optional list of additional packages to include in the closure
#   entrypoint    - optional entrypoint script to include in the closure
{
  pkgs,
  llm-agents-pi,
  extensions ? { },
  skills ? { },
  themes ? { },
  extraPackages ? [ ],
  entrypoint ? null,
}:

let
  bashPkg = pkgs.bash;

  # Resources may name a file or directory beneath an output. closureInfo needs
  # the owning store root, not that subpath. Keep the original string context
  # so Nix still builds the referenced output before computing its closure.
  resourceRoot =
    path:
    let
      value = toString path;
      match = builtins.match "(${builtins.storeDir}/[0-9abcdfghijklmnpqrsvwxyz]{32}-[^/]+)(/.*)?" value;
    in
    if match == null then
      throw "mk-pi-rootfs: resource must be an absolute Nix store path: ${value}"
    else
      builtins.substring 0 (builtins.stringLength (builtins.head match)) value;

  resourcePaths =
    builtins.attrValues extensions ++ builtins.attrValues skills ++ builtins.attrValues themes;

  # Compute one combined closure at build time. Shared dependencies and multiple
  # resources in the same output are copied only once, at their original paths.
  closure = pkgs.closureInfo {
    rootPaths = [
      llm-agents-pi
      bashPkg
    ]
    ++ extraPackages
    ++ pkgs.lib.optional (entrypoint != null) entrypoint
    ++ map resourceRoot resourcePaths;
  };
in
pkgs.runCommand "pi-rootfs" { } ''
  mkdir -p "$out${builtins.storeDir}" "$out/bin" "$out/tmp" "$out/etc"

  # Copy each store path from the closure into the rootfs.
  # Most nix store paths are directories, but single-file derivations
  # (e.g. writeShellScript) produce plain files that must also be copied.
  while IFS= read -r path; do
    cp -a -- "$path" "$out$path"
  done < "${closure}/store-paths"

  # Symlink bash to /bin/sh so shell scripts work inside the VM
  ln -sf "${bashPkg}/bin/bash" "$out/bin/sh"
  ln -sf "${bashPkg}/bin/bash" "$out/bin/bash"
''
