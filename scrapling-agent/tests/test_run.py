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
        original_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT)}
        for sig, expected in ((signal.SIGTERM, runner.Terminated), (signal.SIGINT, runner.Terminated), (signal.SIGHUP, runner.Terminated), (signal.SIGQUIT, runner.Terminated)):
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

    def test_execute_preserves_ignored_signals(self):
        spec = importlib.util.spec_from_file_location("ignored_signal_runner", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        previous = signal.signal(signal.SIGHUP, signal.SIG_IGN)
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            os.kill(os.getpid(), signal.SIGHUP)
            return process
        try:
            with mock.patch.object(runner.subprocess, "Popen", side_effect=spawn):
                code, output, _ = runner.execute([sys.executable, "-c", "import os,signal; os.kill(os.getppid(),signal.SIGHUP); print('done')"], ROOT, 2)
            self.assertEqual((code, output), (0, b"done\n"))
            self.assertEqual(signal.getsignal(signal.SIGHUP), signal.SIG_IGN)
        finally:
            signal.signal(signal.SIGHUP, previous)

    def test_output_written_at_parent_completion_is_drained(self):
        spec = importlib.util.spec_from_file_location("drain_runner", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        selector = runner.selectors.DefaultSelector()
        real_select = selector.select
        real_popen = subprocess.Popen
        children = []
        def spawn(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            children.append(process)
            return process
        def race(timeout):
            if not hasattr(race, "finished"):
                race.finished = True
                children[0].wait(timeout=2)
                return []
            return real_select(timeout)
        try:
            with mock.patch.object(runner.subprocess, "Popen", side_effect=spawn), \
                    mock.patch.object(runner.selectors, "DefaultSelector", return_value=selector), \
                    mock.patch.object(selector, "select", side_effect=race):
                code, output, _ = runner.execute([sys.executable, "-c", "print('done')"], ROOT, 2)
            self.assertEqual((code, output), (0, b"done\n"))
        finally:
            selector.close()
            for process in children:
                runner.stop(process)
                process.stdout.close()
                process.stderr.close()

    def test_popen_success_and_failure_restore_handlers(self):
        spec = importlib.util.spec_from_file_location("scrapling_run", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        original_handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT)}
        code, output, diagnostic = runner.execute(
            [sys.executable, "-c", "import signal; print(len(signal.pthread_sigmask(signal.SIG_BLOCK, [])))"], ROOT, 2)
        self.assertEqual((code, output, diagnostic), (0, b"0\n", b""))
        for sig, handler in original_handlers.items():
            self.assertEqual(signal.getsignal(sig), handler)
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
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
        self.runtime = self.data / "python"
        self.runtime.touch()
        self.mcp = self.data / "mcp"
        self.mcp.touch()
        self.worker_metadata = {"name": "scrapling-worker", "description": "Installed extraction worker", "model": "sonnet", "maxTurns": 18, "tools": ["StructuredOutput", "mcp__scrapling__make_request"], "mcpServers": [{"scrapling": {"type": "stdio", "command": str(self.mcp)}}]}
        self.worker.write_text('---\n' + json.dumps(self.worker_metadata) + '\n---\nUse only supplied URLs and return the required report.\n')
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
        self.assertEqual(args[args.index("--tools") + 1], "StructuredOutput")
        self.assertEqual(args[args.index("--allowedTools") + 1], "StructuredOutput,mcp__scrapling__make_request")
        self.assertEqual(json.loads(args[-1])["task"], '$(touch bad); "quoted"')
        self.assertFalse((self.data / "work/bad").exists())

    def test_explicit_worker_definition_ignores_discovery_directory(self):
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.data / "other config")}):
            result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stdout)
        _, args = json.loads(self.capture.read_text())
        self.assertIn("--agents", args)
        definition = json.loads(args[args.index("--agents") + 1])["scrapling-worker"]
        self.assertEqual(definition["model"], "sonnet")
        self.assertEqual(definition["maxTurns"], 18)
        self.assertEqual(definition["prompt"], "Use only supplied URLs and return the required report.")
        self.assertEqual(definition["tools"], ["StructuredOutput", "mcp__scrapling__make_request"])
        self.assertEqual(definition["mcpServers"], [{"scrapling": {"type": "stdio", "command": str(self.mcp)}}])

    def test_rejects_unsupported_worker_configuration(self):
        variants = []
        for change in ("args", "permissionMode", "description", "model", "maxTurns"):
            value = json.loads(json.dumps(self.worker_metadata))
            if change == "args":
                value["mcpServers"][0]["scrapling"]["args"] = ["--custom"]
            elif change == "permissionMode":
                value["permissionMode"] = "bypassPermissions"
            elif change in ("description", "model"):
                value[change] = ["custom", "list"]
            else:
                value[change] = True
            variants.append(json.dumps(value))
        variants.append(json.dumps(self.worker_metadata)[:-1] + ', "model": "sonnet"}')
        for content in variants:
            with self.subTest(configuration=content):
                self.capture.unlink(missing_ok=True)
                self.worker.write_text('---\n' + content + '\n---\nReturn a report.\n')
                result = self.run_launcher()
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn("unsupported worker configuration", json.loads(result.stdout)["error"])
                self.assertFalse(self.capture.exists())

    def test_worker_command_path_can_contain_frontmatter_delimiter_text(self):
        command = self.data / "mcp---entry"
        command.touch()
        manifest_path = self.data / "installation.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["mcp_command"] = str(command)
        manifest_path.write_text(json.dumps(manifest))
        self.worker_metadata["mcpServers"][0]["scrapling"]["command"] = str(command)
        self.worker.write_text('---\n' + json.dumps(self.worker_metadata) + '\n---\nReturn a report.\n')
        result = self.run_launcher()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_envelopes_and_statuses(self):
        self.assertEqual(self.run_launcher({"result": json.dumps(self.result)}).returncode, 0)
        for status, code in [("partial", 3), ("error", 1)]:
            self.result["status"] = status
            self.assertEqual(self.run_launcher().returncode, code)
        self.assertEqual(self.run_launcher({"is_error": True, "structured_output": self.result}).returncode, 1)
        self.assertEqual(self.run_launcher({"subtype": "error_during_execution", "structured_output": self.result}).returncode, 1)
        self.assertEqual(self.run_launcher(mode="exit").returncode, 1)

    def test_invalid_results(self):
        cases = [None, [], {**self.result, "extra": 1}, {**self.result, "summary": "x" * 6001}, {**self.result, "sources": []}, {**self.result, "sources": [{"url": "file:///x", "evidence": "x"}]}, {**self.result, "sources": [{"url": "https://example.com", "evidence": "x\n" * 11}]}, {**self.result, "warnings": [1]}, {**self.result, "sources": [{"url": "https://example.com", "evidence": "  \n"}]}]
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
        self.worker_metadata['tools'].append('Read')
        self.worker.write_text('---\n' + json.dumps(self.worker_metadata) + '\n---\nReturn a report.\n')
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

    def test_diagnostic_keeps_subtype_with_result_text(self):
        spec = importlib.util.spec_from_file_location("diagnostic_runner", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        detail = runner.diagnostic_detail(json.dumps({"subtype": "error_max_turns", "result": "Turn limit reached"}).encode(), b"")
        self.assertIn("error_max_turns", detail)
        self.assertIn("Turn limit reached", detail)

    def test_diagnostic_redacts_quoted_json_values(self):
        spec = importlib.util.spec_from_file_location("diagnostic_runner", ROOT / "scripts/run.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        detail = runner.diagnostic_detail(b"", b'{"token": "sensitive-value", "password": "one two", "message": "session expired"}')
        self.assertNotIn("sensitive-value", detail)
        self.assertNotIn("one two", detail)
        self.assertIn("session expired", detail)

    def test_error_subtype_with_empty_result(self):
        for code in (0, 7):
            with self.subTest(code=code):
                self.fake.write_text('#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps({"is_error": True, "subtype": "error_max_turns", "result": None, "secret": "do-not-print"}))\nsys.stderr.write("token=secret-value session expired")\nsys.exit(' + str(code) + ')\n')
                result = self.run_launcher()
                error = json.loads(result.stdout)["error"]
                self.assertIn("error_max_turns", error)
                self.assertIn("session expired", error)
                self.assertNotIn("secret-value", error)
                self.assertNotIn("do-not-print", error)

    def test_completed_output_with_descendant_holding_pipe(self):
        pid_path = self.data / "holder.pid"
        self.fake.write_text('#!/usr/bin/env python3\nimport json, os, subprocess, sys\nfrom pathlib import Path\np = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])\nPath(' + repr(str(pid_path)) + ').write_text(str(p.pid))\nprint(os.environ["ENVELOPE"], flush=True)\n')
        try:
            result = self.run_launcher(extra=["--timeout", "2"])
            self.assertEqual(result.returncode, 0, result.stdout)
        finally:
            if pid_path.exists():
                try:
                    os.kill(int(pid_path.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_completed_output_with_noisy_descendant(self):
        pid_path = self.data / "writer.pid"
        child_code = "import sys,time\nfor _ in range(600):\n sys.stderr.write('progress\\n');sys.stderr.flush();time.sleep(.05)"
        self.fake.write_text('#!/usr/bin/env python3\nimport os,subprocess,sys\nfrom pathlib import Path\np=subprocess.Popen([sys.executable,"-c",' + repr(child_code) + '])\nPath(' + repr(str(pid_path)) + ').write_text(str(p.pid))\nprint(os.environ["ENVELOPE"],flush=True)\n')
        try:
            result = self.run_launcher(extra=["--timeout", "2"])
            self.assertEqual(result.returncode, 0, result.stdout)
        finally:
            if pid_path.exists():
                try:
                    os.kill(int(pid_path.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_signal_cleans_child_group(self):
        for sig, code in ((signal.SIGTERM, 143), (signal.SIGINT, 130), (signal.SIGHUP, 129), (signal.SIGQUIT, 131)):
            with self.subTest(signal=sig):
                self.check_signal_cleans_child_group(sig, code)

    def check_signal_cleans_child_group(self, sig, code):
        pid_path = self.data / ("child-%d.pid" % sig)
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
        process.send_signal(sig)
        out, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, code, out)
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
