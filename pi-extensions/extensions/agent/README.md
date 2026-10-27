# Agent Tool

The `agent` tool manages Pi subagents with isolated contexts. By default it spawns a background agent and returns an ID; use the same tool to wait, inspect, cancel, foreground, or restart it. Use `action: "run"` for the original synchronous one-shot behavior.

## Features

- **Isolated context**: Each agent runs in a separate `pi` process
- **Full overrides**: Control system prompt, model, thinking level, and tool access
- **Background by default**: Spawn jobs without blocking and retrieve results by ID
- **Markdown rendering**: Synchronous `run` output is rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage
- **Cancellation**: Cancel background jobs by ID; Ctrl+C aborts a synchronous `run`
- **Subagent-aware**: Sets `PI_SUBAGENT=1` so extensions like status-tracker deactivate
- **Herdr-aware**: When `HERDR_ENV=1`, starts each agent in its own herdr tab instead of a hidden subprocess

## Usage

### Basic (inherits defaults)
```
Use the agent tool to implement input validation on the /api/users endpoint. It will spawn in the background and return an ID; wait on that ID to collect the result.
```

### With overrides
```
Use the agent tool with model "aperture/glm-5.2", thinking "low", and tools
["read", "grep", "find", "ls"] to explore the authentication code.
```

## Tool Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | `spawn` (default), `run`, `wait`, `cancel`, `check`, `list`, `foreground`, or `restart` |
| `prompt` | string | Task for spawn/run/restart |
| `id` | string | Job ID for check/wait/cancel/foreground/restart |
| `ids` | string[] | Job IDs for wait/cancel |
| `systemPrompt` | string | Full system prompt override |
| `appendSystemPrompt` | string | Text appended to the default system prompt |
| `model` | string | Model pattern or ID (e.g. `aperture/glm-5.2`, `aperture/gpt-5.6-luna`) |
| `thinking` | string | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `tools` | string[] | Allowlist of tool names to enable |
| `excludeTools` | string[] | Tools to exclude from the inherited set |
| `cwd` | string | Working directory for the agent process |

## Subagent Environment

The spawned process gets `PI_SUBAGENT=1` in its environment. Extensions can check this to adjust behavior:

```typescript
if (process.env.PI_SUBAGENT === "1") {
  return; // Skip registration — we're inside a subagent
}
```

This is used by `status-tracker` to avoid conflicts with the parent's `STATUS.md`.

## Herdr Integration

When running inside herdr (`HERDR_ENV=1`), agents run in separate tabs using documented Herdr commands. Background tabs start without focus and close when settled; pi session data is retained. Foreground jobs focus their tab. Outside Herdr, foreground completion is reported with a pi status notification.

Outside Herdr, background agents run in hidden child processes. Foregrounding reports current status/output in a pi notification; `action: "run"` waits synchronously.

## Background agents

Use the existing `agent` tool with `action: "spawn"` (or omit `action`) and a prompt. Then use that same tool with `action: "check"`, `"wait"`, `"cancel"`, `"list"`, `"foreground"`, or `"restart"` and the returned ID. `/agents [id]` lists jobs or foregrounds one. Jobs are isolated to the current pi session, limited to eight running and 64 retained (oldest settled jobs are pruned). Spawn/restart accept the same model, thinking, tools, system-prompt, and working-directory overrides as `action: "run"`. Registry records are persisted in the parent session, and child pi session data lives under the parent session directory so settled work can be restarted in the same context. Herdr background tabs close when each run settles; foregrounding a settled job opens its saved pi session, while non-Herdr foregrounding shows a status/output notice. Completion sends a parent follow-up unless consumed by wait or cancel. Set `action: "run"` to wait synchronously for one task.

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: User abort (Ctrl+C) kills subprocess, throws error
