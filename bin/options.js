// The command line of `mossnote`, parsed without starting anything. Plain JavaScript on purpose:
// `bin/mossnote.js` runs straight from the installed package, before anything has been compiled.

/** The oldest Node that works: the SQLite module needs Node-API 10, which arrived in Node 22.14. */
export const MIN_NODE = { major: 22, minor: 14 };

/** A mistake in the command line. The message is printed as is, and the exit code is 1. */
export class UsageError extends Error {}

/** True when `version` (such as `process.versions.node`) is new enough. */
export function nodeIsSupported(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

const JOURNAL_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** Options that take a value, and the environment variable each one sets. */
const VALUE_OPTIONS = {
  '--port': 'MOSS_PORT',
  '--data-dir': 'MOSS_DATA_DIR',
  '--journal': 'MOSS_JOURNAL',
};

/** Options that stand alone, and what each one sets. */
const SWITCHES = {
  '--no-open': ['MOSS_OPEN_BROWSER', '0'],
  '--lan': ['MOSS_LAN', '1'],
};

function check(flag, value) {
  if (flag === '--port') {
    const port = /^\d+$/.test(value) ? Number(value) : 0;
    if (port < 1 || port > 65_535) {
      throw new UsageError(`--port must be a whole number from 1 to 65535, got "${value}".`);
    }
  } else if (flag === '--journal' && !JOURNAL_PATTERN.test(value)) {
    throw new UsageError(
      `--journal must be 1 to 40 letters, digits, "-" or "_" (it becomes the file name), got "${value}".`,
    );
  } else if (flag === '--data-dir' && value.trim() === '') {
    throw new UsageError('--data-dir needs a folder.');
  }
}

/**
 * Turn the arguments after `node mossnote` into what to do: `{ help, version, env }`, where `env`
 * holds the environment variables the options stand for. Anything it does not know is an error,
 * so a typo such as `--prot 4000` is reported instead of quietly starting on the default port.
 * `--help` and `--version` win over every mistake.
 */
export function parseArgs(args) {
  /** @type {{ help: boolean, version: boolean, env: Record<string, string> }} */
  const result = { help: false, version: false, env: {} };
  const seen = new Set();
  let problem;
  const fail = (message) => {
    problem ??= new UsageError(message);
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      result.version = true;
      continue;
    }
    if (Object.hasOwn(SWITCHES, arg)) {
      const [name, value] = SWITCHES[arg];
      result.env[name] = value;
      continue;
    }

    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (Object.hasOwn(SWITCHES, flag)) {
      fail(`${flag} does not take a value.`);
      continue;
    }
    if (!Object.hasOwn(VALUE_OPTIONS, flag)) {
      fail(
        arg.startsWith('-')
          ? `Unknown option "${arg}". Run mossnote --help.`
          : `Unexpected argument "${arg}". Run mossnote --help.`,
      );
      continue;
    }

    let value;
    if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`${flag} needs a value. Run mossnote --help.`);
        continue;
      }
      index++;
    }
    if (seen.has(flag)) {
      fail(`${flag} was given more than once.`);
      continue;
    }
    seen.add(flag);
    try {
      check(flag, value);
      result.env[VALUE_OPTIONS[flag]] = value;
    } catch (error) {
      if (error instanceof UsageError) fail(error.message);
      else throw error;
    }
  }

  if (problem && !result.help && !result.version) throw problem;
  return result;
}

/** The text of `mossnote --help`. */
export function helpText(version, { program = false } = {}) {
  const runtime = program
    ? 'This program includes its own Node.js.'
    : 'Mossnote needs Node 22.14 or newer.';
  return `Mossnote ${version}
A private journal for the games you play. It runs on this computer only.

Usage: mossnote [options]

Options:
  --port <number>      Port to listen on, 1 to 65535 (default 4317; MOSS_PORT)
  --data-dir <folder>  Where journals are kept (MOSS_DATA_DIR)
  --journal <name>     Open this journal's file name at start (MOSS_JOURNAL)
  --no-open            Do not open the browser (MOSS_OPEN_BROWSER=0)
  --lan                Let paired phones and tablets on your network use it (MOSS_LAN=1)
  --version, -v        Print the version
  --help, -h           Print this help

Both forms work: --port 4000 and --port=4000. An option wins over its environment variable.
Press Ctrl+C to stop. ${runtime}

Your journals live in your user folder, never beside the program, so installing,
upgrading or reinstalling Mossnote never touches them. The default folder is
  macOS    ~/Library/Application Support/Mossnote
  Linux    ~/.local/share/mossnote   (or $XDG_DATA_HOME/mossnote)
  Windows  %APPDATA%\\Mossnote
The README lists every MOSS_* variable.`;
}
