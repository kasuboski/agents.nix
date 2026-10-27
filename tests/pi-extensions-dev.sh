#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV="$ROOT/pi-extensions/dev.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat >"$tmp/pi" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$PI_ARGS_FILE"
STUB
chmod +x "$tmp/pi"
export PI_DEV_BIN="$tmp/pi" PI_ARGS_FILE="$tmp/args"
run() { "$DEV" "$@"; }
assert_has() { grep -Fxq -- "$1" "$PI_ARGS_FILE" || { echo "missing arg: $1" >&2; exit 1; }; }
assert_not_has() { ! grep -Fxq -- "$1" "$PI_ARGS_FILE" || { echo "unexpected arg: $1" >&2; exit 1; }; }
count_flag() { grep -Fxc -- "$1" "$PI_ARGS_FILE" || true; }

run
[[ "$(count_flag --extension)" -eq 7 && "$(count_flag --skill)" -eq 13 ]]
run --ext telemetry
[[ "$(count_flag --extension)" -eq 1 && "$(count_flag --skill)" -eq 13 ]]
assert_has "$ROOT/pi-extensions/extensions/telemetry"
run --skill herdr
[[ "$(count_flag --extension)" -eq 7 && "$(count_flag --skill)" -eq 1 ]]
assert_has "$ROOT/pi-extensions/skills/herdr"
run --ext telemetry --skill herdr
[[ "$(count_flag --extension)" -eq 1 && "$(count_flag --skill)" -eq 1 ]]
run telemetry
[[ "$(count_flag --extension)" -eq 1 && "$(count_flag --skill)" -eq 13 ]]
run --model sonnet --provider openai -- --help
assert_has --model; assert_has sonnet; assert_has --provider; assert_has openai; assert_has --help
if run --ext >/dev/null 2>&1; then exit 1; fi
if run --skill >/dev/null 2>&1; then exit 1; fi
if run --model >/dev/null 2>&1; then exit 1; fi
if run --ext nonexistent >/dev/null 2>&1; then exit 1; fi
if run --skill nonexistent >/dev/null 2>&1; then exit 1; fi
echo 'pi-extensions dev launcher regression tests passed'
