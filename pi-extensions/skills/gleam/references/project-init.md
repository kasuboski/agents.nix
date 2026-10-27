# Initialize a Gleam project

Use this recipe for a new single-package project. For an existing repository,
merge missing tasks and tooling into its conventions instead of replacing files.

## Bootstrap

1. Choose the package name, destination, and target. The baseline is Erlang.
   Read [`mise.toml`](mise.toml) and
   [`shell.nix`](shell.nix), then copy them into the destination.
   Resolve template paths relative to this skill, not the working directory.
2. Enter `nix-shell shell.nix`, review and trust the configuration with
   `mise trust`, then run `mise install`. Nix supplies native OTP build dependencies;
   Mise supplies Gleam, Erlang, and Rebar. Run initialization and all subsequent
   Mise commands inside this shell so OTP's build environment is available.
3. Replace the template's `latest` values with the exact installed versions from
   `mise ls --current`, then run `mise install` again. Keep the Nix snapshot and
   hash together; update them deliberately when upgrading the environment.
4. From the destination run `mise exec -- gleam new . --name PACKAGE_NAME`.
   Verify this syntax with `mise exec -- gleam help new` first; if the installed
   compiler requires an empty destination, generate in a temporary sibling and
   move its generated files into the destination without replacing the tooling.
5. Run `mise exec -- gleam add --dev glinter`. Keep the generated test framework,
   dependency constraints, and `manifest.toml`. Add this table to `gleam.toml`
   (merge it if already present):

   ```toml
   [tools.glinter]
   warnings_as_errors = true
   ```

   The lint task explicitly checks both `src/` and `test/`. Glinter normally
   fails only on errors; this setting makes warnings fail the gate too. Fix
   findings, using narrow, reasoned rule exceptions only when intentional.

## Adapt only when needed

- **JavaScript:** set `target = "javascript"` in `gleam.toml`, add `nodejs` to
  the Nix packages and `node = "system"` to Mise tools. Verify check, build,
  lint, and test with the selected target; add Erlang only if required by tooling.
- **Monorepo:** put tasks at the repository root with explicit package working
  directories. Install Glinter per package or use its `--project` option from a
  package where it is installed. Keep validation of a shared package sequential.
- **Services or native dependencies:** extend the shell and test tasks only for
  actual requirements. Mono-verde's PostgreSQL, Chromium, D2, secret scanning,
  and file-size gates are application-specific, not baseline Gleam tooling.
- **Git hooks:** `precommit` (alias `pre-commit`) is a task, not an installed hook.
  Wire it into the repository's hook runner only when requested.

## Completion

Run `mise run format`, then `mise run precommit` inside the Nix shell. Both must
succeed; the gate checks formatting without rewriting files, type-checks, runs
Glinter, builds with compiler warnings as errors, and tests sequentially.
`mise run ci` invokes the same gate. Report selected tool versions, target, and
any checks you could not run. Never treat a nonzero lint exit as success.

See [`project-init-research.md`](project-init-research.md) for sources and the
reasoning behind this baseline.
