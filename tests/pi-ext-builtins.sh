#!/usr/bin/env bash
set -euo pipefail

# Exercise explicit built-ins with the packaged Pi's real resource loader.
# Requires nix and Node.js; never decrypts secrets or calls a model provider.
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper=$(nix build "$root#pi-ext" --no-link --print-out-paths | tail -n1)/bin/pi-ext
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/project/.pi/extensions" "$fixture/user/extensions" "$fixture/home" "$fixture/xdg"
export HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/xdg"
export PI_CODING_AGENT_DIR="$fixture/user"
export PI_BUILTINS_TEST="$fixture/check.mjs"
# Neither automatic extension directory should load, even in a trusted project.
printf 'throw new Error("project extension discovered");\n' > "$fixture/project/.pi/extensions/unwanted.js"
printf 'throw new Error("user extension discovered");\n' > "$fixture/user/extensions/unwanted.js"
cat > "$PI_BUILTINS_TEST" <<'JS'
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [binary, ...args] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(binary), '../lib/node_modules/@earendil-works/pi-coding-agent');
const load = file => import(pathToFileURL(path.join(packageRoot, file)));
const { DefaultResourceLoader } = await load('dist/core/resource-loader.js');
const { SettingsManager } = await load('dist/core/settings-manager.js');
const { builtInExtensions } = await load('dist/extensions/index.js');
const expected = ['builtin:mcp', 'builtin:codemode', 'builtin:tool-search'];
const extensionPaths = args.flatMap((arg, i) => arg === '-e' ? [args[i + 1]] : []);
assert(args.includes('--no-extensions'), 'wrapper must disable automatic extension discovery');
assert.deepEqual(extensionPaths.filter(p => p.startsWith('builtin:')).sort(), [...expected].sort());
const settingsManager = SettingsManager.create(process.cwd(), process.env.PI_CODING_AGENT_DIR);
settingsManager.setProjectTrusted(true);
const loader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true,
  noContextFiles: true, noThemes: true,
  additionalExtensionPaths: extensionPaths.filter(p => p.startsWith('builtin:')),
  extensionFactories: builtInExtensions,
});
await loader.reload();
const { extensions, errors } = loader.getExtensions();
assert.deepEqual(errors, [], `extension errors: ${JSON.stringify(errors)}`);
assert.deepEqual(extensions.map(e => e.path).sort(), [...expected].sort());
assert(extensions.find(e => e.path === 'builtin:mcp').commands.has('mcp'));
assert(extensions.find(e => e.path === 'builtin:codemode').tools.has('codemode'));
assert(extensions.find(e => e.path === 'builtin:tool-search').tools.has('tool_search'));
for (const name of expected) console.log(`PASS ${name}`);
console.log('PASS automatic extension discovery and llama.cpp remain disabled');
JS
# Intercept only decryption and launch; resolve Pi through the wrapper's PATH.
sops() { printf '{}'; }
exec() {
  if [[ "$1" != pi ]]; then
    echo "Unexpected wrapper command: $1" >&2
    return 1
  fi
  shift
  node "$PI_BUILTINS_TEST" "$(type -P pi)" "$@"
}
export -f sops exec
cd "$fixture/project"
"$wrapper"
