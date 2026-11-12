"""Offline tests for integrity repair and the privileged-job patch boundary."""

import base64
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


repairer = load("repairer", "repair-npm-integrities.py")
guard = load("guard", "validate-npm-dependency-patch.py")
URL = "https://registry.npmjs.org/@example/pkg/-/pkg-1.2.3.tgz"
CONTENT = b"a pinned package tarball"
SRI = "sha512-" + base64.b64encode(hashlib.sha512(CONTENT).digest()).decode()
METADATA = {"name": "@example/pkg", "version": "1.2.3", "dist": {"tarball": URL, "integrity": SRI}}
LOCK_NAME = "pi-extensions/extensions/fixture/package-lock.json"


def lock(integrity=None):
    package = {"version": "1.2.3", "resolved": URL}
    if integrity is not None:
        package["integrity"] = integrity
    return {"lockfileVersion": 3, "packages": {"": {"name": "fixture"}, "node_modules/@example/pkg": package}}


class RepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.write(LOCK_NAME, lock())

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2) + "\n")
        return path

    @patch.object(repairer, "fetch")
    def test_registry_fallback_verifies_tarball_and_is_idempotent(self, fetch):
        before = self.path.read_text()
        fetch.side_effect = [json.dumps(METADATA).encode(), CONTENT]
        self.assertEqual(repairer.repair(self.root, [self.path]), 1)
        guard.validate_change(LOCK_NAME, before, self.path.read_text())
        self.assertEqual(json.loads(self.path.read_text()), lock(SRI))
        fetch.reset_mock()
        self.assertEqual(repairer.repair(self.root, [self.path]), 0)
        fetch.assert_not_called()

    @patch.object(repairer, "fetch", return_value=CONTENT)
    def test_reuses_other_lockfile_integrity_but_still_verifies_bytes(self, fetch):
        self.write("pi-extensions/package-lock.json", lock(SRI))
        repairer.repair(self.root, [self.path])
        fetch.assert_called_once_with(URL, 128 * 1024 * 1024)
        self.assertEqual(json.loads(self.path.read_text()), lock(SRI))

    @patch.object(repairer, "fetch", return_value=CONTENT)
    def test_reuses_same_lockfile_sibling_and_deduplicates_downloads(self, fetch):
        data = lock()
        data["packages"]["node_modules/parent/node_modules/@example/pkg"] = copy.deepcopy(data["packages"]["node_modules/@example/pkg"])
        data["packages"]["node_modules/known/node_modules/@example/pkg"] = dict(data["packages"]["node_modules/@example/pkg"], integrity=SRI)
        self.path.write_text(json.dumps(data))
        repairer.repair(self.root, [self.path])
        self.assertEqual(fetch.call_count, 1)

    @patch.object(repairer, "fetch")
    def test_bad_tarball_aborts_without_changing_files(self, fetch):
        before = self.path.read_bytes()
        fetch.side_effect = [json.dumps(METADATA).encode(), b"tampered tarball"]
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            repairer.repair(self.root, [self.path])
        self.assertEqual(self.path.read_bytes(), before)

    @patch.object(repairer, "fetch")
    def test_failure_in_second_file_does_not_partially_write(self, fetch):
        second = self.write("pi-extensions/extensions/second/package-lock.json", lock())
        second_data = lock()
        second_data["packages"]["node_modules/@example/pkg"]["resolved"] = URL.replace("1.2.3", "2.0.0")
        second.write_text(json.dumps(second_data))
        before = {p: p.read_bytes() for p in [self.path, second]}
        fetch.side_effect = [json.dumps(METADATA).encode(), CONTENT, OSError("network failure")]
        with self.assertRaisesRegex(OSError, "network failure"):
            repairer.repair(self.root, [self.path, second])
        self.assertEqual({p: p.read_bytes() for p in before}, before)

    @patch.object(repairer.tempfile, "mkstemp")
    @patch.object(repairer, "fetch", return_value=CONTENT)
    def test_staging_failure_preserves_original_files(self, fetch, mkstemp):
        self.write("pi-extensions/package-lock.json", lock(SRI))
        before = self.path.read_bytes()
        mkstemp.side_effect = OSError("disk full")
        with self.assertRaisesRegex(OSError, "disk full"):
            repairer.repair(self.root, [self.path])
        self.assertEqual(self.path.read_bytes(), before)

    @patch.object(repairer, "fetch")
    def test_metadata_must_match_exact_name_version_and_url(self, fetch):
        for field in ["name", "version", "tarball"]:
            data = copy.deepcopy(METADATA)
            if field == "tarball":
                data["dist"][field] = "https://evil.example/pkg.tgz"
            else:
                data[field] = "wrong"
            fetch.return_value = json.dumps(data).encode()
            with self.subTest(field=field), self.assertRaises(ValueError):
                repairer.repair(self.root, [self.path])

    def test_untrusted_urls_and_redirects_are_rejected(self):
        for url in ["http://registry.npmjs.org/pkg", "https://evil.example/pkg", "file:///etc/passwd",
                    "https://registry.npmjs.org@evil.example/pkg", "https://registry.npmjs.org/pkg?token=x"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                repairer.registry_url(url)
        with self.assertRaises(ValueError):
            repairer.RegistryRedirects().redirect_request(None, None, 302, "", {}, "https://evil.example/pkg")

    def test_conflicting_existing_integrities_are_rejected(self):
        other = "sha512-" + base64.b64encode(b"x" * 64).decode()
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            repairer.integrity_index([lock(SRI), lock(other)])

    @patch.object(repairer, "fetch")
    def test_git_dependencies_are_not_treated_as_registry_packages(self, fetch):
        data = lock()
        data["packages"]["node_modules/@example/pkg"]["resolved"] = "git+https://github.com/example/pkg.git#abc"
        self.path.write_text(json.dumps(data))
        self.assertEqual(repairer.repair(self.root, [self.path]), 0)
        fetch.assert_not_called()

    @patch.object(repairer.subprocess, "check_output", return_value=LOCK_NAME + "\nREADME.md\n")
    def test_base_selection_only_repairs_changed_lockfiles(self, git):
        self.write("pi-extensions/package-lock.json", lock(SRI))
        self.assertEqual(repairer.selected_lockfiles(self.root, [], "base"), [self.path])


class PatchGuardTests(unittest.TestCase):
    def validate(self, before, after, name=LOCK_NAME):
        guard.validate_change(name, json.dumps(before), json.dumps(after))

    def test_allows_only_missing_integrity_additions(self):
        self.validate(lock(), lock(SRI))

    def test_rejects_dependency_and_existing_integrity_changes(self):
        for field, value in [("version", "9.0.0"), ("resolved", "https://evil.example/pkg"),
                             ("integrity", "sha512-" + base64.b64encode(b"x" * 64).decode())]:
            before = lock(SRI)
            after = copy.deepcopy(before)
            after["packages"]["node_modules/@example/pkg"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate(before, after)

    def test_rejects_removals_new_packages_and_other_fields(self):
        for mutation in [lambda data: data["packages"].pop("node_modules/@example/pkg"),
                         lambda data: data["packages"].update({"node_modules/extra": {"version": "1"}}),
                         lambda data: data.update({"name": "changed"}),
                         lambda data: data["packages"]["node_modules/@example/pkg"].update({"scripts": {"install": "bad"}})]:
            before = lock()
            after = copy.deepcopy(before)
            mutation(after)
            with self.assertRaises(ValueError):
                self.validate(before, after)

    def test_rejects_integrity_on_non_registry_urls_and_invalid_digests(self):
        before, after = lock(), lock(SRI)
        for data in [before, after]:
            data["packages"]["node_modules/@example/pkg"]["resolved"] = "https://evil.example/pkg"
        with self.assertRaises(ValueError):
            self.validate(before, after)
        with self.assertRaises(ValueError):
            self.validate(lock(), lock("sha512-invalid"))

    def test_nix_guard_allows_hashes_but_not_code_or_fallback_edits(self):
        before = (ROOT / guard.NIX_FILE).read_text()
        after = re.sub(r"sha256-[A-Za-z0-9+/]{43}=", "sha256-" + "A" * 43 + "=", before, count=1)
        guard.validate_change(guard.NIX_FILE, before, after)
        with self.assertRaises(ValueError):
            guard.validate_change(guard.NIX_FILE, before, before + "\n# unexpected code")
        with self.assertRaises(ValueError):
            guard.validate_change("scripts/unexpected.py", "before", "after")

    def test_tree_guard_accepts_staged_repair_but_rejects_mode_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / LOCK_NAME
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(lock()))
            def git(*args):
                subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)
            git("init", "-q")
            git("add", ".")
            git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
                "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")
            target.write_text(json.dumps(lock(SRI)))
            git("add", ".")
            guard.validate_tree(root)
            # A staged malicious change cannot be hidden by an unstaged revert.
            malicious = lock()
            malicious["packages"]["node_modules/@example/pkg"]["version"] = "9.0.0"
            target.write_text(json.dumps(malicious))
            git("add", ".")
            target.write_text(json.dumps(lock()))
            with self.assertRaises(ValueError):
                guard.validate_tree(root)
            target.write_text(json.dumps(lock(SRI)))
            git("add", ".")
            target.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "mode"):
                guard.validate_tree(root)


if __name__ == "__main__":
    unittest.main()
