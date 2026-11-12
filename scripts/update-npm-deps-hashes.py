#!/usr/bin/env python3
"""Refresh Nix npm hashes using the actual, integrity-patched dependency derivations."""

import argparse
import json
import re
import subprocess
from pathlib import Path

HASH = r"sha256-[A-Za-z0-9+/]{43}="


def run(*args, **kwargs):
    return subprocess.run(args, text=True, check=True, **kwargs)


def targets(root, base):
    names = sorted(p.name for p in (root / "pi-extensions/extensions").iterdir() if p.is_dir())
    if base is None:
        return ["resources", *names]
    changed = set(run("git", "diff", "--name-only", base, cwd=root,
                      capture_output=True).stdout.splitlines())
    if changed & {"flake.lock", "packages/build-pi-extensions.nix"}:
        return ["resources", *names]
    return (["resources"] if "pi-extensions/package-lock.json" in changed else []) + [
        name for name in names
        if f"pi-extensions/extensions/{name}/package-lock.json" in changed
    ]


def dependency_expression(root, name):
    selection = "built.packageResources" if name == "resources" else f"built.extensions.{name}"
    return f"""
      let
        root = {json.dumps(str(root))};
        flake = builtins.getFlake root;
        pkgs = flake.inputs.nixpkgs.legacyPackages.${{builtins.currentSystem}};
        built = import (flake.outPath + "/packages/build-pi-extensions.nix") {{
          inherit pkgs;
          src = flake.outPath + "/pi-extensions";
        }};
      in {selection}.npmDeps.overrideAttrs (_: {{ outputHash = pkgs.lib.fakeHash; }})
    """


def replacement(text, name, hash_value):
    # Restrict replacements to the two documented hash locations, not arbitrary strings.
    if name == "resources":
        pattern = r'(packageResources = pkgs\.buildNpmPackage \{.*?npmDepsHash = ")' + HASH + r'(";)'
    else:
        pattern = r'(npmDepsHashes = \{(?:(?!\n  \};).)*?\b' + re.escape(name) + r' = ")' + HASH + r'(";)'
    updated, count = re.subn(pattern, lambda m: m[1] + hash_value + m[2], text, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected exactly one hash entry for {name}, found {count}")
    return updated


def refresh(root, names):
    path = root / "packages/build-pi-extensions.nix"
    text = path.read_text()
    for name in names:
        print(f"Refreshing {name}", flush=True)
        result = subprocess.run(
            ["nix", "build", "--impure", "--no-link", "--no-write-lock-file",
             "--expr", dependency_expression(root, name)],
            cwd=root, text=True, capture_output=True,
        )
        # Each invocation builds exactly one fake-hash dependency cache. Do not
        # mistake network, evaluation, or missing-integrity failures for a hash.
        hashes = re.findall(r"^\s*got:\s+(" + HASH + r")\s*$", result.stderr, re.M)
        if result.returncode == 0 or len(hashes) != 1 or "hash mismatch" not in result.stderr:
            raise RuntimeError(f"Could not determine hash for {name}:\n{result.stdout}\n{result.stderr}")
        text = replacement(text, name, hashes[0])
    # All-or-nothing: leave the file untouched if any dependency fetch fails.
    if text != path.read_text():
        path.write_text(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--base", help="Only refresh lockfiles changed since this git ref, including working-tree repairs")
    args = parser.parse_args()
    root = args.root.resolve()
    refresh(root, targets(root, args.base))


if __name__ == "__main__":
    main()
