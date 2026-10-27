# Background terminals

Starts and tracks non-interactive shell commands independently of Herdr. The `background_terminal_start` tool launches a process in the background; pass `wait: true` to return its final output instead. Aborting a waiting start kills the process tree. Use `background_terminal_status` and `background_terminal_list` to inspect terminals, `background_terminal_logs` to read complete stdout/stderr, and `background_terminal_kill` to stop one or more process trees. Every completed terminal queues one follow-up user message for the model with its id and inspection tools. `/ps` is read-only until `k` is pressed; ↑/↓ selects, Enter opens details, Tab switches stdout/stderr, PgUp/PgDn scroll, Esc goes back, and `q` closes.

Processes are session-scoped and terminated on session shutdown. At most 8 may run and 32 are tracked. Captured stdout/stderr share a 256 KiB in-memory cap; truncation is explicitly reported along with a `background_terminal_logs` pointer. Logs are written to manager-private files in a mode-restricted temporary directory, capped at 256 MiB per stream, and can be read with `background_terminal_logs`; output past that safety cap is discarded and reported. The directory paths are not exposed. `wait(id)` / `awaitCompletion(id)` resolve after process close and output drain, and `subscribe(listener)` reports start, output, status, and completion events. Shell commands are launched in `ctx.cwd` unless `cwd` is supplied. Interactive commands requiring a TTY are not supported.

Package entry is explicitly `./index.ts`. This extension does not use Herdr or create tabs.

Run tests with `node --experimental-strip-types --test *.test.ts` and typecheck with `tsc --noEmit` in this directory.
