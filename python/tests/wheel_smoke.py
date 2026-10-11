#!/usr/bin/env python3
"""Installs the built wheel into an empty venv (no Node.js on the PATH) and runs it.

    python python/tests/wheel_smoke.py release/python [--pipx]

Standard library only; never reads the repository's source.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from email.parser import Parser
from pathlib import Path

IS_WINDOWS = os.name == "nt"
passed = 0


class Failure(Exception):
    pass


def check(condition: object, message: str) -> None:
    global passed
    if not condition:
        raise Failure(f"Wheel check failed: {message}")
    passed += 1


def step(title: str) -> None:
    print(f"\n== {title}", flush=True)


# ------------------------------------------------------------------------------------------
# Versions: one release, two spellings (the table in scripts/python/version.ts)
# ------------------------------------------------------------------------------------------

_SHORT = {"alpha": "a", "beta": "b", "rc": "rc"}


def to_pep440(version: str) -> str:
    match = re.fullmatch(r"(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?", version)
    if not match:
        raise Failure(f"{version!r} cannot be written as a Python version")
    release, kind, number = match.groups()
    return release if kind is None else f"{release}{_SHORT[kind]}{number}"


# ------------------------------------------------------------------------------------------
# The wheel file
# ------------------------------------------------------------------------------------------

REQUIRED = [
    "mossnote/__init__.py",
    "mossnote/__main__.py",
    "mossnote/cli.py",
    "mossnote/_app/package.json",
    "mossnote/_app/BUILD.json",
    "mossnote/_app/bin/mossnote.js",
    "mossnote/_app/bin/options.js",
    "mossnote/_app/dist/server/index.js",
    "mossnote/_app/dist/web/index.html",
    "mossnote/_app/drizzle/meta/_journal.json",
    "mossnote/_app/node_modules/better-sqlite3/lib/index.js",
    "mossnote/_app/node_modules/hono/package.json",
]
PREBUILDS = [
    f"mossnote/_app/node_modules/better-sqlite3/prebuilds/{name}.node"
    for name in (
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64",
        "linux-x64",
        "linuxmusl-arm64",
        "linuxmusl-x64",
        "win32-arm64",
        "win32-x64",
    )
]
# Third-party code under node_modules is only checked for what the build removes.
FORBIDDEN = re.compile(
    r"(?:\.map$|\.d\.[cm]?ts$|_snapshot\.json$|(?:^|/)\.env|package-lock\.json$|"
    r"/node_modules/\.bin/|better-sqlite3/(?:deps|src|docs)/)"
)
FORBIDDEN_OURS = re.compile(
    r"_app/(?:src|tests?|scripts|docs)/|_app/dist/standalone/|\.test\.|\.tsbuildinfo$"
)
# Windows stops at 260 characters; site-packages is about 80 down.
LONGEST_MEMBER = 110
DEV_ONLY = ("vite", "typescript", "react", "react-dom", "tsx", "vitest", "eslint", "tsup")


def find_wheel(argument: str) -> Path:
    target = Path(argument).resolve()
    check(target.exists(), f"{target} exists")
    if target.is_file():
        return target
    found = sorted(target.glob("*.whl"))
    check(len(found) == 1, f"{target} holds exactly one .whl (found {len(found)})")
    return found[0]


def inspect_wheel(wheel: Path) -> tuple[str, str]:
    """Check the wheel's contents and metadata. Returns (npm version, python version)."""
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        files = [name for name in names if not name.endswith("/")]
        for required in REQUIRED + PREBUILDS:
            check(required in names, f"the wheel has {required}")
        check(
            any(re.fullmatch(r"mossnote/_app/drizzle/\d{4}_.+\.sql", n) for n in names),
            "the wheel has the SQL migrations",
        )
        check(
            any(re.fullmatch(r"mossnote/_app/dist/web/assets/.+\.js", n) for n in names),
            "the wheel has the built web app",
        )
        forbidden = [
            name
            for name in files
            if FORBIDDEN.search(name)
            or ("/node_modules/" not in name and FORBIDDEN_OURS.search(name))
        ]
        check(not forbidden, f"nothing that is not needed is packed (found {forbidden[:3]})")
        longest = max(files, key=len)
        check(len(longest) <= LONGEST_MEMBER, f"no path is longer than {LONGEST_MEMBER} (got {len(longest)}: {longest})")
        check(
            sum(info.file_size for info in archive.infolist()) < 60 * 1024 * 1024,
            "the package is under 60 MB unpacked",
        )

        app_package = json.loads(archive.read("mossnote/_app/package.json"))
        npm_version = app_package["version"]
        python_version = to_pep440(npm_version)
        check(wheel.name == f"mossnote-{python_version}-py3-none-any.whl", f"the file name is mossnote-{python_version}-py3-none-any.whl (got {wheel.name})")

        dist_info = f"mossnote-{python_version}.dist-info"
        metadata = Parser().parsestr(archive.read(f"{dist_info}/METADATA").decode())
        check(metadata["Name"] == "mossnote", "the package is named mossnote")
        check(metadata["Version"] == python_version, f"the metadata version is {python_version} (got {metadata['Version']})")
        check(metadata["Requires-Python"] == ">=3.10", f"Python 3.10 or newer is required (got {metadata['Requires-Python']})")
        requires = metadata.get_all("Requires-Dist") or []
        check(
            len(requires) == 1 and requires[0].startswith("nodejs-wheel-binaries"),
            f"the one dependency is nodejs-wheel-binaries (got {requires})",
        )
        check(metadata["License-Expression"] == "MIT", "the licence is MIT")
        check(any(n.startswith(f"{dist_info}/licenses/") for n in names), "the licence file is in the wheel")
        wheel_info = archive.read(f"{dist_info}/WHEEL").decode()
        check("Tag: py3-none-any" in wheel_info and "Root-Is-Purelib: true" in wheel_info, "it is one wheel for every system (py3-none-any)")
        check(
            "mossnote = mossnote.cli:main" in archive.read(f"{dist_info}/entry_points.txt").decode(),
            "the mossnote command is registered",
        )

        # The app is exactly what the build made: the server file matches the recorded hash.
        build = json.loads(archive.read("mossnote/_app/BUILD.json"))
        server = archive.read("mossnote/_app/dist/server/index.js")
        check(build["serverSha256"] == hashlib.sha256(server).hexdigest(), "the server in the wheel is the one the build recorded")
        check(build["npmVersion"] == npm_version and build["pythonVersion"] == python_version, "the build record names both spellings of the version")

        # Every package the server imports is installed, and is a declared dependency.
        dependencies = app_package["dependencies"]
        for name in dependencies:
            check(f"mossnote/_app/node_modules/{name}/package.json" in names, f"the production dependency {name} is in the wheel")
        for name in DEV_ONLY:
            check(f"mossnote/_app/node_modules/{name}/package.json" not in names, f"{name} is not packed (development only)")
        source = server.decode()
        specifiers = set(re.findall(r"^(?:import|export)\s[^'\"\n]*?from\s*['\"]([^'\"]+)['\"]", source, re.M))
        specifiers |= set(re.findall(r"^import\s*['\"]([^'\"]+)['\"]", source, re.M))
        check(len(specifiers) > 5, "the built server imports its dependencies")
        for specifier in specifiers:
            if specifier.startswith((".", "node:")):
                continue
            parts = specifier.split("/")
            name = "/".join(parts[:2]) if specifier.startswith("@") else parts[0]
            if name in {"fs", "os", "path", "crypto", "url", "http", "https", "net", "stream", "util", "events", "zlib", "child_process", "module", "buffer", "worker_threads", "process", "readline", "tty", "assert", "dns", "async_hooks", "perf_hooks", "string_decoder", "timers", "v8", "vm", "querystring", "constants", "diagnostics_channel", "http2", "inspector", "punycode", "cluster", "dgram", "domain", "repl", "tls", "trace_events", "wasi"}:
                continue
            check(name in dependencies, f"the server's import {specifier!r} is a declared dependency")
    print(f"   {wheel.name}: {len(files)} files, npm {npm_version} = Python {python_version}")
    return npm_version, python_version


