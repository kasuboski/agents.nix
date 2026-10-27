# Pi Agent Runner Templates

When this skill is used interactively in this repository, prefer the `agent` tool for delegation. The extension launches an isolated child pi, forwards explicit resource flags, and returns structured output to the parent. The shell commands below are for validating the actuator outside a parent pi session and for CI, where there is no `agent` tool instance to call.

Use pi's print mode for local and CI actuator runs. The command loads the repository's project skills and context when the project is trusted; use `--approve` explicitly in non-interactive environments.

**Run the actuator locally before wiring CI.** Export whatever credentials your configured pi provider requires, assemble `PROMPT`, and run pi against a controller-selected target:

```bash
export PROMPT="$(cat /tmp/agent-prompt.md)"
pi -p "$PROMPT" --approve --no-session \
  2> >(tee /tmp/agent-diagnostics.txt >&2) \
  | tee /tmp/agent-output.txt
```

Use the repo's normal launcher when it pins or configures pi. In this repository that is `./dev.sh`; for a standalone installation, install the pi CLI with the package manager appropriate to the environment:

```bash
npm install -g @earendil-works/pi-coding-agent
pi --version
```

## Configure the provider

Pi credentials are configured through pi's normal login/settings flow or the provider's environment variables. Keep provider-specific secrets in the CI secret store; do not put them in prompts, workflow files, or the memory file.

For a deterministic headless run, select the provider and model explicitly:

```bash
export PI_API_KEY=...        # store this in CI secrets, not in the repository
pi -p "$PROMPT" \
  --approve \
  --no-session \
  --provider "$PI_PROVIDER" \
  --model "$PI_MODEL" \
  --api-key "$PI_API_KEY" \
  2> >(tee /tmp/agent-diagnostics.txt >&2) \
  | tee /tmp/agent-output.txt
```

If the environment already has a default provider and model, omit those flags. `--api-key` is optional when pi has credentials in its auth file or the provider's environment variable. In a clean CI runner, passing a secret through `--api-key` is explicit and provider-neutral; never print the key or place it in a prompt.

## Response capture

Pi print mode writes the final response to stdout. Capture the output for diagnostics and use it as the PR body:

```bash
pi -p "$PROMPT" --approve --no-session \
  2> >(tee /tmp/agent-diagnostics.txt >&2) \
  | tee /tmp/agent-output.txt
cp /tmp/agent-output.txt /tmp/pr-body.md
```

If the launcher emits startup or diagnostic text, have the actuator write its final response to a known file or add a small repository-local extraction script. Keep the response template in the prompt and skill so the captured body remains reviewable.

For machine-readable events, combine print mode with JSON output: `pi -p --mode json "$PROMPT"`, then extract the final assistant message according to pi's JSON event schema. Prefer plain print mode unless the workflow needs structured event handling.

## CI notes

- Install or invoke the pi version pinned by the repository rather than silently upgrading it.
- Set `PI_CODING_AGENT_DIR` when CI needs an isolated settings directory.
- Set `GIT_TERMINAL_PROMPT=0` so missing git credentials fail instead of hanging.
- Use `--no-session` so scheduled runs do not create persistent local sessions.
- Use `--approve` in CI when project-local skills and context files must load; it trusts those files for the run. Print mode still permits the enabled tools to act, so the checkout and runner must be trusted and deliberately scoped.
- Tee output to `/tmp/agent-output.txt` and upload it as an artifact on failure.
- The extracted response should be in `/tmp/pr-body.md` before the PR creation step.
