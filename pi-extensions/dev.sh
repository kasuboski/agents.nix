#!/usr/bin/env bash
# Launch the flake-pinned plain Pi with local extensions and skills.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "${PI_DEV_BIN:-}" ]]; then
  PI_DEV_BIN="$(nix build "$ROOT_DIR#pi" --no-link --print-out-paths)/bin/pi"
fi

ext_names=()
skill_names=()
extra_args=()
FLAGS_WITH_VALUE=(
  --provider --model --api-key --system-prompt --append-system-prompt
  --mode --session --fork --session-dir --models --tools --thinking
  --extension --skill --prompt-template --theme --export --list-models
)

while (($#)); do
  case "$1" in
    --ext)
      shift
      [[ $# -gt 0 && "$1" != --* ]] || { echo "--ext requires an extension name" >&2; exit 2; }
      ext_names+=("$1"); shift ;;
    --skill)
      shift
      [[ $# -gt 0 && "$1" != --* ]] || { echo "--skill requires a skill name" >&2; exit 2; }
      skill_names+=("$1"); shift ;;
    --)
      shift; extra_args+=("$@"); break ;;
    -* )
      extra_args+=("$1")
      for flag in "${FLAGS_WITH_VALUE[@]}"; do
        if [[ "$1" == "$flag" ]]; then
          shift
          [[ $# -gt 0 ]] || { echo "$flag requires a value" >&2; exit 2; }
          extra_args+=("$1")
          break
        fi
      done
      shift ;;
    *) ext_names+=("$1"); shift ;;
  esac
done

if ((${#ext_names[@]} == 0)); then
  for d in "$SCRIPT_DIR"/extensions/*/; do [[ -d "$d" ]] && ext_names+=("$(basename "$d")"); done
fi
if ((${#skill_names[@]} == 0)); then
  for d in "$SCRIPT_DIR"/skills/*/; do [[ -d "$d" ]] && skill_names+=("$(basename "$d")"); done
fi

args=(--no-extensions --no-skills)
for name in "${ext_names[@]}"; do
  target="$SCRIPT_DIR/extensions/$name"
  [[ -d "$target" ]] || { echo "Unknown extension: $name" >&2; exit 1; }
  args+=(--extension "$target")
done
for name in "${skill_names[@]}"; do
  target="$SCRIPT_DIR/skills/$name"
  [[ -d "$target" ]] || { echo "Unknown skill: $name" >&2; exit 1; }
  args+=(--skill "$target")
done
args+=("${extra_args[@]}")
exec "$PI_DEV_BIN" "${args[@]}"
