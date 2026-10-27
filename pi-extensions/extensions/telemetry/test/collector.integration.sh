#!/usr/bin/env bash
# Opt-in real Collector test; not part of the automated node:test suite. No credentials required.
set -euo pipefail
cd "$(dirname "$0")/.."
image='otel/opentelemetry-collector-contrib:0.123.0@sha256:e39311df1f3d941923c00da79ac7ba6269124a870ee87e3c3ad24d60f8aee4d2'
work=$(mktemp -d -t pi-otel-collector.XXXXXXXX)
cid=''
cleanup() {
  if [[ -n "$cid" ]]; then
    docker logs "$cid" >"$work/collector.log" 2>&1 || true
    docker rm -f "$cid" >/dev/null || true
  fi
  if [[ ${KEEP_COLLECTOR_EVIDENCE:-0} == 1 ]]; then
    printf 'Synthetic collector evidence retained at %s\n' "$work"
  else
    rm -rf "$work"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker info >/dev/null
docker pull "$image"
docker run --rm "$image" --version
cid=$(docker run -d --user "$(id -u):$(id -g)" \
  -p 127.0.0.1::4318 \
  -v "$PWD/test/collector.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  -v "$work:/evidence" "$image" --config=/etc/otelcol-contrib/config.yaml)
port=$(docker port "$cid" 4318/tcp | awk -F: '{print $NF}')
printf 'Collector OTLP HTTP: http://127.0.0.1:%s/v1/traces\n' "$port"
# Node script polls the real receiver before running the SDK (no readiness spans).
mise exec node@24.20.0 -- node --experimental-strip-types --experimental-transform-types test/collector.integration.ts "http://127.0.0.1:$port/v1/traces" "$work/traces.jsonl" "$work/report.json"
docker logs "$cid" >"$work/collector.log" 2>&1
if rg -i '"level":"error"|Exporting failed|failed to export' "$work/collector.log"; then
  echo 'Collector reported an error' >&2
  exit 1
fi
[[ $(rg -c 'Name +: pi.tool$' "$work/collector.log") == 2 ]]
[[ $(rg -c 'Name +: pi.interaction$' "$work/collector.log") == 1 ]]
if rg 'SYNTHETIC_|synthetic-model-only-key|gpt-4o-mini|gen_ai\.|host\.name|exception' "$work/collector.log"; then
  echo 'Unexpected private/content fields in Collector debug output' >&2
  exit 1
fi
printf 'Collector file and debug exporters verified; container removed on exit.\n'
