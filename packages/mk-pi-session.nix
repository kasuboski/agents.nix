# Creates a pi-session CLI that manages stateful microsandbox VMs.
#
# Docker-style lifecycle: run (create+attach), create, start, stop, rm, attach, exec, ls.
# The VM persists across stop/start cycles — filesystem state is preserved.
# Optionally uses zmx for persistent terminal sessions (auto-detected).
#
# Arguments:
#   pkgs              - nixpkgs set (native system, e.g. aarch64-darwin)
#   msb               - the microsandbox CLI package
#   closure           - path to the nix closure directory (from mk-pi-rootfs)
#   sops-file         - path to the encrypted secrets file
#   profile           - optional profile name suffix
#   entrypoint        - path to the entrypoint script (linux derivation) that sets PATH
{
  pkgs,
  msb,
  closure,
  sops-file,
  profile ? null,
  entrypoint,
}:

let
  name = if profile == null then "pi-session" else "pi-${profile}-session";
  lib = pkgs.lib;

  # Maps secret env var names to the hosts they're allowed to be sent to.
  secretHosts = {
    GITHUB_TOKEN = [
      "github.com"
      "api.github.com"
    ];
    TINYFISH_API_KEY = [ "agent.tinyfish.ai" ];
    ZAI_API_KEY = [ "api.z.ai" ];
  };

  # Generate shell code for building --secret flags from decrypted secrets.
  mkSecretFlags = key: hosts: ''
    val=$(echo "$SECRETS" | jq -r '.${key}')
    if [ "$val" != "null" ] && [ -n "$val" ]; then
    ${lib.concatStringsSep "\n    " (
      map (host: ''MSB_SECRET_ARGS+=(--secret "${key}=$val@${host}")'') hosts
    )}
    fi
  '';

  # Base directory for session data
  sessionDir = "$HOME/.local/share/${name}";

