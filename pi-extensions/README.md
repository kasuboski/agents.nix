# pi-extensions

First-party Pi extensions and skills maintained in this repository. Snapshot imported from `kasuboski/pi-extensions` revision `92e0c102e4a6bb60d822ab481aad9bb5fc031a9d`; subsequent changes belong in this tree.

## Development

Use the repository's pinned tools and flake-pinned Pi package. The root npm project provides Pi's runtime dependencies and Catppuccin themes; each extension with a `package-lock.json` has its own dependencies and must be installed separately. Run installs from this directory so the pinned Node version is used:

```bash
mise install
mise exec node@24.20.0 -- npm ci --ignore-scripts
for dir in extensions/*; do
  if [[ -f "$dir/package-lock.json" ]]; then
    (cd "$dir" && mise exec node@24.20.0 -- npm ci --ignore-scripts)
  fi
done
./dev.sh                    # loads all local extensions and skills
./dev.sh --ext telemetry    # selected extension + all skills
./dev.sh --skill herdr       # all extensions + selected skill
./dev.sh --ext telemetry --skill herdr
./dev.sh telemetry          # bare name selects an extension
./dev.sh -- --help          # pass Pi arguments through
```

Run tests and typechecks from this directory with `mise exec node@24.20.0 -- mise run precommit` (or invoke individual `mise run test-*` and `mise run typecheck-*` tasks). The extension and skill defaults are independent: omitting `--ext` loads all extensions, and omitting `--skill` loads all skills. Nix builds bundle extensions and skills from this directory.

## Structure

Seven extensions and thirteen skills are built and bundled through `packages/build-pi-extensions.nix`. Edit sources here; dependency lockfile changes require updating the corresponding Nix npm dependency hash and validating with a real `nix build .#pi-ext --no-link --keep-going`.
