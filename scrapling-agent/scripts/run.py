#!/usr/bin/env python3
"""Run the installed Scrapling worker in a bounded child session."""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit

LIMIT = 1024 * 1024


class Terminated(Exception):
    """A termination signal that must propagate through selectors' EINTR handling."""


def fail(message, code=1):
    print(json.dumps({"status": "error", "summary": "", "sources": [], "warnings": [], "error": message[:1000]}, ensure_ascii=False))
    return code


def url_ok(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 4096 or any(c.isspace() or ord(c) < 32 for c in value):
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname) and parsed.port != 0
    except ValueError:
        return False


def validate(data):
    if not isinstance(data, dict) or not {"status", "summary", "sources", "warnings"} <= data.keys() or data.keys() - {"status", "summary", "sources", "warnings", "error"}:
        return False
    if data["status"] not in ("ok", "partial", "error") or not isinstance(data["summary"], str) or len(data["summary"]) > 6000:
        return False
    sources, warnings = data["sources"], data["warnings"]
    if not isinstance(sources, list) or len(sources) > 5 or (data["status"] == "ok" and not sources):
        return False
    lines = 0
    for source in sources:
        if not isinstance(source, dict) or set(source) != {"url", "evidence"} or not url_ok(source["url"]):
            return False
        evidence = source["evidence"]
        if not isinstance(evidence, str) or not 1 <= len(evidence) <= 2000:
            return False
        lines += len(evidence.splitlines())
    return (lines <= 10 and isinstance(warnings, list) and len(warnings) <= 10
            and all(isinstance(w, str) and len(w) <= 1000 for w in warnings)
            and ("error" not in data or isinstance(data["error"], str) and len(data["error"]) <= 1000))


def installation():
    package = Path(__file__).resolve().parent.parent
    data = package.parent.resolve()
    try:
        config = json.loads((data / "installation.json").read_text())
        if not isinstance(config, dict) or config.get("schema_version") != 1 or config.get("ready") is not True:
            raise ValueError("installation is not ready")
        if Path(config["package_root"]).resolve() != package or package.name != "package":
            raise ValueError("invalid package root")
        work = Path(config["work_dir"]).resolve()
        if work != data / "work" or not work.is_dir():
            raise ValueError("invalid work directory")
        schema = package / "schemas" / "result.schema.json"
        agent = Path(config["agent_path"])
        runtime = Path(config["runtime_python"])
        if not schema.is_file() or not agent.is_file() or not runtime.is_file() or not Path(config["mcp_command"]).is_file():
            raise ValueError("required installed files are missing")
        worker = agent.read_text()
        frontmatter = worker.split("---", 2)
        if len(frontmatter) != 3 or frontmatter[0].strip():
            raise ValueError("invalid worker frontmatter")
        matches = re.findall(r"^tools:\s*(.+)$", frontmatter[1], re.MULTILINE)
        if len(matches) != 1:
            raise ValueError("invalid worker tools")
        tools = [item.strip() for item in matches[0].split(",")]
        if not tools or any(not re.fullmatch(r"(?:Read|StructuredOutput|mcp__scrapling__[A-Za-z0-9_]+)", item) for item in tools):
            raise ValueError("invalid worker tools")
        schema_text = schema.read_text()
        json.loads(schema_text)
        return work, schema_text, tools
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Scrapling setup is missing or invalid; run the installer: " + str(exc)) from exc


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def execute(argv, cwd, timeout):
    def terminated(signum, frame):
        raise Terminated("received SIGTERM")

    previous = signal.signal(signal.SIGTERM, terminated)
    try:
        return execute_child(argv, cwd, timeout)
    finally:
        signal.signal(signal.SIGTERM, previous)


