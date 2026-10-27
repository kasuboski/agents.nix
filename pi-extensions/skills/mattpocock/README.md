# Matt Pocock's Skills (pi port)

Copied from [mattpocock/skills](https://github.com/mattpocock/skills) — Matt Pocock's agent skills for real engineering, described as "small, easy to adapt, and composable."

This copy is synced to upstream commit [`6fd947921b935b7e1e69293a200400f0fdd5c15f`](https://github.com/mattpocock/skills/commit/6fd947921b935b7e1e69293a200400f0fdd5c15f) (2026-10-06). It syncs the **engineering**, **productivity**, **in-progress**, and **personal** buckets. The in-progress bucket is intentionally available in pi even though upstream excludes it from its released plugin; upstream has no `personal/` bucket at this revision.

## What's here

| Bucket | Purpose |
|---|---|
| `engineering/` | Code work — planning, wayfinding, research, domain modeling, TDD, triage, specs, tickets, implementation, review, debugging, retrospectives, and prototyping |
| `productivity/` | General workflows — grilling, handoff, teaching, questionnaires, clarification, and writing for agents |
| `in-progress/` | Upstream drafts and experiments, including chief-of-staff, writing workflows, handoff, looping, and deep-module setup |
| `personal/` | Reserved for the upstream personal bucket; no files are present at this revision |

See each populated bucket's `README.md` for the skill list, and [`docs/invocation.md`](./docs/invocation.md) for the user-invoked vs. model-invoked axis.

## Pi-specific changes from upstream

1. **Invocation syntax.** Skill cross-references use pi commands such as `/skill:grilling` and `/skill:domain-modeling` instead of upstream's `/grilling` and `/domain-modeling` syntax. Instructions to call an upstream `Skill` tool are expressed as pi skill invocations.
2. **Frontmatter compatibility.** `disable-model-invocation: true` is supported by pi and keeps a skill out of the model prompt while preserving `/skill:<name>` access. `argument-hint:` is currently ignored as unknown frontmatter, which pi permits.
3. **Vendoring boundary.** Upstream `agents/` directories and non-vendored buckets are excluded; bucket summaries and README details reflect the content available in this pi package.

Upstream's background-agent, scheduling, and Claude-specific handoff instructions are otherwise retained for now; their pi fit can be addressed separately.

## What is not ported

- `agents/` directories — Codex-specific invocation metadata; pi reads skill frontmatter directly.
- `misc/` — mostly Claude Code-specific hooks and utilities outside this port's scope.
- `.claude-plugin/plugin.json` — Claude Code plugin registration; this package declares `./skills` through `package.json` and pi discovers `SKILL.md` files recursively.
- Upstream repository-management files such as the top-level `README.md`, `CHANGELOG.md`, `.changeset/`, `scripts/`, and `.github/`.

## Syncing upstream

1. Check out the desired upstream revision in a temporary directory and record its full commit hash above.
2. Sync `skills/{engineering,productivity,in-progress,personal}` into this directory, including upstream additions, renames, and deletions, while excluding every `agents/` directory.
3. Reapply the pi invocation adaptations above. Leave background-agent, scheduling, and Claude handoff workflows as upstream unless a separate pi adaptation is requested.
4. Compare file lists and diff local content against the pinned upstream checkout.
5. Validate frontmatter, duplicate names, relative links, executable scripts, and pi launch via `./dev.sh --help`.
