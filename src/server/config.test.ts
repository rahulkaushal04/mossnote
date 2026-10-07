import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, isLoopbackHost, loadConfig } from './config';

const base = { MOSS_DATA_DIR: '/tmp/moss-config-test' };

describe('loadConfig', () => {
  it('uses the documented defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 4317,
      journal: 'journal',
      backupKeep: 14,
      openBrowser: true,
      logLevel: 'info',
      allowRemote: false,
      dev: false,
    });
  });

  it('derives every path from the data folder and journal name', () => {
    const config = loadConfig({ ...base, MOSS_JOURNAL: 'second-run' });
    expect(config.dbPath).toBe(path.join('/tmp/moss-config-test', 'second-run.db'));
    expect(config.lockPath).toBe(path.join('/tmp/moss-config-test', 'second-run.lock'));
    expect(config.backupsDir).toBe(path.join('/tmp/moss-config-test', 'backups'));
  });

  it('resolves the default data folder from the platform', () => {
    const config = loadConfig({});
    if (process.platform === 'darwin') {
      expect(config.dataDir).toMatch(/Library\/Application Support\/Mossnote$/);
    } else if (process.platform === 'linux') {
      expect(config.dataDir).toMatch(/mossnote$/);
    }
    expect(path.isAbsolute(config.dataDir)).toBe(true);
  });

  it('reads overrides', () => {
    const config = loadConfig({
      ...base,
      MOSS_PORT: '5000',
      MOSS_BACKUP_KEEP: '3',
      MOSS_OPEN_BROWSER: '0',
      MOSS_LOG_LEVEL: 'debug',
      NODE_ENV: 'development',
    });
    expect(config).toMatchObject({
      port: 5000,
      backupKeep: 3,
      openBrowser: false,
      logLevel: 'debug',
      dev: true,
    });
  });

  it('refuses a non-loopback host unless MOSS_ALLOW_REMOTE=1', () => {
    expect(() => loadConfig({ ...base, MOSS_HOST: '0.0.0.0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_HOST: '192.168.1.5' })).toThrow(/loopback/);
    expect(loadConfig({ ...base, MOSS_HOST: '0.0.0.0', MOSS_ALLOW_REMOTE: '1' }).allowRemote).toBe(
      true,
    );
  });

  it('accepts loopback hosts', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
      expect(loadConfig({ ...base, MOSS_HOST: host }).host).toBe(host);
    }
    expect(isLoopbackHost('example.com')).toBe(false);
  });

  it('validates MOSS_JOURNAL against the path-safe pattern', () => {
    for (const bad of ['../x', 'a/b', 'a b', '', 'a.b', 'x'.repeat(41)]) {
      expect(() => loadConfig({ ...base, MOSS_JOURNAL: bad })).toThrow(ConfigError);
    }
    expect(loadConfig({ ...base, MOSS_JOURNAL: 'My_journal-2' }).journal).toBe('My_journal-2');
  });

  it('validates numbers and flags', () => {
    expect(() => loadConfig({ ...base, MOSS_PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_BACKUP_KEEP: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_OPEN_BROWSER: 'yes' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MOSS_LOG_LEVEL: 'loud' })).toThrow(ConfigError);
  });
});
