import { describe, expect, it } from 'vitest';
import { JOURNAL_PATTERN } from '../../src/shared/journalId';
import { helpText, MIN_NODE, nodeIsSupported, parseArgs, UsageError } from '../../bin/options.js';

describe('parseArgs', () => {
  it('turns every option into the environment variable it stands for', () => {
    const parsed = parseArgs([
      '--port',
      '4000',
      '--data-dir',
      '/tmp/journals',
      '--journal',
      'my_game-2',
      '--no-open',
      '--lan',
    ]);
    expect(parsed).toEqual({
      help: false,
      version: false,
      env: {
        MOSS_PORT: '4000',
        MOSS_DATA_DIR: '/tmp/journals',
        MOSS_JOURNAL: 'my_game-2',
        MOSS_OPEN_BROWSER: '0',
        MOSS_LAN: '1',
      },
    });
  });

  it('accepts --option=value as well as --option value', () => {
    expect(parseArgs(['--port=4000', '--data-dir=C:\\Users\\me\\Journals']).env).toEqual({
      MOSS_PORT: '4000',
      MOSS_DATA_DIR: 'C:\\Users\\me\\Journals',
    });
    // The value may itself contain an equals sign.
    expect(parseArgs(['--data-dir=/tmp/a=b']).env.MOSS_DATA_DIR).toBe('/tmp/a=b');
  });

  it('starts with nothing set when there are no arguments', () => {
    expect(parseArgs([])).toEqual({ help: false, version: false, env: {} });
  });

  it('reports an option it does not know, instead of starting on the default port', () => {
    expect(() => parseArgs(['--prot', '4000'])).toThrow('Unknown option "--prot"');
    expect(() => parseArgs(['--no-opne'])).toThrow('Unknown option "--no-opne"');
    expect(() => parseArgs(['-x'])).toThrow('Unknown option "-x"');
    expect(() => parseArgs(['--prot=4000'])).toThrow('Unknown option "--prot=4000"');
  });

  it('reports a stray word', () => {
    expect(() => parseArgs(['start'])).toThrow('Unexpected argument "start"');
  });

  it('names the option, not an environment variable, when a value is wrong', () => {
    for (const bad of ['abc', '0', '70000', '-1', '4000.5', '', '1e3']) {
      expect(() => parseArgs(['--port', bad])).toThrow(
        /^--port must be a whole number from 1 to 65535/,
      );
    }
    expect(parseArgs(['--port', '1']).env.MOSS_PORT).toBe('1');
    expect(parseArgs(['--port', '65535']).env.MOSS_PORT).toBe('65535');
    expect(() => parseArgs(['--journal', 'bad name'])).toThrow(/^--journal must be/);
    expect(() => parseArgs(['--journal', 'x'.repeat(41)])).toThrow(/^--journal must be/);
    expect(() => parseArgs(['--data-dir='])).toThrow('--data-dir needs a folder.');
  });

  it('says so when an option that needs a value has none', () => {
    expect(() => parseArgs(['--data-dir'])).toThrow('--data-dir needs a value');
    expect(() => parseArgs(['--port', '--no-open'])).toThrow('--port needs a value');
  });

  it('refuses a value for an option that does not take one', () => {
    expect(() => parseArgs(['--lan=1'])).toThrow('--lan does not take a value.');
    expect(() => parseArgs(['--no-open=yes'])).toThrow('--no-open does not take a value.');
  });

  it('refuses an option given twice', () => {
    expect(() => parseArgs(['--port', '1', '--port=2'])).toThrow(
      '--port was given more than once.',
    );
  });

  it('lets --help and --version win over a mistake, and says which was asked for', () => {
    expect(parseArgs(['--bogus', '--help']).help).toBe(true);
    expect(parseArgs(['-v', '--port', 'abc']).version).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('uses the same journal rule as the server', () => {
    for (const name of [
      'journal',
      'a',
      'A_b-9',
      'x'.repeat(40),
      'x'.repeat(41),
      'a b',
      'a.b',
      '../x',
    ]) {
      let accepted = true;
      try {
        parseArgs(['--journal', name]);
      } catch (error) {
        expect(error).toBeInstanceOf(UsageError);
        accepted = false;
      }
      expect(accepted, name).toBe(JOURNAL_PATTERN.test(name));
    }
  });
});

describe('nodeIsSupported', () => {
  it('needs Node 22.14, the first with the Node-API version the SQLite module is built for', () => {
    expect(MIN_NODE).toEqual({ major: 22, minor: 14 });
    for (const version of [
      '22.14.0',
      '22.14.1',
      '22.23.3',
      '24.0.0',
      '24.21.0',
      '26.11.1',
      '30.0.0',
    ]) {
      expect(nodeIsSupported(version), version).toBe(true);
    }
    for (const version of ['20.20.2', '21.7.3', '22.0.0', '22.12.0', '22.13.1', '18.0.0']) {
      expect(nodeIsSupported(version), version).toBe(false);
    }
  });
});

describe('helpText', () => {
  it('names the version, every option, and where journals live', () => {
    const text = helpText('1.2.3-beta.4');
    expect(text).toContain('Mossnote 1.2.3-beta.4');
    for (const option of [
      '--port',
      '--data-dir',
      '--journal',
      '--no-open',
      '--lan',
      '--version',
      '--help',
    ]) {
      expect(text).toContain(option);
    }
    expect(text).toContain('Application Support/Mossnote');
    expect(text).toContain('.local/share/mossnote');
    expect(text).toContain('%APPDATA%\\Mossnote');
    expect(text).toContain('Node 22.14');
    const program = helpText('1.2.3', { program: true });
    expect(program).toContain('includes its own Node.js');
    expect(program).not.toContain('Node 22.14');
  });
});
