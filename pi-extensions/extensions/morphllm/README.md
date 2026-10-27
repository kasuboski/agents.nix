# MorphLLM Extension for Pi

Three Morph integrations for pi:

- **`codebase_search` tool** — agentic natural-language code search via [Morph WarpGrep](https://docs.morphllm.com/sdk/components/warp-grep/index).
- **`/fast-compact` command** — custom compaction via the [Morph Compact API](https://docs.morphllm.com/compact) instead of built-in LLM summarization.
- **`/fast-apply` command** — toggle [Morph Fast Apply](https://docs.morphllm.com/fast-apply) mode: replaces the built-in `edit` tool with Morph's semantic `edit_file` (outputs only changed lines using `// ... existing code ...` markers).

## Setup

Set the `MORPH_API_KEY` environment variable. Get a key at [morphllm.com/dashboard/api-keys](https://morphllm.com/dashboard/api-keys).

```bash
export MORPH_API_KEY="your-api-key-here"
```

All three features reuse this single key. Without it, the tools surface a clear error on call, `/fast-compact` refuses to run (shows an error, no compaction), and `/fast-apply` refuses to enable.

## `codebase_search` tool

Registers a `codebase_search` tool the model can call. It spins up a Morph WarpGrep **sub-agent** that runs ripgrep + file reads in its own context window and returns relevant code snippets — so exploration doesn't pollute the parent agent's context.

- **Input is plain English, not regex.** The model is steered away from grep patterns: write queries like *"Find where authentication requests are handled in the Express routes"*.
- Searches the agent's current working directory (`ctx.cwd`), using the ripgrep bundled with the SDK.
- The tool name is intentionally `codebase_search` — if the model saw "grep" it would pass regex.

```text
# What the model sends
codebase_search({ search_term: "How does the payment flow work?" })

# What comes back (formatted file:content pairs)
```

Failures (e.g. a bad key returning a 401) are returned as tool errors with a formatted reason; a successful search with zero matches returns normally with *"No relevant code found."*

## `/fast-compact [query]`

Triggers compaction using the Morph Compact API. The optional query focuses the compaction on relevant content.

```
/fast-compact                    # Compact with auto-detected focus
/fast-compact authentication     # Compact, keeping lines about authentication
```

The extension registers a `session_before_compact` event handler that **only activates when `/fast-compact` is used** — the built-in `/compact` command is unaffected. If `MORPH_API_KEY` is not set, `/fast-compact` shows an error and performs no compaction (use the built-in `/compact` for native summarization). If the key is set but the Morph API call fails at compact time, the hook logs the error and falls back to pi's built-in LLM summarization.

This triggers the same flow as `/compact` — the Morph hook intercepts and provides the summary.

### `/compact [query]` (built-in)

Not intercepted. Always uses pi's native LLM summarization.

## `/fast-apply [on|off|status]`

Toggles Morph Fast Apply edit mode (**off by default**). When enabled, the built-in `edit` tool is **deactivated** and Morph's `edit_file` tool is **activated** in its place; toggling also rebuilds the system prompt, so the tool and its usage guidelines appear/disappear immediately.

```
/fast-apply          # toggle on/off
/fast-apply on       # enable
/fast-apply off      # disable (restores built-in edit)
/fast-apply status   # show current state without toggling
```

When on, the model edits files with `edit_file` instead of `edit`:

```text
# What the model sends — only the changed lines
edit_file({
  target_filepath: "src/auth.ts",
  instructions: "I am adding a null check before creating the session",
  code_edit: "// ... existing code ...\nif (!user) throw new Error(\"Not found\");\n// ... existing code ..."
})

# What comes back — a change summary plus a unified diff
Applied edit to src/auth.ts via Morph Fast Apply (+1 -0 ~1 lines).

@@ ... @@
 ...
+if (!user) throw new Error("Not found");
 ...
```

Morph merges the snippet into the full file server-side and writes it back, so the model emits far fewer tokens than a full-file rewrite. The `edit_file` tool is registered lazily on first enable (it stays registered but inactive while the mode is off). On any failure the result is returned as a tool error; the file is only written on success.