# ------------------------------------------------------------------------------------------
# Running it
# ------------------------------------------------------------------------------------------


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def run(command: list[str], *, env: dict[str, str], cwd: Path, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, env=env, cwd=cwd, capture_output=True, text=True, timeout=timeout)


class Server:
    def __init__(self, command: list[str], env: dict[str, str], cwd: Path, log: Path, port: int) -> None:
        self.port = port
        self.url = f"http://127.0.0.1:{port}"
        self.log = log
        self._file = open(log, "w", encoding="utf-8")
        self.process = subprocess.Popen(command, env=env, cwd=cwd, stdout=self._file, stderr=subprocess.STDOUT)

    def output(self) -> str:
        self._file.flush()
        return self.log.read_text(encoding="utf-8", errors="replace")

    def wait_for_health(self) -> dict:
        deadline = time.time() + 90
        while True:
            try:
                with urllib.request.urlopen(f"{self.url}/api/health", timeout=3) as reply:
                    return json.load(reply)
            except (urllib.error.URLError, OSError, ConnectionError):
                pass
            if self.process.poll() is not None:
                raise Failure(f"Wheel check failed: the server stopped while starting (exit {self.process.returncode}):\n{self.output()}")
            if time.time() > deadline:
                raise Failure(f"Wheel check failed: no answer from {self.url}:\n{self.output()}")
            time.sleep(0.25)

    def get(self, path: str) -> tuple[int, str]:
        try:
            with urllib.request.urlopen(f"{self.url}{path}", timeout=15) as reply:
                return reply.status, reply.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")

    def post(self, path: str, body: dict) -> tuple[int, str]:
        request = urllib.request.Request(
            f"{self.url}{path}",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Moss-Client": "web"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as reply:
                return reply.status, reply.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode("utf-8", "replace")

    def status_with_host(self, host: str) -> int:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.putrequest("GET", "/api/health", skip_host=True)
        connection.putheader("Host", host)
        connection.endheaders()
        status = connection.getresponse().status
        connection.close()
        return status

    def stop(self, how: str = "term") -> int | None:
        """Stop it. `term` and `int` are how a service manager and Ctrl+C stop it; `kill` is a crash."""
        if self.process.poll() is None:
            if IS_WINDOWS:
                # The command is a launcher that starts Python, which starts Node: end all three.
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.process.pid)], capture_output=True)
            elif how == "kill":
                self.process.kill()
            else:
                self.process.send_signal(signal.SIGINT if how == "int" else signal.SIGTERM)
        try:
            code = self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()
            code = self.process.wait()
        self._file.close()
        return code


