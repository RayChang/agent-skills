import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


class ChildSetupTest(unittest.TestCase):
    def test_signals_during_popen_clean_spawned_child(self):
        spec = importlib.util.spec_from_file_location("scrapling_run", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        real_popen = subprocess.Popen
        original_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        for sig, expected in ((signal.SIGTERM, runner.Terminated), (signal.SIGINT, KeyboardInterrupt)):
            with self.subTest(signal=sig):
                children = []
                def delayed_popen(*args, **kwargs):
                    child = real_popen(*args, **kwargs)
                    children.append(child)
                    # Deliver a real signal while the caller still lacks the child reference.
                    os.kill(os.getpid(), sig)
                    time.sleep(0.01)
                    return child
                try:
                    with mock.patch.object(runner.subprocess, "Popen", side_effect=delayed_popen):
                        with self.assertRaises(expected):
                            runner.execute([sys.executable, "-c", "import time; time.sleep(30)"], ROOT, 1)
                    self.assertIsNotNone(children[0].poll(), "child survived interruption during Popen")
                    self.assertTrue(children[0].stdout.closed)
                    self.assertTrue(children[0].stderr.closed)
                    for handled_signal, handler in original_handlers.items():
                        self.assertEqual(signal.getsignal(handled_signal), handler)
                finally:
                    for child in children:
                        runner.stop(child)
                        child.stdout.close()
                        child.stderr.close()

    def test_popen_success_and_failure_restore_handlers(self):
        spec = importlib.util.spec_from_file_location("scrapling_run", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        original_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        code, output, diagnostic = runner.execute(
            [sys.executable, "-c", "import signal; print(len(signal.pthread_sigmask(signal.SIG_BLOCK, [])))"], ROOT, 2)
        self.assertEqual((code, output, diagnostic), (0, b"0\n", b""))
        for sig, handler in original_handlers.items():
            self.assertEqual(signal.getsignal(sig), handler)
        for sig in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=sig):
                def failed_popen(*args, **kwargs):
                    os.kill(os.getpid(), sig)
                    raise OSError("spawn failed")
                with mock.patch.object(runner.subprocess, "Popen", side_effect=failed_popen):
                    with self.assertRaisesRegex(OSError, "spawn failed"):
                        runner.execute(["missing-claude"], ROOT, 1)
                for handled_signal, handler in original_handlers.items():
                    self.assertEqual(signal.getsignal(handled_signal), handler)

    def test_setup_failures_clean_spawned_child(self):
        spec = importlib.util.spec_from_file_location("scrapling_run", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        for stage in ("constructor", "first_register", "second_register"):
            for exception_type in (runner.Terminated, KeyboardInterrupt, OSError):
                with self.subTest(stage=stage, exception=exception_type.__name__):
                    process = mock.Mock()
                    selector = mock.Mock()
                    error = exception_type("setup interrupted")
                    if stage == "first_register":
                        selector.register.side_effect = error
                    elif stage == "second_register":
                        selector.register.side_effect = [None, error]
                    with mock.patch.object(runner.subprocess, "Popen", return_value=process), \
                            mock.patch.object(runner.selectors, "DefaultSelector", return_value=selector) as factory, \
                            mock.patch.object(runner, "stop") as stop:
                        if stage == "constructor":
                            factory.side_effect = error
                        with self.assertRaises(exception_type) as raised:
                            runner.execute_child(["fake-claude"], ROOT, 1)
                        self.assertIs(raised.exception, error)
                        stop.assert_called_once_with(process)
                        process.stdout.close.assert_called_once_with()
                        process.stderr.close.assert_called_once_with()
                        if stage != "constructor":
                            selector.close.assert_called_once_with()


class LauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name) / "data with spaces"
        self.package = self.data / "package"
        (self.package / "scripts").mkdir(parents=True)
        (self.package / "schemas").mkdir()
        (self.data / "work").mkdir()
        shutil.copy(ROOT / "scripts/run.py", self.package / "scripts/run.py")
        shutil.copy(ROOT / "schemas/result.schema.json", self.package / "schemas/result.schema.json")
        self.worker = self.data / "worker.md"
        self.worker.write_text('---\ntools: Read, StructuredOutput, mcp__scrapling__make_request\n---\n')
        self.runtime = self.data / "python"
        self.runtime.touch()
        self.mcp = self.data / "mcp"
        self.mcp.touch()
        (self.data / "installation.json").write_text(json.dumps({"schema_version": 1, "ready": True, "package_root": str(self.package), "work_dir": str(self.data / "work"), "agent_path": str(self.worker), "runtime_python": str(self.runtime), "mcp_command": str(self.mcp)}))
        self.fake = self.data / "fake claude"
        self.fake.write_text('#!/usr/bin/env python3\nimport json, os, sys, time\nfrom pathlib import Path\nPath(os.environ["CAPTURE"]).write_text(json.dumps([os.getcwd(), sys.argv[1:]]))\nmode = os.environ.get("MODE", "ok")\nif mode == "timeout":\n os.fork()\n time.sleep(30)\nelif mode == "overflow":\n os.fork()\n sys.stdout.write("x" * 1100000); sys.stdout.flush(); time.sleep(30)\nelif mode == "exit":\n sys.exit(7)\nelse:\n print(os.environ["ENVELOPE"])\n')
        self.fake.chmod(0o755)
        self.capture = self.data / "capture"
        self.result = {"status": "ok", "summary": "answer", "sources": [{"url": "https://example.com", "evidence": "evidence"}], "warnings": []}

    def run_launcher(self, envelope=None, mode="ok", extra=None):
        env = os.environ.copy()
        env.update(CAPTURE=str(self.capture), MODE=mode, ENVELOPE=json.dumps(envelope if envelope is not None else {"structured_output": self.result}))
        return subprocess.run(["python3", "-B", str(self.package / "scripts/run.py"), "--url", "https://example.com/?q=$(touch%20bad)", "--task", '$(touch bad); "quoted"', "--claude", str(self.fake)] + (extra or []), env=env, capture_output=True, text=True, timeout=8)

    def test_arguments_and_isolation(self):
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stdout)
        cwd, args = json.loads(self.capture.read_text())
        self.assertEqual(Path(cwd).resolve(), (self.data / "work").resolve())
        self.assertEqual(args[args.index("--tools") + 1], "Read,StructuredOutput")
        self.assertEqual(args[args.index("--allowedTools") + 1], "Read,StructuredOutput,mcp__scrapling__make_request")
        self.assertEqual(json.loads(args[-1])["task"], '$(touch bad); "quoted"')
        self.assertFalse((self.data / "work/bad").exists())

    def test_envelopes_and_statuses(self):
        self.assertEqual(self.run_launcher({"result": json.dumps(self.result)}).returncode, 0)
        for status, code in [("partial", 3), ("error", 1)]:
            self.result["status"] = status
            self.assertEqual(self.run_launcher().returncode, code)
        self.assertEqual(self.run_launcher({"is_error": True, "structured_output": self.result}).returncode, 1)
        self.assertEqual(self.run_launcher({"subtype": "error_during_execution", "structured_output": self.result}).returncode, 1)
        self.assertEqual(self.run_launcher(mode="exit").returncode, 1)

    def test_invalid_results(self):
        cases = [None, [], {**self.result, "extra": 1}, {**self.result, "summary": "x" * 6001}, {**self.result, "sources": []}, {**self.result, "sources": [{"url": "file:///x", "evidence": "x"}]}, {**self.result, "sources": [{"url": "https://example.com", "evidence": "x\n" * 11}]}, {**self.result, "warnings": [1]}]
        for value in cases:
            with self.subTest(value=str(value)[:30]):
                self.assertEqual(self.run_launcher({"structured_output": value}).returncode, 1)
        self.assertEqual(self.run_launcher({"result": "not json"}).returncode, 1)

    def test_invalid_input_and_missing_install(self):
        for extra in [["--url", "file:///etc/passwd"], ["--task", ""], ["--timeout", "0"], ["--url", "https://example.com/" + "x" * 4096], sum((["--url", "https://example.com"] for _ in range(10)), [])]:
            self.assertEqual(self.run_launcher(extra=extra).returncode, 2)
        (self.data / "installation.json").unlink()
        result = self.run_launcher()
        self.assertEqual(result.returncode, 1)
        self.assertIn("installer", json.loads(result.stdout)["error"])

    def test_rejects_unapproved_worker_tools(self):
        self.worker.write_text('---\ntools: Read, Bash\n---\n')
        self.assertEqual(self.run_launcher().returncode, 1)
        self.assertFalse(self.capture.exists())

    def test_timeout_and_overflow(self):
        self.assertEqual(self.run_launcher(mode="timeout", extra=["--timeout", "1"]).returncode, 124)
        self.assertEqual(self.run_launcher(mode="overflow").returncode, 1)

    def test_nonzero_exit_preserves_bounded_diagnostic(self):
        self.fake.write_text('#!/usr/bin/env python3\nimport sys\nsys.stderr.write("Authentication failed: session expired\\n")\nsys.exit(7)\n')
        result = self.run_launcher()
        self.assertEqual(result.returncode, 1)
        self.assertIn("session expired", json.loads(result.stdout)["error"])

    def test_sigterm_cleans_child_group(self):
        pid_path = self.data / "child.pid"
        self.fake.write_text('#!/usr/bin/env python3\nimport json, os, subprocess, sys, time\nfrom pathlib import Path\np=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"])\nPath(' + repr(str(pid_path)) + ').write_text(json.dumps([p.pid, os.getpgrp()]))\ntime.sleep(30)\n')
        command = ["python3", "-B", str(self.package / "scripts/run.py"), "--url", "https://example.com", "--task", "read", "--claude", str(self.fake)]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def cleanup():
            if pid_path.exists():
                _, group = json.loads(pid_path.read_text())
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        self.addCleanup(cleanup)
        deadline = time.monotonic() + 4
        while not pid_path.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(pid_path.exists(), "fake Claude did not start")
        child, _ = json.loads(pid_path.read_text())
        process.send_signal(signal.SIGTERM)
        out, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 143, out)
        self.assertEqual(json.loads(out)["status"], "error")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            state = subprocess.run(["ps", "-o", "stat=", "-p", str(child)], capture_output=True, text=True).stdout.strip()
            if not state or state.startswith("Z"):
                break
            time.sleep(0.01)
        self.assertTrue(not state or state.startswith("Z"), "descendant survived SIGTERM")


if __name__ == "__main__":
    unittest.main()
