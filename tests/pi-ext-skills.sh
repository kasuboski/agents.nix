#!/usr/bin/env bash
set -euo pipefail

# Exercise the built pi-ext wrapper against isolated project and user skill roots.
# Requires nix and Python 3; no model credentials or API calls are needed.
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper=$(nix build "$root#pi-ext" --no-link --print-out-paths | tail -n1)/bin/pi-ext
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/project/.pi/skills/project-check" \
  "$fixture/project/.agents/skills/agents-project-check" \
  "$fixture/user/skills/user-check" "$fixture/home" "$fixture/xdg"

printf '%s\n' '---' 'name: project-check' 'description: project fixture skill' '---' > "$fixture/project/.pi/skills/project-check/SKILL.md"
printf '%s\n' '---' 'name: agents-project-check' 'description: agents project fixture skill' '---' > "$fixture/project/.agents/skills/agents-project-check/SKILL.md"
printf '%s\n' '---' 'name: user-check' 'description: user fixture skill' '---' > "$fixture/user/skills/user-check/SKILL.md"
# Bypass only decryption; exported Bash functions take precedence over PATH commands.
sops() { printf '{}'; }
export -f sops
export HOME="$fixture/home"
export XDG_CONFIG_HOME="$fixture/xdg"
export PI_CODING_AGENT_DIR="$fixture/user"
# pi stores project trust decisions in the agent directory, keyed by canonical cwd.
printf '{"%s":true}\n' "$fixture/project" > "$fixture/user/trust.json"
cd "$fixture/project"
git init -q
python3 - "$wrapper" <<'PY'
import json, subprocess, sys
wrapper = sys.argv[1]
request = '{"id":"commands","type":"get_commands"}\n'
def commands(extra=()):
    proc = subprocess.Popen([wrapper, "--mode", "rpc", "--no-session", *extra], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        out, err = proc.communicate(request, timeout=60)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, err = proc.communicate()
        raise SystemExit(f"pi timed out; terminated subprocess. stdout: {out}\\nstderr: {err}")
    if proc.returncode:
        raise SystemExit(f"pi exited {proc.returncode}: {err}\\n{out}")
    responses = [json.loads(line) for line in out.splitlines() if line.strip()]
    response = next((x for x in responses if x.get("id") == "commands"), None)
    if not response or not response.get("success"):
        raise SystemExit(f"RPC get_commands failed: {out}\\n{err}")
    return {x["name"] for x in response["data"]["commands"] if x.get("source") == "skill"}
skills = commands()
required = {"skill:project-check", "skill:agents-project-check", "skill:user-check", "skill:agent-browser"}
missing = required - skills
if missing:
    raise SystemExit(f"missing expected skills {sorted(missing)}; discovered: {sorted(skills)}")
for name in sorted(required):
    print(f"PASS {name}")
disabled = commands(("--no-skills",))
if {"skill:project-check", "skill:agents-project-check", "skill:user-check"} & disabled:
    raise SystemExit(f"--no-skills failed to suppress discovered fixture skills: {sorted(disabled)}")
if "skill:agent-browser" not in disabled:
    raise SystemExit(f"--no-skills suppressed explicitly bundled skill:agent-browser: {sorted(disabled)}")
print("PASS --no-skills negative control (bundled skill:agent-browser retained)")
PY
