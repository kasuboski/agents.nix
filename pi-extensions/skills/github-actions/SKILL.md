---
name: github-actions
description: Guidance for using github actions. Use when writing github actions and workflows.
---

IMPORTANT: Always look up current versions of actions before using them. You MUST NOT use action versions that don't exist.

Use the version lookup script to find the latest version and commit SHA for any action:

```bash
# Latest version + SHA for any action
scripts/action-versions <owner/repo>

# Specific tag
scripts/action-versions <owner/repo> --tag v4
scripts/action-versions <owner/repo>@v4

# All versions
scripts/action-versions <owner/repo> --all
```

Pin actions to the commit SHA with a version comment so Supply-chain attacks on the tag are mitigated:

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

For official `actions/` actions, you can also cross-check at https://simonw.github.io/actions-latest/versions.txt

Prefer native builds to cross compiling. Github provides x86 and arm runners. It is better to run a build natively on a runner without emulation. Check references/runners.md for available runners.

For `workflow_call` (reusable workflows) and `workflow_dispatch` syntax, see references/reusable-workflows.md. Pay attention to input types, `secrets: inherit`, and how outputs flow between caller and callee.

MUST validate all workflow files with [actionlint](https://github.com/rhysd/actionlint) before considering the task done. Run `actionlint` on every workflow file that was created or modified. Fix all reported errors and warnings.

Always add concurrency groups to workflows triggered by pushes or PRs so new commits cancel in-progress runs for the same branch:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true
```

`head_ref` is the PR source branch name (e.g. `feature-login`); it is empty on push events, so the group falls back to `github.ref`. The `github.workflow` prefix prevents different workflows from colliding on the same branch. Always set `cancel-in-progress: true` explicitly — the default is `false`. For deploy workflows, omit `cancel-in-progress` or set it to `false` to avoid canceling a deploy mid-flight.

`actions/checkout` persists auth credentials in `.git/config` by default, allowing any subsequent step to push to the repo. Always set `persist-credentials: false` unless a later step explicitly needs to push:

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  with:
    persist-credentials: false
```
