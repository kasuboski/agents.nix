#!/usr/bin/env python3
"""Fill missing npm lockfile integrity fields, verifying exact registry tarballs.

Requires only Python 3. Never installs packages or changes versions/existing hashes.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

REGISTRY = "https://registry.npmjs.org"
ALGORITHMS = {"sha512": 64, "sha384": 48, "sha256": 32, "sha1": 20}


def registry_url(url):
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "registry.npmjs.org"
            or parsed.query or parsed.fragment):
        raise ValueError(f"Refusing non-registry URL: {url}")
    return url


class RegistryRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        registry_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(RegistryRedirects())


def fetch(url, limit):
    with OPENER.open(registry_url(url), timeout=30) as response:
        registry_url(response.url)
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"Registry response exceeds size limit: {url}")
    return data


def parse_integrity(value):
    # npm SRI may contain several digests; verify the strongest supported one.
    choices = []
    for token in value.split():
        algorithm, separator, encoded = token.partition("-")
        if separator and algorithm in ALGORITHMS:
            digest = base64.b64decode(encoded, validate=True)
            if len(digest) != ALGORITHMS[algorithm]:
                raise ValueError("Invalid integrity digest length")
            choices.append((ALGORITHMS[algorithm], algorithm, digest))
    if not choices:
        raise ValueError("No supported integrity digest")
    _, algorithm, digest = max(choices)
    return algorithm, digest


def all_lockfiles(root):
    return sorted(p for p in [root / "pi-extensions/package-lock.json",
                             *(root / "pi-extensions/extensions").glob("*/package-lock.json")]
                  if p.is_file())


def selected_lockfiles(root, paths, base):
    if paths:
        return [p.resolve() for p in paths]
    files = all_lockfiles(root)
    if base is None:
        return files
    changed = set(subprocess.check_output(
        ["git", "diff", "--name-only", base], cwd=root, text=True).splitlines())
    if changed & {"flake.lock", "packages/build-pi-extensions.nix"}:
        return files
    return [p for p in files if p.relative_to(root).as_posix() in changed]


def read_lock(path):
    data = json.loads(path.read_text())
    if data.get("lockfileVersion") not in (2, 3) or not isinstance(data.get("packages"), dict):
        raise ValueError(f"Expected npm lockfile v2/v3 with packages: {path}")
    return data


def integrity_index(documents):
    index = {}
    for data in documents:
        for package in data["packages"].values():
            url, integrity = package.get("resolved"), package.get("integrity")
            if url and integrity:
                algorithm, digest = parse_integrity(integrity)
                prior = index.setdefault(url, {})
                if algorithm in prior and prior[algorithm] != digest:
                    raise ValueError(f"Conflicting committed integrity values for {url}")
                prior[algorithm] = digest
    return index


def verified_integrity(url, package_path, package, known):
    registry_url(url)
    if known:
        algorithm = max(known, key=lambda name: ALGORITHMS[name])
        expected = known[algorithm]
    else:
        name = package.get("name") or package_path.rsplit("node_modules/", 1)[-1]
        version = package.get("version")
        if not re.fullmatch(r"(?:@[a-z0-9._~-]+/)?[a-z0-9._~-]+", name) or not isinstance(version, str):
            raise ValueError(f"Cannot identify exact package: {package_path}")
        endpoint = f"{REGISTRY}/{urllib.parse.quote(name, safe='@')}/{urllib.parse.quote(version, safe='')}"
        metadata = json.loads(fetch(endpoint, 10 * 1024 * 1024))
        if metadata.get("name") != name or metadata.get("version") != version:
            raise ValueError(f"Registry identity mismatch for {name}@{version}")
        dist = metadata["dist"]
        if dist["tarball"] != url:
            raise ValueError(f"Registry tarball does not match locked URL: {url}")
        algorithm, expected = parse_integrity(dist["integrity"])
    tarball = fetch(url, 128 * 1024 * 1024)
    if not hmac.compare_digest(hashlib.new(algorithm, tarball).digest(), expected):
        raise ValueError(f"Tarball integrity mismatch: {url}")
    return "sha512-" + base64.b64encode(hashlib.sha512(tarball).digest()).decode()


def repair(root, paths):
    # Include unchanged repository lockfiles as checksum sources, not repair targets.
    files = sorted(set(all_lockfiles(root)) | set(paths))
    documents = {p: read_lock(p) for p in files}
    index = integrity_index(documents.values())
    verified = {}
    changed = []
    for path in paths:
        data = documents[path]
        count = 0
        for package_path, package in data["packages"].items():
            url = package.get("resolved", "")
            if "integrity" in package or not url or package.get("link"):
                continue
            # Git and local dependencies are outside this registry repair tool.
            if url.startswith(("git+", "git:", "github:", "file:", "link:")):
                continue
            if url not in verified:
                verified[url] = verified_integrity(url, package_path, package, index.get(url))
            package["integrity"] = verified[url]
            count += 1
        if count:
            changed.append((path, json.dumps(data, indent=2, ensure_ascii=False) + "\n"))
            print(f"{path}: filled {count} missing integrities", flush=True)
    # Fetch/validate everything, then stage complete files before replacing any
    # originals. Atomic per-file replacement avoids truncation on write errors.
    staged = []
    try:
        for path, content in changed:
            fd, name = tempfile.mkstemp(prefix=".npm-integrity-", dir=path.parent)
            temporary = Path(name)
            staged.append((path, temporary))
            with os.fdopen(fd, "w") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(path.stat().st_mode & 0o777)
        for path, temporary in staged:
            temporary.replace(path)
    finally:
        for _, temporary in staged:
            temporary.unlink(missing_ok=True)
    return len(changed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, help="Explicit lockfiles; defaults to repository lockfiles")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--base", help="Only repair lockfiles changed since this git ref, including working-tree edits")
    args = parser.parse_args()
    if args.paths and args.base:
        parser.error("Use explicit paths or --base, not both")
    root = args.root.resolve()
    repair(root, selected_lockfiles(root, args.paths, args.base))


if __name__ == "__main__":
    main()
