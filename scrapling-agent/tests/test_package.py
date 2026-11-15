import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PackageIntegrationTest(unittest.TestCase):
    def test_installed_package_survives_source_move(self):
        with tempfile.TemporaryDirectory(prefix="package test ") as temp:
            root = Path(temp).resolve()
            source = root / "source with spaces"
            shutil.copytree(ROOT, source, ignore=shutil.ignore_patterns("__pycache__"))
            home = root / "user home"
            bin_dir = root / "fake bin"
            bin_dir.mkdir()
            uv = bin_dir / "uv"
            uv.write_text("#!/usr/bin/env python3\nimport os, pathlib, sys\nif sys.argv[1] == 'venv':\n p = pathlib.Path(sys.argv[-1]) / 'bin'\n p.mkdir(parents=True, exist_ok=True)\n os.symlink(" + repr(sys.executable) + ", p / 'python')\n (p / 'scrapling-mcp').touch()\n")
            uv.chmod(0o755)
            claude = bin_dir / "claude"
            claude.write_text("#!/usr/bin/env python3\nimport json, os\nfrom pathlib import Path\nPath(os.environ['CAPTURE']).write_text(os.getcwd())\nprint(json.dumps({'structured_output': {'status': 'ok', 'summary': 'answer', 'sources': [{'url': 'https://example.com', 'evidence': 'evidence'}], 'warnings': []}}))\n")
            claude.chmod(0o755)
            env = os.environ.copy()
            env.update(PATH=str(bin_dir) + os.pathsep + env["PATH"], CAPTURE=str(root / "capture"))
            setup = subprocess.run([sys.executable, "-B", str(source / "scripts/install.py"), "--user-home", str(home), "--no-browser"], env=env, capture_output=True, text=True)
            self.assertEqual(setup.returncode, 0, setup.stderr)
            data = home / ".local/share/scrapling-agent"
            manifest = json.loads((data / "installation.json").read_text())
            package = data / "package"
            for asset in ("SKILL.md", "agents/scrapling-worker.md.tmpl", "schemas/result.schema.json", "scripts/install.py", "scripts/run.py", "references/architecture.md"):
                self.assertTrue((package / asset).is_file(), asset)
                self.assertIn(str(package / asset), manifest["files"])
            for asset in re.findall(r"\]\(([^)#]+)\)", (package / "SKILL.md").read_text()):
                if not re.match(r"[a-z]+://", asset):
                    self.assertTrue((package / asset).is_file(), asset)
            source.rename(root / "moved source")
            entry = home / ".local/bin/scrapling-agent"
            result = subprocess.run([str(entry), "--url", "https://example.com", "--task", "read"], cwd=root, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)["sources"][0]["evidence"], "evidence")
            self.assertEqual(Path((root / "capture").read_text()), data / "work")


if __name__ == "__main__":
    unittest.main()
