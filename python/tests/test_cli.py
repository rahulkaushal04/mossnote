"""The launcher, tested with a stand-in app that prints the arguments it receives."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"

FAKE_APP = """
const args = process.argv.slice(2);
if (args.includes('--exit')) process.exit(Number(args[args.indexOf('--exit') + 1]));
if (args.includes('--wait')) {
  process.on('SIGINT', () => { console.log('stopped by SIGINT'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('stopped by SIGTERM'); process.exit(0); });
  console.log('ready');
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({ args, node: process.versions.node, execPath: process.execPath }));
}
"""


@pytest.fixture()
def app(tmp_path: Path) -> Path:
    folder = tmp_path / "_app"
    (folder / "bin").mkdir(parents=True)
    (folder / "bin" / "mossnote.js").write_text(FAKE_APP, encoding="utf-8")
    return folder


def launch(app_dir: Path | None, arguments: list[str], *, wait: bool = False):
    code = textwrap.dedent(
        f"""
        import sys
        from pathlib import Path
        import mossnote.cli as cli
        {"cli.APP_DIR = Path(sys.argv[1])" if app_dir is not None else ""}
        raise SystemExit(cli.main(sys.argv[2:]))
        """
    )
    command = [sys.executable, "-c", code, str(app_dir or ""), *arguments]
    env = {**os.environ, "PYTHONPATH": str(SRC)}
    if wait:
        return subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)


def test_every_argument_reaches_the_app_in_order_untouched(app: Path) -> None:
    arguments = ["--port", "4400", "--data-dir", "C:\\Users\\A B\\Journals", "--journal", "my_game", "--no-open", "--lan", "--port=1", "two words", "--"]
    result = launch(app, arguments)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["args"] == arguments


def test_it_runs_the_node_that_comes_with_the_package(app: Path) -> None:
    from nodejs_wheel import executable

    result = launch(app, [])
    reported = json.loads(result.stdout)
    root = Path(executable.ROOT_DIR)
    assert Path(reported["execPath"]).resolve().parent in (root.resolve(), (root / "bin").resolve())
    major, minor = (int(part) for part in reported["node"].split(".")[:2])
    assert (major, minor) >= (22, 14)


@pytest.mark.parametrize("code", [0, 1, 2, 42])
def test_the_exit_code_of_the_app_is_the_exit_code_of_the_command(app: Path, code: int) -> None:
    assert launch(app, ["--exit", str(code)]).returncode == code


def test_a_missing_app_is_reported_plainly_and_exits_1(tmp_path: Path) -> None:
    result = launch(tmp_path / "nothing-here", ["--version"])
    assert result.returncode == 1
    assert "has no app inside it" in result.stderr
    assert "pip install mossnote" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.skipif(os.name == "nt", reason="Windows has no signal a Node program can catch")
@pytest.mark.parametrize(("sent", "expected"), [(signal.SIGINT, "SIGINT"), (signal.SIGTERM, "SIGTERM")])
def test_ctrl_c_and_a_stop_reach_the_app_and_end_cleanly(app: Path, sent: int, expected: str) -> None:
    process = launch(app, ["--wait"], wait=True)
    assert process.stdout is not None
    assert process.stdout.readline().strip() == "ready"
    process.send_signal(sent)
    out, _ = process.communicate(timeout=20)
    assert process.returncode == 0
    assert f"stopped by {expected}" in out


class FakeProcess:

    def __init__(self, *outcomes: object) -> None:
        self.outcomes = list(outcomes)
        self.killed = False

    def wait(self, timeout: float | None = None) -> int:
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return int(outcome)  # type: ignore[arg-type]

    def kill(self) -> None:
        self.killed = True
        self.outcomes = [137]


def test_ctrl_c_gives_the_app_time_to_stop_and_passes_its_exit_code_on() -> None:
    from mossnote import cli

    process = FakeProcess(KeyboardInterrupt(), 0)
    assert cli._wait(process) == 0  # type: ignore[arg-type]
    assert not process.killed


def test_an_app_that_does_not_stop_is_ended_by_force_and_a_second_ctrl_c_does_not_wait() -> None:
    from mossnote import cli

    stuck = FakeProcess(KeyboardInterrupt(), subprocess.TimeoutExpired("node", 15))
    assert cli._wait(stuck) == 137  # type: ignore[arg-type]
    assert stuck.killed

    impatient = FakeProcess(KeyboardInterrupt(), KeyboardInterrupt())
    assert cli._wait(impatient) == 137  # type: ignore[arg-type]
    assert impatient.killed


def test_the_version_is_known_once_installed() -> None:
    import mossnote

    assert isinstance(mossnote.__version__, str) and mossnote.__version__