def execute_child(argv, cwd, timeout):
    process = None
    selector = None
    pending_signals = []

    def defer_signal(signum, frame):
        pending_signals.append(signum)

    try:
        # Do not interrupt Popen before it returns the reference needed for cleanup.
        # Handlers, rather than a signal mask, leave the child's signals unblocked.
        previous_handlers = {}
        try:
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous_handlers[signum] = signal.getsignal(signum)
                signal.signal(signum, defer_signal)
            process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        finally:
            try:
                if signal.SIGINT in previous_handlers:
                    signal.signal(signal.SIGINT, previous_handlers[signal.SIGINT])
            finally:
                if signal.SIGTERM in previous_handlers:
                    signal.signal(signal.SIGTERM, previous_handlers[signal.SIGTERM])
        if pending_signals:
            if pending_signals[0] == signal.SIGTERM:
                raise Terminated("received SIGTERM")
            raise KeyboardInterrupt
        selector = selectors.DefaultSelector()
        buffers = {"stdout": bytearray(), "stderr": bytearray()}
        for name in buffers:
            selector.register(getattr(process, name), selectors.EVENT_READ, name)
        deadline = time.monotonic() + timeout
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            for key, _ in selector.select(remaining):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                else:
                    buffer = buffers[key.data]
                    buffer.extend(chunk)
                    if len(buffer) > LIMIT:
                        raise OverflowError
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        process.wait(timeout=remaining)
        return process.returncode, bytes(buffers["stdout"]), bytes(buffers["stderr"])
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError from exc
    finally:
        # Also terminate descendants that survived their parent or kept pipes open.
        if process is not None:
            stop(process)
        if selector is not None:
            selector.close()
        if process is not None:
            process.stdout.close()
            process.stderr.close()


def diagnostic_detail(output, diagnostic):
    """Return a short error excerpt, excluding full tool/model payloads and common secrets."""
    text = diagnostic.decode("utf-8", errors="replace").strip()
    try:
        envelope = json.loads(output)
        if isinstance(envelope, dict) and isinstance(envelope.get("result"), str):
            text = envelope["result"]
    except (ValueError, UnicodeError):
        pass
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    text = re.sub(r"(?i)Bearer\s+\S+", "Bearer [REDACTED]", text)
    text = re.sub(r"(?:sk-ant-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]+", "[REDACTED]", text)
    text = re.sub(r"(?i)((?:api[_-]?key|token|password|cookie)\s*[:=]\s*)\S+", r"\1[REDACTED]", text)
    text = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1[REDACTED]@", text)
    text = " ".join(text.split())
    return text[:700] if text else "check authentication, connection, and permissions"


def main():
    parser = argparse.ArgumentParser(description="Run the installed Scrapling worker")
    parser.add_argument("--url", action="append", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--claude", default="claude")
    args = parser.parse_args()
    if not 1 <= len(args.url) <= 10 or not all(url_ok(url) for url in args.url) or not 1 <= len(args.task) <= 8000 or not 1 <= args.timeout <= 3600:
        parser.error("invalid URL, task, or timeout")
    try:
        work, schema, tools = installation()
        prompt = json.dumps({"urls": args.url, "task": args.task}, ensure_ascii=False)
        command = [args.claude, "--agent", "scrapling-worker", "--print", "--output-format", "json", "--json-schema", schema, "--no-session-persistence", "--setting-sources", "user", "--tools", "Read,StructuredOutput", "--allowedTools", ",".join(tools), "--", prompt]
        code, output, diagnostic = execute(command, work, args.timeout)
        if code != 0:
            return fail("Claude failed with exit code " + str(code) + ": " + diagnostic_detail(output, diagnostic))
        envelope = json.loads(output)
        if not isinstance(envelope, dict) or envelope.get("is_error", False) is not False or envelope.get("subtype", "success") != "success":
            return fail("Claude returned an error envelope: " + diagnostic_detail(output, diagnostic))
        result = envelope.get("structured_output")
        if result is None and isinstance(envelope.get("result"), str):
            result = json.loads(envelope["result"])
        if not validate(result):
            return fail("Claude returned an invalid extraction result.")
        print(json.dumps(result, ensure_ascii=False))
        return {"ok": 0, "partial": 3, "error": 1}[result["status"]]
    except TimeoutError:
        return fail("Claude timed out.", 124)
    except OverflowError:
        return fail("Claude output exceeded the capture limit.")
    except Terminated:
        return fail("Claude was terminated; child processes were stopped.", 143)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        return fail("Unable to run or validate Claude: " + str(exc)[:500])
    except KeyboardInterrupt:
        return fail("Claude was interrupted.")


if __name__ == "__main__":
    sys.exit(main())
