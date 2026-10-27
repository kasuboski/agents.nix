#!/usr/bin/env bash
set -euo pipefail

# Exercise the bundled theme flags with the packaged Pi's real resource loader.
# Requires nix and Node.js; never decrypts secrets or calls a model provider.
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper=$(nix build "$root#pi-ext" --no-link --print-out-paths | tail -n1)/bin/pi-ext
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/project" "$fixture/user" "$fixture/home" "$fixture/xdg"
export HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/xdg"
export PI_CODING_AGENT_DIR="$fixture/user"
export PI_THEME_TEST="$fixture/check.mjs"
cat > "$PI_THEME_TEST" <<'JS'
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [binary, ...args] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(binary), '../lib/node_modules/@earendil-works/pi-coding-agent');
const { DefaultResourceLoader } = await import(pathToFileURL(path.join(packageRoot, 'dist/core/resource-loader.js')));
const themePaths = args.flatMap((arg, i) => arg === '--theme' ? [args[i + 1]] : []);
assert(args.includes('--no-themes'), 'wrapper must disable automatic theme discovery');
assert(themePaths.length > 0, 'wrapper must pass bundled themes');
const loader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR,
  noExtensions: true, noSkills: true, noPromptTemplates: true,
  noContextFiles: true, noThemes: true, additionalThemePaths: themePaths,
});
await loader.reload();
const { themes, diagnostics } = loader.getThemes();
assert.deepEqual(diagnostics, [], `theme diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
const expected = ['catppuccin-frappe', 'catppuccin-latte', 'catppuccin-macchiato', 'catppuccin-mocha'];
assert.deepEqual(themes.map(theme => theme.name).sort(), expected);
for (const name of expected) console.log(`PASS ${name}`);
console.log('PASS no theme conflicts or invalid theme files');
JS
# Intercept only decryption and the final launch. Use Pi from the wrapper's PATH
# so validation follows flake updates rather than a separately installed SDK.
sops() { printf '{}'; }
exec() {
  if [[ "$1" != pi ]]; then
    echo "Unexpected wrapper command: $1" >&2
    return 1
  fi
  shift
  node "$PI_THEME_TEST" "$(type -P pi)" "$@"
}
export -f sops exec
cd "$fixture/project"
"$wrapper"