def listing(folder: Path) -> str:
    entries = []
    for path in sorted(folder.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            entries.append(f"{path.relative_to(folder).as_posix()}:{path.stat().st_size}")
    return "\n".join(entries)


def isolated_env(base: Path, scripts: Path) -> tuple[dict[str, str], Path, Path]:
    """An environment with its own home, a PATH that holds only the venv, and nothing of the developer's."""
    home = base / "home"
    cwd = base / "cwd"
    home.mkdir(parents=True)
    cwd.mkdir()
    env = {
        "HOME": str(home),
        "USERPROFILE": str(home),
        "APPDATA": str(home / "AppData" / "Roaming"),
        "LOCALAPPDATA": str(home / "AppData" / "Local"),
        "TMPDIR": str(base),
        "PATH": str(scripts),
        "LANG": "C.UTF-8",
    }
    if IS_WINDOWS:
        for name in ("SystemRoot", "SYSTEMROOT", "SystemDrive", "WINDIR", "ComSpec", "PATHEXT", "TEMP", "TMP"):
            if name in os.environ:
                env[name] = os.environ[name]
        system_root = os.environ.get("SystemRoot", "C:\\Windows")
        env["PATH"] = scripts.as_posix().replace("/", "\\") + ";" + system_root + "\\System32"
        env["TEMP"] = env["TMP"] = str(base)
    check(shutil.which("node", path=env["PATH"]) is None, "no Node.js is on the PATH the tests use")
    default_data = (
        home / "AppData" / "Roaming" / "Mossnote"
        if IS_WINDOWS
        else home / "Library" / "Application Support" / "Mossnote"
        if sys.platform == "darwin"
        else home / ".local" / "share" / "mossnote"
    )
    return env, cwd, default_data


def data_folder_of(server: Server) -> Path:
    match = re.search(r"Data folder: (.+)", server.output())
    check(match, f"the server says where its data folder is:\n{server.output()}")
    return Path(match.group(1).strip())


def same(a: Path, b: Path) -> bool:
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", help="a .whl file, or a folder that holds one")
    parser.add_argument("--pipx", action="store_true", help="also test `pipx run` and `pipx install`")
    options = parser.parse_args()

    base = Path(tempfile.mkdtemp(prefix="moss-wheel-smoke-"))
    servers: list[Server] = []
    try:
        step("Check the wheel")
        wheel = find_wheel(options.wheel)
        npm_version, python_version = inspect_wheel(wheel)

        step(f"Install it by name into an empty virtual environment (Python {sys.version.split()[0]})")
        venv = base / "venv"
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
        scripts = venv / ("Scripts" if IS_WINDOWS else "bin")
        venv_python = scripts / ("python.exe" if IS_WINDOWS else "python")
        # By name and with no --pre: a beta is the only version, and pip then installs it.
        install = subprocess.run(
            [str(venv_python), "-m", "pip", "install", "--disable-pip-version-check", "--find-links", str(wheel.parent), "mossnote"],
            capture_output=True,
            text=True,
        )
        check(install.returncode == 0, f"pip install mossnote succeeds:\n{install.stdout}\n{install.stderr}")
        pip_check = subprocess.run([str(venv_python), "-m", "pip", "check"], capture_output=True, text=True)
        check(pip_check.returncode == 0, f"pip check finds no broken requirement:\n{pip_check.stdout}")
        command = str(scripts / ("mossnote.exe" if IS_WINDOWS else "mossnote"))
        check(Path(command).exists(), "the mossnote command is installed")
        site = Path(
            subprocess.run([str(venv_python), "-c", "import mossnote,pathlib;print(pathlib.Path(mossnote.__file__).parent)"], capture_output=True, text=True, check=True).stdout.strip()
        )
        node_versions = subprocess.run(
            [str(venv_python), "-c", "import nodejs_wheel.executable as e,subprocess,os;r=e.ROOT_DIR;n=os.path.join(r,'node.exe' if os.name=='nt' else os.path.join('bin','node'));print(subprocess.run([n,'--version'],capture_output=True,text=True).stdout.strip())"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        print(f"   installed with Node {node_versions} from nodejs-wheel-binaries")
        check(re.fullmatch(r"v(2[2-6])\.\d+\.\d+", node_versions), f"the bundled Node is a supported version (got {node_versions})")
        before = listing(site)

        env, cwd, default_data = isolated_env(base / "user", scripts)

        step("Version and help, every way to start it")
        for name, line in (("mossnote", [command]), ("python -m mossnote", [str(venv_python), "-m", "mossnote"])):
            out = run([*line, "--version"], env=env, cwd=cwd)
            check(out.returncode == 0 and out.stdout.strip() == npm_version, f"{name} --version prints {npm_version} (got {out.stdout.strip()!r} {out.stderr.strip()!r})")
            out = run([*line, "--help"], env=env, cwd=cwd)
            check(out.returncode == 0 and "Usage: mossnote" in out.stdout and f"Mossnote {npm_version}" in out.stdout, f"{name} --help describes the command")
        imported = run([str(venv_python), "-c", "import mossnote;print(mossnote.__version__)"], env=env, cwd=cwd)
        check(imported.stdout.strip() == python_version, f"mossnote.__version__ is {python_version} (got {imported.stdout.strip()!r})")

        step("Mistakes on the command line are reported, and nothing starts")
        mistakes = [
            (["--prot", "4000"], r'Unknown option "--prot"'),
            (["--port", "abc"], r"--port must be a whole number from 1 to 65535"),
            (["--port=70000"], r"--port must be a whole number"),
            (["--journal", "bad name"], r"--journal must be"),
            (["--data-dir"], r"--data-dir needs a value"),
            (["start"], r'Unexpected argument "start"'),
        ]
        for args, expected in mistakes:
            out = run([command, *args], env=env, cwd=cwd)
            check(out.returncode == 1 and re.search(expected, out.stderr), f"{' '.join(args)}: exits 1 and says why (got {out.returncode}: {out.stderr.strip()!r})")

        step("Start it with no options: journals go to the default data folder")
        port = free_port()
        first = Server([command, "--no-open", "--port", str(port)], env, cwd, base / "first.log", port)
        servers.append(first)
        health = first.wait_for_health()
        check(health.get("ok") is True and health.get("version") == npm_version, f"the API reports version {npm_version} (got {health.get('version')})")
        check(same(data_folder_of(first), default_data), f"the data folder is {default_data} (got {data_folder_of(first)})")
        status, html = first.get("/")
        check(status == 200 and 'id="root"' in html, "the app page is served")
        script = re.search(r'<script[^>]+src="([^"]+)"', html)
        check(script and first.get(script.group(1))[0] == 200, "the page's script is served")
        check(first.status_with_host("example.com") == 403, "a request that names another host is refused")
        status, _ = first.post("/api/journals", {"name": "Smoke test", "template": "default"})
        check(status == 201, f"a journal can be made (got {status})")
        status, _ = first.post("/api/notes", {"body": "A lantern by the gate #lead"})
        check(status in (200, 201), f"a note can be written (got {status})")
        check("lantern" in first.get("/api/search?q=lantrn")[1], "search finds the note, even with a typing mistake")
        exported = first.get("/api/data/export.json")[1]
        check("A lantern by the gate" in exported and npm_version in exported, "an export holds the note and the app version")
        check((default_data / "smoke-test.db").exists(), "the journal is a file in the data folder")
        check((default_data / "backups").is_dir(), "snapshots go in a backups folder beside it")
        check(not any(cwd.iterdir()), "nothing was written to the working folder")

        step("A second copy, and a busy port, are reported in plain words")
        second = run([command, "--no-open", "--port", str(free_port())], env=env, cwd=cwd)
        check(second.returncode == 1 and re.search("already running", second.stderr, re.I), f"a second copy for the same journal refuses to start (got {second.returncode}: {second.stderr.strip()!r})")
        busy = run([command, "--no-open", "--port", str(first.port), "--data-dir", str(base / "other-data")], env=env, cwd=cwd)
        check(busy.returncode == 1 and "already in use" in busy.stderr and "--port" in busy.stderr, f"a busy port is reported with the option to change it (got {busy.stderr.strip()!r})")

        step("Stop it, start it again, and the journal is still there")
        code = first.stop("term")
        servers.remove(first)
        if IS_WINDOWS:
            print("   Windows has no catchable stop signal; the next start recovers the lock instead.")
        else:
            check(code == 0, f"a stop (SIGTERM) ends with exit code 0 (got {code})")
            check(not (default_data / "smoke-test.lock").exists(), "the lock file is removed on a clean stop")
            check(not (default_data / "smoke-test.db-wal").exists(), "the write-ahead log is folded back into the journal on a clean stop")
        port = free_port()
        again = Server([command, "--no-open", "--port", str(port)], env, cwd, base / "again.log", port)
        servers.append(again)
        again.wait_for_health()
        check("A lantern by the gate" in again.get("/api/data/export.json")[1], "the note is still there after a restart")
        again.stop("kill")
        servers.remove(again)
        port = free_port()
        crashed = Server([command, "--no-open", "--port", str(port)], env, cwd, base / "crashed.log", port)
        servers.append(crashed)
        crashed.wait_for_health()
        check("A lantern by the gate" in crashed.get("/api/data/export.json")[1], "after a hard kill the next start recovers the lock and keeps the note")
        if not IS_WINDOWS:
            code = crashed.stop("int")
            check(code == 0, f"Ctrl+C (SIGINT) also ends with exit code 0 (got {code})")
            check(not (default_data / "smoke-test.lock").exists(), "the lock file is removed after Ctrl+C")
        else:
            crashed.stop()
        servers.remove(crashed)

        step("The options reach the app: --data-dir, --journal, --lan, and the environment")
        chosen = base / "chosen"
        from_env = base / "from-env"
        port = free_port()
        forwarded = Server(
            [command, "--no-open", "--lan", "--port", str(port), "--data-dir", str(chosen), "--journal", "second_game"],
            {**env, "MOSS_DATA_DIR": str(from_env)},
            cwd,
            base / "forwarded.log",
            port,
        )
        servers.append(forwarded)
        health = forwarded.wait_for_health()
        check(same(data_folder_of(forwarded), chosen), "--data-dir wins over MOSS_DATA_DIR")
        check(health.get("journal") == "second_game" and (chosen / "second_game.db").exists(), "--journal opens, and makes, that journal")
        check("Phone access is on" in forwarded.output(), "--lan turns phone access on at start")
        check(f"http://127.0.0.1:{port}" in forwarded.output(), "--port is the port it listens on")
        check(not from_env.exists(), "the folder from the variable was not used")
        check("in your browser" not in forwarded.output(), "--no-open stops it opening a browser")
        forwarded.stop()
        servers.remove(forwarded)

        if sys.platform == "darwin":
            # Without --no-open it tries to open a browser. With `open` off the PATH that fails, and
            # the server says so: the one place --no-open can be seen to matter without a browser.
            port = free_port()
            opening = Server([command, "--port", str(port), "--data-dir", str(chosen)], env, cwd, base / "opening.log", port)
            servers.append(opening)
            opening.wait_for_health()
            time.sleep(1)
            check(f"Open http://127.0.0.1:{port} in your browser" in opening.output(), "without --no-open it tries to open the browser")
            opening.stop()
            servers.remove(opening)

        port = free_port()
        relative = Server([command, "--no-open", "--port", str(port), "--data-dir", "relative-data"], env, cwd, base / "relative.log", port)
        servers.append(relative)
        relative.wait_for_health()
        check(same(data_folder_of(relative), cwd / "relative-data"), "a relative --data-dir is taken from where the command was run")
        relative.stop()
        servers.remove(relative)

        port = free_port()
        empty = Server([command, "--no-open", "--port", str(port)], {**env, "MOSS_DATA_DIR": ""}, cwd, base / "empty.log", port)
        servers.append(empty)
        empty.wait_for_health()
        check(same(data_folder_of(empty), default_data), "an empty MOSS_DATA_DIR means the default folder, not the current one")
        empty.stop()
        servers.remove(empty)

        port = free_port()
        dev = Server([command, "--no-open", "--port", str(port), "--data-dir", str(chosen)], {**env, "NODE_ENV": "development"}, cwd, base / "dev.log", port)
        servers.append(dev)
        dev.wait_for_health()
        check(dev.get("/")[0] == 200, "the app page is still served when NODE_ENV=development is set")
        dev.stop()
        servers.remove(dev)
        check(not any(cwd.iterdir()) or [p.name for p in cwd.iterdir()] == ["relative-data"], "nothing else was written to the working folder")

        step("Running it did not change the installed package; removing it keeps the journals")
        check(listing(site) == before, "no file was added to or changed in the installed package")
        uninstall = subprocess.run([str(venv_python), "-m", "pip", "uninstall", "-y", "mossnote"], capture_output=True, text=True)
        check(uninstall.returncode == 0, f"pip uninstall succeeds:\n{uninstall.stdout}{uninstall.stderr}")
        check((default_data / "smoke-test.db").exists() and (chosen / "second_game.db").exists(), "the journals are still there after uninstalling")

        if options.pipx:
            step("pipx run and pipx install")
            pipx_env = {**os.environ, "PIPX_HOME": str(base / "pipx-home"), "PIPX_BIN_DIR": str(base / "pipx-bin"), "PIPX_DEFAULT_PYTHON": sys.executable}
            pip_args = f"--find-links {wheel.parent}"
            out = subprocess.run([sys.executable, "-m", "pipx", "run", "--pip-args", pip_args, "mossnote", "--version"], env=pipx_env, capture_output=True, text=True, timeout=600)
            check(out.returncode == 0 and out.stdout.strip() == npm_version, f"pipx run mossnote --version prints {npm_version} (got {out.stdout.strip()!r} {out.stderr.strip()[-300:]!r})")
            out = subprocess.run([sys.executable, "-m", "pipx", "install", "--pip-args", pip_args, "mossnote"], env=pipx_env, capture_output=True, text=True, timeout=600)
            check(out.returncode == 0, f"pipx install mossnote succeeds:\n{out.stdout}{out.stderr}")
            installed = base / "pipx-bin" / ("mossnote.exe" if IS_WINDOWS else "mossnote")
            check(installed.exists(), "pipx puts mossnote on the PATH folder")
            out = subprocess.run([str(installed), "--version"], env=pipx_env, capture_output=True, text=True)
            check(out.stdout.strip() == npm_version, "the pipx-installed command prints the version")

        print(f"\nPython package check passed: {passed} checks, Python {sys.version.split()[0]}, {sys.platform}.")
        return 0
    except Failure as failure:
        print(f"\n{failure}", file=sys.stderr)
        return 1
    finally:
        for server in servers:
            server.stop("kill")
        time.sleep(0.3)
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
