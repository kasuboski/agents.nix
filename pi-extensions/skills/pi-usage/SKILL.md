---
name: pi-usage
description: >
  Analyze pi session token usage and produce a breakdown report. Sums the
  usage blocks recorded in pi session logs. Use when the user wants a token
  report, usage breakdown, "how much have I used", cached-vs-fresh token
  split, per-model or per-project cost/tokens, or asks to analyze pi usage.
---

# pi-usage

pi writes every session as JSONL. Each **assistant** message carries a
**usage** block — the single source of truth for token accounting. This skill
parses those blocks and sums them into a report.

## Where the logs live

`~/.pi/agent/sessions/<dir-encoded-cwd>/*.jsonl`

Each directory is a project, named with its cwd path encoded (`/` → `-`).
Files are named `<UTC-timestamp>_<session-uuid>.jsonl`. One directory per
project; one file per session.

## The usage schema

Every assistant message contains:

```
"provider":"<provider>","model":"<model>","usage":{"input":N,"output":N,"cacheRead":N,"cacheWrite":N,...}
```

`input` is fresh prompt tokens, `cacheRead` is cached prompt tokens served from
the cache, `cacheWrite` is tokens written to the cache (often 0 — many
providers never report it), `output` is generated tokens. Sum these per
provider/model.

## Steps

1. **Parse and aggregate.** Run this from `~/.pi/agent/sessions` — it extracts
   every usage block across all sessions and sums per `provider/model`:

   ```bash
   cd ~/.pi/agent/sessions && \
   rg --no-filename -o \
     '"provider":"([^"]*)","model":"([^"]*)","usage":\{"input":([0-9]+),"output":([0-9]+),"cacheRead":([0-9]+),"cacheWrite":([0-9]+)' \
     --glob '*.jsonl' -r '$1/$2|$3|$4|$5|$6' \
   | awk -F'|' '{k=$1; in_[k]+=$2; out_[k]+=$3; cr_[k]+=$4; cw_[k]+=$5; n_[k]++}
       END { for (k in in_) printf "%s|%d|%d|%d|%d|%d\n", k, n_[k], in_[k], cr_[k], cw_[k], out_[k] }' \
   | sort
   ```

   Fields out: `provider/model | calls | input | cacheRead | cacheWrite | output`.

   **Completion criterion:** every model that logged usage appears once, with
   non-negative totals; a TOTAL row sums all columns.

2. **Present the table.** Print the breakdown with a TOTAL row. Columns: calls,
   input, cache-read, cache-write, output. Add a TOTAL computed across all
   models.

   **Completion criterion:** the table has all five token columns plus a TOTAL
   row whose column sums match the per-model rows.

3. **Add a short findings note.** Flag the dominant model, whether caching is
   in use (compare cacheRead vs input), and any all-zero models (errors or no
   usage returned — common for `*-free` and errored providers).

   **Completion criterion:** findings state which provider/model dominates,
   whether cacheRead exceeds input, and list any all-zero models.

## Regrouping (per-project, per-date)

The parse is fixed; only the grouping key changes. Re-run step 1 but swap the
key:

- **Per-project** — group by directory instead of provider/model. Count usage
  calls per session directory: `for d in ~/.pi/agent/sessions/*/; do rg -c
  '"usage":\{"input"' "$d"; done | sort -rn`.
- **Per-date** — session filenames start with the UTC timestamp; group the
  parse output by filename date prefix.

## Caveats

- `cacheWrite` is frequently 0 across all models — many providers never return
  it. A zero column is expected, not a bug.
- Some providers log calls with all-zero usage (errored or no usage returned).
  Report them as a row but don't let their zeros skew findings.
- Only providers with prompt caching enabled show meaningful `cacheRead`;
  local (ollama) and most `*-free` models show zero caching.