in
pkgs.writeShellApplication {
  inherit name;

  runtimeInputs = with pkgs; [
    sops
    jq
    msb
    coreutils
  ];

  text = ''
        set -euo pipefail

        SESSION_DIR="${sessionDir}"

        # ── Helpers ────────────────────────────────────────────────────────

        usage() {
          cat <<EOF
    Usage: ${name} <command> <name> [args...]

    Docker-style lifecycle for microsandbox VM sessions.

    Commands:
      run   <name>            Create + attach (primary command)
      run   <name> -d         Create without attaching (detached)
      create <name>           Create VM only (don't start)
      start <name>            Start a stopped VM
      start <name> -a         Start + attach
      attach <name>           Connect to a running VM's shell
      stop  <name>            Stop (halt) VM, preserve disk
      rm    <name>            Destroy VM and local data
      exec  <name> <cmd> ...  Run a one-off command in the VM
      ls                     List sessions
    EOF
          exit "''${1:-0}"
        }

        # Ensure the session data directory exists.
        ensure_session_dir() {
          mkdir -p "$SESSION_DIR"
        }

        # Copy the nix closure to a persistent location for this session.
        # The nix store has root-owned read-only files that msb's virtiofs
        # can't read on macOS (HVF permission denied). A user-owned copy works.
        setup_closure() {
          local session_name="$1"
          local closure_path="$SESSION_DIR/$session_name/closure"

          if [ -d "$closure_path" ]; then
            echo "Reusing existing closure for $session_name"
            return
          fi

          echo "Setting up nix closure for $session_name..."
          mkdir -p "$closure_path"
          cp -a "${closure}/nix/store/." "$closure_path/"
          chmod -R u+w "$closure_path" 2>/dev/null || true
        }

        # Remove the local session data (closure copy).
        cleanup_session() {
          local session_name="$1"
          rm -rf "$SESSION_DIR/$session_name"
        }

        # Decrypt secrets and populate MSB_SECRET_ARGS.
        decrypt_secrets() {
          if ! SECRETS=$(sops -d --input-type json --output-type json "${sops-file}"); then
            echo "ERROR: Failed to decrypt ${sops-file}" >&2
            echo "Ensure sops can access your SSH key (passphrase prompt or ssh-agent)." >&2
            echo "Alternatively, create an age identity:" >&2
            echo "  ssh-to-age -private-key -i ~/.ssh/id_ed25519 -o ~/.config/sops/age/keys.txt" >&2
            exit 1
          fi

          MSB_SECRET_ARGS=()
          ${lib.concatStringsSep "\n      " (lib.mapAttrsToList mkSecretFlags secretHosts)}
        }

        # Attach to a running VM's shell.
        # Uses zmx if available (persistent session across disconnects),
        # otherwise falls back to bare msb exec.
        do_attach() {
          local session_name="$1"
          local zmx_session="pi-''${profile:-default}-$session_name"

          if command -v zmx &>/dev/null; then
            exec zmx attach "$zmx_session" -- \
              msb exec "$session_name" -- ${entrypoint} bash
          else
            exec msb exec "$session_name" -- ${entrypoint} bash
          fi
        }

        # ── Commands ───────────────────────────────────────────────────────

        cmd_create() {
          local session_name="$1"
          shift || true

          ensure_session_dir
          setup_closure "$session_name"
          decrypt_secrets

          echo "Creating sandbox $session_name..."
          msb create --name "$session_name" ubuntu \
            --volume "$SESSION_DIR/$session_name/closure:/nix/store" \
            --volume "$PWD:/workspace" \
            "''${MSB_SECRET_ARGS[@]}"

          echo "Sandbox $session_name created."
        }

        cmd_run() {
          local session_name="$1"
          shift || true

          local detached=false
          while [ $# -gt 0 ]; do
            case "$1" in
              -d|--detach) detached=true ;;
              *) echo "Unknown option: $1" >&2; usage 1 ;;
            esac
            shift
          done

          cmd_create "$session_name"

          if [ "$detached" = true ]; then
            echo "Sandbox $session_name running in detached mode."
          else
            do_attach "$session_name"
          fi
        }

        cmd_start() {
          local session_name="$1"
          shift || true

          local attach=false
          while [ $# -gt 0 ]; do
            case "$1" in
              -a|--attach) attach=true ;;
              *) echo "Unknown option: $1" >&2; usage 1 ;;
            esac
            shift
          done

          msb start "$session_name"

          if [ "$attach" = true ]; then
            do_attach "$session_name"
          fi
        }

        cmd_stop() {
          local session_name="$1"
          shift || true

          # Kill zmx session if it exists
          local zmx_session="pi-''${profile:-default}-$session_name"
          if command -v zmx &>/dev/null; then
            zmx kill "$zmx_session" 2>/dev/null || true
          fi

          msb stop "$session_name"
          echo "Sandbox $session_name stopped (disk preserved)."
        }

        cmd_rm() {
          local session_name="$1"
          shift || true

          # Kill zmx session if it exists
          local zmx_session="pi-''${profile:-default}-$session_name"
          if command -v zmx &>/dev/null; then
            zmx kill "$zmx_session" 2>/dev/null || true
          fi

          msb rm "$session_name"
          cleanup_session "$session_name"
          echo "Sandbox $session_name removed."
        }

        cmd_attach() {
          local session_name="$1"
          shift || true

          do_attach "$session_name"
        }

        cmd_exec() {
          local session_name="$1"
          shift

          exec msb exec "$session_name" -- ${entrypoint} "$@"
        }

        cmd_ls() {
          msb ls
        }

        # ── Main dispatch ──────────────────────────────────────────────────

        if [ $# -lt 1 ]; then
          usage 1
        fi

        command="$1"
        shift

        case "$command" in
          run)
            [ $# -lt 1 ] && { echo "Usage: ${name} run <name> [-d]" >&2; exit 1; }
            cmd_run "$@"
            ;;
          create)
            [ $# -lt 1 ] && { echo "Usage: ${name} create <name>" >&2; exit 1; }
            cmd_create "$@"
            ;;
          start)
            [ $# -lt 1 ] && { echo "Usage: ${name} start <name> [-a]" >&2; exit 1; }
            cmd_start "$@"
            ;;
          stop)
            [ $# -lt 1 ] && { echo "Usage: ${name} stop <name>" >&2; exit 1; }
            cmd_stop "$@"
            ;;
          rm|remove)
            [ $# -lt 1 ] && { echo "Usage: ${name} rm <name>" >&2; exit 1; }
            cmd_rm "$@"
            ;;
          attach)
            [ $# -lt 1 ] && { echo "Usage: ${name} attach <name>" >&2; exit 1; }
            cmd_attach "$@"
            ;;
          exec)
            [ $# -lt 2 ] && { echo "Usage: ${name} exec <name> <cmd> [args...]" >&2; exit 1; }
            cmd_exec "$@"
            ;;
          ls|list)
            cmd_ls
            ;;
          -h|--help|help)
            usage 0
            ;;
          *)
            echo "Unknown command: $command" >&2
            usage 1
            ;;
        esac
  '';

  meta = {
    description = "Stateful pi sessions in microsandbox VMs (${name})";
    platforms = lib.platforms.linux ++ [ "aarch64-darwin" ];
    mainProgram = name;
  };
}
