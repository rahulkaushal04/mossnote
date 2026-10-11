"""The `mossnote` command: runs the packaged app with the bundled Node.js.

Every argument goes to the same `bin/mossnote.js` the npm package runs.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Sequence

APP_DIR = Path(__file__).resolve().parent / "_app"
STOP_TIMEOUT_SECONDS = 15


class LauncherError(Exception):
    """Mossnote cannot be started. The message is printed as it is."""


def node_executable() -> Path:
    try:
        from nodejs_wheel import executable
    except ImportError as error:  # pragma: no cover - pip installs the dependency
        raise LauncherError(
            "Mossnote needs the nodejs-wheel-binaries package, which is missing. "
            "Reinstall it with: pip install --force-reinstall mossnote"
        ) from error
    root = Path(executable.ROOT_DIR)
    node = root / "node.exe" if os.name == "nt" else root / "bin" / "node"
    if not node.is_file():
        raise LauncherError(
            f"The Node.js program that nodejs-wheel-binaries should provide is missing ({node}). "
            "Reinstall it with: pip install --force-reinstall nodejs-wheel-binaries"
        )
    return node


def command(arguments: Sequence[str]) -> list[str]:
    entry = APP_DIR / "bin" / "mossnote.js"
    if not entry.is_file():
        raise LauncherError(
            "This copy of Mossnote has no app inside it. Install it from PyPI "
            "(pip install mossnote) rather than from a source checkout."
        )
    return [str(node_executable()), str(entry), *arguments]


def _wait(process: subprocess.Popen[bytes]) -> int:
    # Ctrl+C reaches the app too: give it time to stop cleanly.
    while True:
        try:
            return process.wait()
        except KeyboardInterrupt:
            try:
                return process.wait(timeout=STOP_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                process.kill()
                return process.wait()
            except KeyboardInterrupt:
                process.kill()
                return process.wait()


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    try:
        line = command(arguments)
    except LauncherError as error:
        sys.stderr.write(f"{error}\n")
        return 1

    sys.stdout.flush()
    sys.stderr.flush()
    if os.name != "nt":
        # Replace this process, so signals and the exit code belong to the app.
        try:
            os.execv(line[0], line)
        except OSError as error:
            sys.stderr.write(f"Mossnote could not start {line[0]}: {error}\n")
            return 1
    # Windows cannot replace a process (os.execv returns the prompt at once).
    return _wait(subprocess.Popen(line))
