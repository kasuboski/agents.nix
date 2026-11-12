#!/usr/bin/env python3
"""Reject changes other than Nix SHA-256 hashes and missing npm integrity additions."""

import argparse
import base64
import json
import re
import subprocess
from pathlib import Path

NIX_FILE = "packages/build-pi-extensions.nix"
LOCKFILE = re.compile(r"pi-extensions/(?:extensions/[^/]+/)?package-lock\.json")


def validate_change(name, before, after):
    if name == NIX_FILE:
        def scrub(text):
            return re.sub(r"sha256-[A-Za-z0-9+/]{43}=", "<hash>", text)
        if scrub(before) != scrub(after):
            raise ValueError("Only Nix SHA-256 hash changes are permitted")
        return
    if not LOCKFILE.fullmatch(name):
        raise ValueError(f"Unexpected changed path: {name}")
    original, updated = json.loads(before), json.loads(after)
    if original.get("lockfileVersion") not in (2, 3):
        raise ValueError(f"Unsupported lockfile: {name}")
    old_packages, new_packages = original["packages"], updated["packages"]
    if old_packages.keys() != new_packages.keys():
        raise ValueError(f"Package entries changed: {name}")
    for key, package in new_packages.items():
        if "integrity" not in old_packages[key] and "integrity" in package:
            value = package.pop("integrity")
            if (not isinstance(value, str) or not re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", value)
                    or len(base64.b64decode(value[7:], validate=True)) != 64):
                raise ValueError(f"Invalid new SHA-512 integrity: {name}: {key}")
            # Only resolved registry tarballs can acquire integrity fields.
            url = package.get("resolved", "")
            if not url.startswith("https://registry.npmjs.org/") or package.get("link"):
                raise ValueError(f"Not a registry dependency: {name}: {key}")
    if original != updated:
        raise ValueError(f"Lockfile changed beyond missing integrity additions: {name}")


def validate_tree(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True)
    # Inspect both trees: a forbidden staged change must not be hidden by
    # restoring only its working-tree copy before validation.
    for index in (False, True):
        options = ["--cached"] if index else []
        if git("diff", *options, "--summary", "HEAD"):
            raise ValueError("File additions, removals, renames, or mode changes are not permitted")
        names = git("diff", *options, "--name-only", "-z", "HEAD").split("\0")
        for name in filter(None, names):
            before = git("show", f"HEAD:{name}")
            after = git("show", f":{name}") if index else (root / name).read_text()
            validate_change(name, before, after)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    validate_tree(args.root.resolve())


if __name__ == "__main__":
    main()
