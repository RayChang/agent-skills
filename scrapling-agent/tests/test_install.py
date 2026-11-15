import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/install.py"
spec = importlib.util.spec_from_file_location("installer", SCRIPT)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="installer test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = (self.root / "user home").resolve()
        self.source = self.root / "bundle source"
        for name in installer.BUNDLE:
            p = self.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("command: " + installer.PLACEHOLDER if name.endswith(".tmpl") else name)
        self.calls = []

    def fake_run(self, args, check, **kwargs):
        self.calls.append(args)
        if args[:2] == ["uv", "venv"]:
            bin_dir = Path(args[-1]) / "bin"
            bin_dir.mkdir(parents=True, exist_ok=True)
            for name in ("python", "scrapling-mcp", "scrapling"):
                (bin_dir / name).touch()
        return subprocess.CompletedProcess(args, 0)

    def install(self, **kwargs):
        with patch.object(installer.subprocess, "run", side_effect=self.fake_run):
            installer.install(self.home, self.source, **kwargs)

    def test_install_and_idempotence(self):
        self.install()
        data = self.home / ".local/share/scrapling-agent"
        manifest = json.loads((data / "installation.json").read_text())
        self.assertTrue(manifest["ready"])
        self.assertTrue(manifest["browser_installed"])
        self.assertEqual(len(self.calls), 5)
        self.assertIn("scrapling[ai]==0.5.1", self.calls[1])
        self.assertEqual((data / "package/scripts/run.py").read_text(), "scripts/run.py")
        self.assertIn(json.dumps(str(data / ".venv/bin/scrapling-mcp")), Path(manifest["agent_path"]).read_text())
        entry = self.home / ".local/bin/scrapling-agent"
        self.assertTrue(os.access(entry, os.X_OK))
        self.assertIn("'", entry.read_text())
        for path, target in manifest["links"].items():
            self.assertEqual(os.readlink(path), target)
        before = (data / "installation.json").read_bytes()
        self.install()
        self.assertEqual(len(self.calls), 6)
        self.assertEqual(sum(call[:2] == ["uv", "venv"] for call in self.calls), 1)
        self.assertEqual(before, (data / "installation.json").read_bytes())

    def test_unowned_and_modified_are_preserved(self):
        agent = self.home / ".claude/agents/scrapling-worker.md"
        agent.parent.mkdir(parents=True)
        agent.write_text("mine")
        with self.assertRaisesRegex(RuntimeError, "Unowned"):
            self.install()
        self.assertEqual(agent.read_text(), "mine")
        agent.unlink()
        self.install(no_browser=True)
        agent.write_text("edited")
        with self.assertRaisesRegex(RuntimeError, "modified"):
            self.install(no_browser=True)
        self.assertEqual(agent.read_text(), "edited")

    def test_dry_run_has_no_mutation_or_process(self):
        self.install(dry_run=True)
        self.assertFalse(self.home.exists())
        self.assertEqual(self.calls, [])

    def test_failure_is_not_ready(self):
        with patch.object(installer.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "uv")):
            with self.assertRaisesRegex(RuntimeError, "creating Python runtime"):
                installer.install(self.home, self.source)
        manifest = json.loads((self.home / ".local/share/scrapling-agent/installation.json").read_text())
        self.assertFalse(manifest["ready"])
        self.install(no_browser=True)
        self.assertTrue(json.loads((self.home / ".local/share/scrapling-agent/installation.json").read_text())["ready"])

    def test_externally_managed_source_is_preserved(self):
        external = self.home / ".agents/skills/scrapling-agent"
        external.parent.mkdir(parents=True)
        self.source.rename(external)
        self.source = external
        self.install(no_browser=True)
        manifest = json.loads((self.home / ".local/share/scrapling-agent/installation.json").read_text())
        self.assertTrue(external.is_dir())
        self.assertFalse(external.is_symlink())
        self.assertNotIn(str(external), manifest["links"])

    def test_external_skill_can_rerun_from_owned_copy(self):
        external = self.home / ".agents/skills/scrapling-agent"
        external.parent.mkdir(parents=True)
        self.source.rename(external)
        self.source = external
        self.install(no_browser=True)
        self.source = self.home / ".local/share/scrapling-agent/package"
        self.install(no_browser=True)
        self.assertTrue(external.is_dir())
        self.assertFalse(external.is_symlink())

    def test_retry_after_publishing_manifest_write_failure(self):
        self.install(no_browser=True)
        data = self.home / ".local/share/scrapling-agent"
        target = data / "package/SKILL.md"
        (self.source / "SKILL.md").write_text("updated skill")
        original = installer.write_manifest
        failed = False

        def interrupted(path, manifest):
            nonlocal failed
            if target.read_text() == "updated skill" and not failed:
                failed = True
                raise OSError("simulated manifest interruption")
            return original(path, manifest)

        with patch.object(installer, "write_manifest", side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, "publishing assets"):
                self.install(no_browser=True)
        self.install(no_browser=True)
        self.assertTrue(json.loads((data / "installation.json").read_text())["ready"])
        self.assertEqual(target.read_text(), "updated skill")

    def test_missing_patchright_browser_repairs_existing_installation(self):
        self.install()
        first_check = True

        def missing_once(args, check, **kwargs):
            nonlocal first_check
            if "-c" in args and first_check:
                first_check = False
                raise subprocess.CalledProcessError(1, args)
            return self.fake_run(args, check, **kwargs)

        with patch.object(installer.subprocess, "run", side_effect=missing_once):
            installer.install(self.home, self.source)
        browser_installs = [call for call in self.calls if "patchright" in call and "install" in call]
        self.assertEqual(len(browser_installs), 2)
        manifest = json.loads((self.home / ".local/share/scrapling-agent/installation.json").read_text())
        self.assertTrue(manifest["ready"])


if __name__ == "__main__":
    unittest.main()
