#!/usr/bin/env python3
"""Install the Scrapling agent into an isolated user home."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

BUNDLE = ("SKILL.md", "agents/scrapling-worker.md.tmpl", "schemas/result.schema.json",
          "scripts/install.py", "scripts/run.py", "references/architecture.md")
PLACEHOLDER = "__SCRAPLING_MCP_COMMAND_JSON__"
BROWSER_CHECK = """from pathlib import Path
from patchright.sync_api import sync_playwright
with sync_playwright() as engine:
    path = Path(engine.chromium.executable_path)
    if not path.is_file():
        raise FileNotFoundError('Patchright Chromium is missing: ' + str(path))
"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_manifest(path, manifest):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        tmp = Path(stream.name)
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    os.replace(tmp, path)


def install(home, source, dry_run=False, no_browser=False):
    home = Path(home).expanduser().resolve()
    source = Path(source).resolve()
    data = home / ".local/share/scrapling-agent"
    package = data / "package"
    runtime = data / ".venv/bin/python"
    mcp = data / ".venv/bin/scrapling-mcp"
    agent = home / ".claude/agents/scrapling-worker.md"
    entry = home / ".local/bin/scrapling-agent"
    skill = home / ".agents/skills/scrapling-agent"
    claude_skill = home / ".claude/skills/scrapling-agent"
    manifest_path = data / "installation.json"
    old = {}
    if manifest_path.exists():
        try:
            old = json.loads(manifest_path.read_text())
            if not isinstance(old, dict) or old.get("schema_version") != 1 or not isinstance(old.get("files"), dict) or not isinstance(old.get("links"), dict):
                raise ValueError("invalid ownership manifest")
        except (ValueError, OSError) as exc:
            raise RuntimeError(f"Cannot read ownership manifest {manifest_path}: {exc}") from exc
    files = {str(package / name): (source / name).read_bytes() for name in BUNDLE}
    template = files[str(package / "agents/scrapling-worker.md.tmpl")].decode()
    if template.count(PLACEHOLDER) != 1:
        raise RuntimeError("Worker template must contain exactly one MCP command placeholder")
    files[str(agent)] = template.replace(PLACEHOLDER, json.dumps(str(mcp))).encode()
    files[str(entry)] = ("#!/bin/sh\nexec " + shlex.quote(str(runtime)) + " " +
                         shlex.quote(str(package / "scripts/run.py")) + ' "$@"\n').encode()
    links = {str(skill): str(package), str(claude_skill): str(package)}
    external = set(old.get("external_skills", []))
    # A source skill installed by a manager is an intentional external destination.
    for link in list(links):
        if Path(link).is_dir() and not Path(link).is_symlink() and Path(link).resolve() == source:
            external.add(link)
            del links[link]
        elif link in external and Path(link).is_dir() and not Path(link).is_symlink():
            del links[link]
    for link in list(links):
        p = Path(link)
        if p.is_symlink() and any(Path(item).is_dir() and not Path(item).is_symlink()
                                  and p.resolve() == Path(item).resolve() for item in external):
            external.add(link)
            del links[link]
    pending_files = old.get("pending_files", {}) if old.get("ready") is False else {}
    pending_links = old.get("pending_links", {}) if old.get("ready") is False else {}
    current_files = {}
    missing = False
    for path, expected in old.get("files", {}).items():
        p = Path(path)
        allowed = {expected, pending_files.get(path, expected)}
        if not p.exists() and not p.is_symlink():
            missing = True
            continue
        if not p.is_file() or p.is_symlink() or digest(p.read_bytes()) not in allowed:
            raise RuntimeError(f"Owned file was modified: {p}; restore it before reinstalling")
        current_files[path] = digest(p.read_bytes())
    for path, expected in pending_files.items():
        p = Path(path)
        if path not in old.get("files", {}) and (p.exists() or p.is_symlink()):
            if not p.is_file() or p.is_symlink() or digest(p.read_bytes()) != expected:
                raise RuntimeError(f"Pending file was modified: {p}; restore it before reinstalling")
            current_files[path] = expected
    for path, expected in old.get("links", {}).items():
        if path in external and path not in links:
            continue
        p = Path(path)
        if not p.exists() and not p.is_symlink():
            missing = True
            continue
        if not p.is_symlink() or os.readlink(p) != expected:
            raise RuntimeError(f"Owned link was modified: {p}; restore it before reinstalling")
    for path in files:
        p = Path(path)
        if (p.exists() or p.is_symlink()) and path not in old.get("files", {}) and path not in pending_files:
            raise RuntimeError(f"Unowned file collision: {p}; move it before installing")
    for path in links:
        p = Path(path)
        if (p.exists() or p.is_symlink()) and path not in old.get("links", {}):
            if path not in pending_links or not p.is_symlink() or os.readlink(p) != pending_links[path]:
                raise RuntimeError(f"Unowned skill collision: {p}; move it before installing")
    if not old and (data / ".venv").exists():
        raise RuntimeError(f"Unowned runtime collision: {data / '.venv'}; move it before installing")
    manifest = dict(schema_version=1, ready=False, package_root=str(package), user_home=str(home),
                    runtime_python=str(runtime), mcp_command=str(mcp), agent_path=str(agent),
                    work_dir=str(data / "work"), browser_installed=bool(old.get("browser_installed")),
                    files={p: digest(content) for p, content in files.items()}, links=links,
                    external_skills=sorted(external))
    same = (not missing and old.get("ready") is True and old.get("files") == manifest["files"] and
            old.get("links") == links and (no_browser or old.get("browser_installed")) and
            runtime.is_file() and mcp.is_file() and (data / "work").is_dir())
    if dry_run:
        if same:
            print(f"Would check browser and reuse existing installation or repair it if missing: {entry}" if not no_browser else f"Already installed: {entry}")
            return
        print(f"Would create runtime {runtime} and install Scrapling; browser: {'skip' if no_browser else 'install and verify'}")
        for path in files:
            print(f"Would publish file: {path}")
        for path, target in links.items():
            print(f"Would link {path} -> {target}")
        return
    if same and not no_browser:
        try:
            subprocess.run([str(runtime), "-c", BROWSER_CHECK], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.SubprocessError:
            same = False
            manifest["browser_installed"] = False
    if same:
        print(f"Already installed. Add {entry.parent} to PATH, or use {entry}")
        return
    # Never advertise readiness while a setup or update is incomplete.
    pending = dict(old or manifest, ready=False, browser_installed=manifest["browser_installed"])
    if not old:
        pending.update(files={}, links={})
    # Journal intended hashes before publishing. A crash between replace and manifest
    # update can then recognize either the previous file or this exact staged content.
    pending["files"] = dict(old.get("files", {}), **current_files)
    pending["links"] = {path: target for path, target in old.get("links", {}).items()
                        if path not in external or path in links}
    pending.update(pending_files=manifest["files"], pending_links=links,
                   external_skills=manifest["external_skills"])
    write_manifest(manifest_path, pending)
    stage = "staging assets"
    try:
        stage = "creating Python runtime"
        subprocess.run(["uv", "venv", "--allow-existing", "--python", "3.13", str(data / ".venv")], check=True)
        stage = "installing Scrapling"
        subprocess.run(["uv", "pip", "install", "--python", str(runtime), "scrapling[ai]==0.5.1"], check=True)
        if not no_browser:
            stage = "installing browsers"
            pending["browser_installed"] = False
            write_manifest(manifest_path, pending)
            subprocess.run([str(data / ".venv/bin/scrapling"), "install"], check=True)
            subprocess.run([str(runtime), "-m", "patchright", "install", "chromium"], check=True)
            stage = "checking Patchright browser"
            subprocess.run([str(runtime), "-c", BROWSER_CHECK], check=True)
            manifest["browser_installed"] = True
            pending["browser_installed"] = True
            write_manifest(manifest_path, pending)
        stage = "publishing assets"
        (data / "work").mkdir(parents=True, exist_ok=True)
        for path, content in files.items():
            target = Path(path)
            # Recheck after runtime setup: an edit made during setup is not ours.
            if target.exists() or target.is_symlink():
                if (path not in current_files or not target.is_file() or target.is_symlink()
                        or digest(target.read_bytes()) != current_files[path]):
                    raise RuntimeError(f"Owned file was modified during setup: {target}; restore it before reinstalling")
            target.parent.mkdir(parents=True, exist_ok=True)
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as stream:
                    temp_path = Path(stream.name)
                    stream.write(content)
                if path == str(entry):
                    temp_path.chmod(0o755)
                os.replace(temp_path, target)
            finally:
                if temp_path is not None:
                    temp_path.unlink(missing_ok=True)
            pending["files"][path] = manifest["files"][path]
            write_manifest(manifest_path, pending)
        for path, target in links.items():
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            if p.exists() or p.is_symlink():
                expected = old.get("links", {}).get(path, pending_links.get(path))
                if not p.is_symlink() or os.readlink(p) != expected:
                    raise RuntimeError(f"Owned link was modified during setup: {p}; restore it before reinstalling")
            else:
                p.symlink_to(target, target_is_directory=True)
            pending["links"][path] = target
            write_manifest(manifest_path, pending)
        write_manifest(manifest_path, dict(manifest, ready=True))
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Setup failed while {stage}: {exc}") from exc
    print(f"Installed. Add {entry.parent} to PATH, or use {entry}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-home", type=Path, default=Path.home())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        install(args.user_home, Path(__file__).resolve().parent.parent, args.dry_run, args.no_browser)
    except (OSError, RuntimeError, UnicodeError) as exc:
        print(f"Installation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
