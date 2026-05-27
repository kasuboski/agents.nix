# Builds a minimal rootfs containing the nix store closure for pi (Linux).
# Used by the boxed wrapper to run pi inside a microsandbox VM.
#
# The rootfs contains the full nix runtime closure at /nix/store paths,
# plus minimal FHS directories (/bin/sh, /tmp, /etc).
# Nix binaries use absolute /nix/store paths for shebangs, rpaths, and
# library lookups, so everything works without modification.
#
# Arguments:
#   pkgs          - nixpkgs set (aarch64-linux)
#   llm-agents-pi - the upstream pi package (must be for the target Linux arch)
{
  pkgs,
  llm-agents-pi,
}:

let
  # closureInfo computes the runtime closure at evaluation time
  # (no nix-store command needed in the build sandbox)
  closure = pkgs.closureInfo { rootPaths = [ llm-agents-pi ]; };

  # Find bash in the closure for /bin/sh symlink
  bashPkg = pkgs.bash;
in
pkgs.runCommand "pi-rootfs" { } ''
  mkdir -p $out/nix/store $out/bin $out/tmp $out/etc

  # Copy each store path from the closure into the rootfs
  while IFS= read -r path; do
    if [ -d "$path" ]; then
      basename=$(basename "$path")
      cp -a "$path" "$out/nix/store/$basename"
    fi
  done < "${closure}/store-paths"

  # Symlink bash to /bin/sh so shell scripts work inside the VM
  ln -sf "${bashPkg}/bin/bash" "$out/bin/sh"
  ln -sf "${bashPkg}/bin/bash" "$out/bin/bash"
''
