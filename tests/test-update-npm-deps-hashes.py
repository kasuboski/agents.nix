"""Unit tests for hash selection, safe replacement, and fetch failure handling."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("updater", ROOT / "scripts/update-npm-deps-hashes.py")
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)
NEW_HASH = "sha256-" + "A" * 43 + "="


class HashUpdaterTests(unittest.TestCase):
    def test_all_existing_hash_entries_can_be_updated_individually(self):
        original = (ROOT / "packages/build-pi-extensions.nix").read_text()
        for name in updater.targets(ROOT, None):
            with self.subTest(name=name):
                updated = updater.replacement(original, name, NEW_HASH)
                self.assertEqual(updated.count(NEW_HASH), 1)
                self.assertEqual(len(updated), len(original))

    def test_unknown_target_is_rejected(self):
        original = (ROOT / "packages/build-pi-extensions.nix").read_text()
        with self.assertRaises(RuntimeError):
            updater.replacement(original, "nonexistent", NEW_HASH)

    @patch.object(updater, "run")
    def test_base_selects_only_changed_lockfiles(self, run):
        run.return_value.stdout = "\n".join([
            "pi-extensions/package-lock.json",
            "pi-extensions/extensions/agent/package-lock.json",
            "pi-extensions/extensions/telemetry/package.json",
            "README.md",
        ])
        self.assertEqual(updater.targets(ROOT, "base-sha"), ["resources", "agent"])
        self.assertEqual(run.call_args.args[:5], ("git", "diff", "--name-only", "base-sha", "HEAD"))

    @patch.object(updater, "run")
    def test_nix_changes_refresh_all_caches(self, run):
        run.return_value.stdout = "flake.lock\n"
        self.assertEqual(updater.targets(ROOT, "base-sha"), updater.targets(ROOT, None))

    def test_sources_are_store_paths_not_sandbox_inaccessible_local_strings(self):
        expression = updater.dependency_expression(ROOT, "agent")
        self.assertIn('src = flake.outPath + "/pi-extensions"', expression)
        self.assertIn('built.extensions.agent.npmDeps.overrideAttrs', expression)
        self.assertIn('outputHash = pkgs.lib.fakeHash', expression)

    @patch.object(updater.subprocess, "run")
    def test_fetch_failure_does_not_partially_write_hashes(self, run):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "packages/build-pi-extensions.nix"
            target.parent.mkdir()
            original = (ROOT / "packages/build-pi-extensions.nix").read_text()
            target.write_text(original)
            run.side_effect = [
                subprocess.CompletedProcess([], 1, "", f"error: hash mismatch\n got: {NEW_HASH}\n"),
                subprocess.CompletedProcess([], 1, "", "error: network unavailable"),
            ]
            with self.assertRaisesRegex(RuntimeError, "network unavailable"):
                updater.refresh(root, ["agent", "tinyfish"])
            self.assertEqual(target.read_text(), original)

    @patch.object(updater.subprocess, "run")
    def test_hash_mismatch_updates_the_file(self, run):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "packages/build-pi-extensions.nix"
            target.parent.mkdir()
            target.write_text((ROOT / "packages/build-pi-extensions.nix").read_text())
            run.return_value = subprocess.CompletedProcess(
                [], 1, "", f"error: hash mismatch in fixed-output derivation\n got: {NEW_HASH}\n"
            )
            updater.refresh(root, ["agent"])
            self.assertIn(NEW_HASH, target.read_text())


if __name__ == "__main__":
    unittest.main()
