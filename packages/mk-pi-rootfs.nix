# Builds a minimal rootfs containing the nix store closure for pi (Linux).
# Used by the boxed wrapper to run pi inside a microsandbox VM.
#
# The rootfs contains the full nix runtime closure at /nix/store paths,
# plus minimal FHS directories (/bin/sh, /tmp, /etc).
# Optionally includes extensions and skills directories.
#
# Arguments:
#   pkgs          - nixpkgs set (aarch64-linux)
#   llm-agents-pi - the upstream pi package (must be for the target Linux arch)
#   extensions    - optional attrset of extension name → nix store path
#   skills        - optional attrset of skill name → nix store path
#   extraPackages - optional list of additional packages to include in the closure
#   entrypoint    - optional entrypoint script to include in the closure
{
  pkgs,
  llm-agents-pi,
  extensions ? { },
  skills ? { },
  extraPackages ? [ ],
  entrypoint ? null,
}:

let
  # closureInfo computes the runtime closure at evaluation time
  closure = pkgs.closureInfo {
    rootPaths = [ llm-agents-pi ] ++ extraPackages ++ pkgs.lib.optional (entrypoint != null) entrypoint;
  };

  bashPkg = pkgs.bash;

  # Extension paths that need to be in the closure
  extensionPaths = builtins.attrValues extensions;
  skillPaths = builtins.attrValues skills;
in
pkgs.runCommand "pi-rootfs" { } ''
  mkdir -p $out/nix/store $out/bin $out/tmp $out/etc

  # Copy each store path from the closure into the rootfs.
  # Most nix store paths are directories, but single-file derivations
  # (e.g. writeShellScript) produce plain files that must also be copied.
  while IFS= read -r path; do
    if [ -d "$path" ] || [ -f "$path" ]; then
      cp -a "$path" "$out/nix/store/$(basename "$path")"
    fi
  done < "${closure}/store-paths"

  # Copy extensions and skills into the rootfs
  # (they're already in /nix/store but may not be in pi's closure)
  ${pkgs.lib.concatMapStringsSep "\n" (path: ''
    basename=$(basename "${path}")
    if [ ! -e "$out/nix/store/$basename" ]; then
      cp -a "${path}" "$out/nix/store/$basename"
    fi
  '') (extensionPaths ++ skillPaths)}

  # Symlink bash to /bin/sh so shell scripts work inside the VM
  ln -sf "${bashPkg}/bin/bash" "$out/bin/sh"
  ln -sf "${bashPkg}/bin/bash" "$out/bin/bash"
''
