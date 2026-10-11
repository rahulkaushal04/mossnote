# Mossnote

A private journal for the games you play, with no spoilers. Write down what you find out, in your own words. Mossnote keeps your notes in order and never sends them anywhere.

This package runs Mossnote on your computer. **You do not need Node.js**: the package brings the one it needs.

> Mossnote is in beta (`0.1.0b1`).

## Install and run

The best way to install it is [pipx](https://pipx.pypa.io), which keeps it apart from your other Python programs:

```bash
pipx install --pre mossnote
mossnote
```

To try it without installing, or to use plain pip:

```bash
pipx run --pre mossnote
pip install --pre mossnote
```

`--pre` is needed because this is a beta: pip and pipx skip beta versions unless you ask. Once there is a stable release, plain `pipx install mossnote` is enough.

`mossnote` starts the app and opens your browser at `http://127.0.0.1:4317`. Press Ctrl+C to stop it.

## Options

| Option                | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `--port <number>`     | Port to listen on, 1 to 65535. Default 4317          |
| `--data-dir <folder>` | Where journals are kept                              |
| `--journal <name>`    | Open this journal at start                           |
| `--no-open`           | Do not open the browser                              |
| `--lan`               | Let paired phones and tablets on your network use it |
| `--version`, `-v`     | Print the version                                    |
| `--help`, `-h`        | Print the options                                    |

`mossnote --version` prints `0.1.0-beta.1`, which is the same release that pip calls `0.1.0b1`.

## Your journals

Journals are files in your user folder, never inside the package, so updating or removing Mossnote does not touch them:

| System  | Default folder                            |
| ------- | ----------------------------------------- |
| macOS   | `~/Library/Application Support/Mossnote/` |
| Linux   | `~/.local/share/mossnote/`                |
| Windows | `%APPDATA%\Mossnote\`                     |

The files are not encrypted. Settings, then Data & backup, shows the exact folder.

## Requirements

- Python 3.10 or newer.
- Windows, macOS or Linux, on x64 or arm64. On Linux with glibc it needs glibc 2.34 or newer (Ubuntu 22.04, Debian 12, RHEL 9 or newer), or a musl system such as Alpine.
- About 250 MB of disk space once installed and a download of about 70 MB: Mossnote is about 32 MB, and the Node.js it uses is the rest.

## Troubleshooting

- **Port already in use.** Start on another with `mossnote --port 4400`.
- **"Already running".** Only one copy can have a journal open. Use the one that is running, or stop it first.
- **A beta is not found.** Add `--pre`, or name the version: `pip install mossnote==0.1.0b1`.
- **Closing a Windows terminal window or pressing Ctrl+C stops Mossnote.** Ending only the `mossnote.exe` process in Task Manager can leave the server running; end `node.exe` too.

More: the [documentation](https://rahulkaushal04.github.io/mossnote/docs/) and the [source](https://github.com/rahulkaushal04/mossnote). MIT licence.
