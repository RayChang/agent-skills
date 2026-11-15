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

    def __init__(self, message, signum=signal.SIGTERM):
        super().__init__(message)
        self.signum = signum


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
        if not isinstance(evidence, str) or not 1 <= len(evidence) <= 2000 or not evidence.strip():
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
        frontmatter = re.split(r"(?m)^---[ \t]*$", worker, maxsplit=2)
        if len(frontmatter) != 3 or frontmatter[0].strip():
            raise ValueError("invalid worker frontmatter")
        # JSON is a YAML subset; our generated frontmatter has unambiguous types.
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("unsupported worker configuration: duplicate field")
                result[key] = value
            return result

        metadata = json.loads(frontmatter[1], object_pairs_hook=unique_object)
        fields = {"name", "description", "model", "maxTurns", "tools", "mcpServers"}
        if not isinstance(metadata, dict) or set(metadata) != fields:
            raise ValueError("unsupported worker configuration; restore the installed template")
        tools = metadata["tools"]
        expected_mcp = [{"scrapling": {"type": "stdio", "command": config["mcp_command"]}}]
        if (metadata["name"] != "scrapling-worker"
                or not all(isinstance(metadata[key], str) and metadata[key].strip() for key in ("description", "model"))
                or type(metadata["maxTurns"]) is not int or not 1 <= metadata["maxTurns"] <= 100
                or not isinstance(tools, list) or "StructuredOutput" not in tools
                or any(not isinstance(item, str) or not re.fullmatch(r"(?:StructuredOutput|mcp__scrapling__[A-Za-z0-9_]+)", item) for item in tools)
                or metadata["mcpServers"] != expected_mcp):
            raise ValueError("unsupported worker configuration; restore the installed template")
        definition = {key: metadata[key] for key in fields - {"name"}}
        definition["prompt"] = frontmatter[2].strip()
        schema_text = schema.read_text()
        json.loads(schema_text)
        return work, schema_text, tools, definition
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
        raise Terminated("received signal", signum)

    previous = {}
    try:
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
            previous[signum] = signal.getsignal(signum)
            if previous[signum] != signal.SIG_IGN:
                signal.signal(signum, terminated)
        return execute_child(argv, cwd, timeout)
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def execute_child(argv, cwd, timeout):
    process = None
    selector = None
    stopped = False
    pending_signals = []

    def defer_signal(signum, frame):
        pending_signals.append(signum)

    try:
        # Do not interrupt Popen before it returns the reference needed for cleanup.
        # Handlers, rather than a signal mask, leave the child's signals unblocked.
        previous_handlers = {}
        try:
            for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGQUIT):
                previous_handlers[signum] = signal.getsignal(signum)
                if previous_handlers[signum] != signal.SIG_IGN:
                    signal.signal(signum, defer_signal)
            process = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
        if pending_signals:
            raise Terminated("received signal", pending_signals[0])
        selector = selectors.DefaultSelector()
        buffers = {"stdout": bytearray(), "stderr": bytearray()}
        for name in buffers:
            selector.register(getattr(process, name), selectors.EVENT_READ, name)
        def capture(events):
            for key, _ in events:
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                else:
                    buffer = buffers[key.data]
                    buffer.extend(chunk)
                    if len(buffer) > LIMIT:
                        raise OverflowError

        deadline = time.monotonic() + timeout
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            events = selector.select(min(remaining, 0.1))
            if process.poll() is not None:
                # Stop writers in our group, then drain everything already available.
                stop(process)
                stopped = True
                while selector.get_map():
                    pending = selector.select(0)
                    if not pending:
                        break
                    capture(pending)
                break
            capture(events)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        process.wait(timeout=remaining)
        return process.returncode, bytes(buffers["stdout"]), bytes(buffers["stderr"])
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError from exc
    finally:
        # Stop the child's process group, including inherited-pipe holders.
        if process is not None and not stopped:
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
        if isinstance(envelope, dict):
            result = envelope.get("result")
            if isinstance(result, str) and result.strip():
                text = result
            subtype = envelope.get("subtype")
            if isinstance(subtype, str) and re.fullmatch(r"[A-Za-z0-9_]{1,100}", subtype):
                text = subtype + (": " + text if text else "")
    except (ValueError, UnicodeError):
        pass
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    text = re.sub(r"(?i)Bearer\s+\S+", "Bearer [REDACTED]", text)
    text = re.sub(r"(?:sk-ant-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]+", "[REDACTED]", text)
    text = re.sub(r"""(?i)((?:["']?(?:api[_-]?key|token|password|cookie)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)""", r"\1[REDACTED]", text)
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
        work, schema, tools, definition = installation()
        prompt = json.dumps({"urls": args.url, "task": args.task}, ensure_ascii=False)
        command = [args.claude, "--agents", json.dumps({"scrapling-worker": definition}), "--agent", "scrapling-worker", "--print", "--output-format", "json", "--json-schema", schema, "--no-session-persistence", "--setting-sources", "user", "--tools", "StructuredOutput", "--allowedTools", ",".join(tools), "--", prompt]
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
            return fail("Claude returned an invalid extraction result; check schema bounds, sources for ok, nonblank evidence, and the ten-line evidence limit.")
        print(json.dumps(result, ensure_ascii=False))
        return {"ok": 0, "partial": 3, "error": 1}[result["status"]]
    except TimeoutError:
        return fail("Claude timed out.", 124)
    except OverflowError:
        return fail("Claude output exceeded the capture limit.")
    except Terminated as exc:
        return fail("Claude was terminated; its child process group was stopped.", 128 + exc.signum)
    except (OSError, ValueError, TypeError, RecursionError) as exc:
        return fail("Unable to run or validate Claude: " + str(exc)[:500])
    except KeyboardInterrupt:
        return fail("Claude was interrupted.", 130)


if __name__ == "__main__":
    sys.exit(main())
