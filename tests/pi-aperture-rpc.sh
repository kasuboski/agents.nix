#!/usr/bin/env bash
set -euo pipefail

# Exercise real Pi session replacement while Aperture discovery is pending.
# Only a local fake gateway is contacted; no secrets or model requests.
root=$(cd "$(dirname "$0")/.." && pwd)
wrapper=${PI_RPC_TEST_WRAPPER:-$(nix build "$root#pi-ext" --no-link --print-out-paths | tail -n1)/bin/pi-ext}
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/project" "$fixture/user" "$fixture/home" "$fixture/xdg"
export HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/xdg"
export PI_CODING_AGENT_DIR="$fixture/user" PI_RPC_TEST="$fixture/check.mjs"
cat > "$PI_RPC_TEST" <<'JS'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [binary, ...args] = process.argv.slice(2);
const aperture = args.find((arg, i) => args[i - 1] === '-e' && arg.includes('-pi-aperture-'));
assert(aperture, 'wrapper must bundle Aperture');
// Force both refresh error paths after shutdown, independently of how the
// installed model registry chooses to report a failed HTTP discovery.
process.env.APERTURE_URL = 'http://127.0.0.1:1';
const packageRoot = path.resolve(path.dirname(binary), '../lib/node_modules/@earendil-works/pi-coding-agent');
const { createJiti } = await import(pathToFileURL(`${packageRoot}/node_modules/jiti/lib/jiti.mjs`));
const jiti = createJiti(import.meta.url);
const { default: extension } = await jiti.import(`${aperture}/index.ts`);
const unhandled = [];
const onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
for (const rejects of [false, true]) {
  const handlers = new Map();
  await extension({ registerProvider() {}, on(event, handler) { handlers.set(event, handler); } });
  let finish;
  let stale = false;
  let staleAccesses = 0;
  const refresh = new Promise((resolve, reject) => {
    finish = () => rejects ? reject(new Error('discovery failed')) : resolve({ errors: new Map([['aperture', new Error('discovery failed')]]) });
  });
  const ctx = {
    modelRegistry: { getAll: () => [], refresh: () => refresh },
    get ui() {
      if (stale) { staleAccesses++; throw new Error('stale extension context'); }
      return { notify() {} };
    },
  };
  handlers.get('session_start')({}, ctx);
  handlers.get('session_shutdown')?.({}, ctx);
  stale = true;
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(staleAccesses, 0, 'refresh must not access a replaced session context');
  assert.deepEqual(unhandled, [], 'refresh must not cause an unhandled rejection');
}
process.off('unhandledRejection', onUnhandled);
console.log('PASS late Aperture refresh errors never access a stale session context');
let release;
const gate = new Promise(resolve => { release = resolve; });
let requested;
const firstRequest = new Promise(resolve => { requested = resolve; });
const server = createServer(async (_req, res) => {
  requested();
  await gate;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{'); // Delayed discovery failure must not notify a stale context.
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const env = { ...process.env, APERTURE_URL: `http://127.0.0.1:${server.address().port}` };
delete env['BASH_FUNC_exec%%'];
delete env['BASH_FUNC_sops%%'];
const child = spawn(binary, ['--mode', 'rpc', '--no-session', '--offline',
  '--no-extensions', '--no-skills', '--no-themes', '-e', aperture], {
  env,
});
let stderr = '';
let stdout = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  stdout = (stdout + line + '\n').slice(-3000);
  const record = JSON.parse(line);
  if (record.type === 'response') pending.get(record.id)?.resolve(record);
});
child.on('exit', (code, signal) => {
  for (const request of pending.values()) request.reject(new Error(`Pi exited ${code}/${signal}: ${stderr.slice(-3000)}\n${stdout}`));
});
let nextId = 0;
async function rpc(type, params = {}) {
  const id = String(nextId++);
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ id, type, ...params }) + '\n');
  try {
    const result = await response;
    assert.equal(result.success, true, JSON.stringify(result));
    return result;
  } finally { pending.delete(id); }
}
const timeout = setTimeout(() => {
  console.error('FAIL timed out waiting for Pi/Aperture RPC');
  process.exitCode = 1;
  child.kill();
  release();
  server.closeAllConnections();
  server.close();
}, 15000);
try {
  await rpc('get_state');
  await firstRequest;
  const sessionPath = `${process.env.PI_CODING_AGENT_DIR}/target.jsonl`;
  writeFileSync(sessionPath, JSON.stringify({ type: 'session', version: 3,
    id: randomUUID(), timestamp: new Date().toISOString(), cwd: process.cwd() }) + '\n');
  const switched = rpc('switch_session', { sessionPath });
  setTimeout(release, 100);
  await switched;
  // Let outstanding refresh callbacks settle before checking the transport.
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(child.exitCode, null, stderr.slice(-3000));
  await rpc('get_state');
  await rpc('new_session');
  await rpc('get_state');
  console.log('PASS Pi survives switch_session and new_session during Aperture discovery failure');
} finally {
  clearTimeout(timeout);
  release();
  child.kill();
  lines.close();
  server.closeAllConnections();
  server.close();
}
JS
sops() { printf '{}'; }
exec() {
  [[ "$1" == pi ]] || return 1
  shift
  node "$PI_RPC_TEST" "$(type -P pi)" "$@"
}
export -f sops exec
cd "$fixture/project"
"$wrapper"
