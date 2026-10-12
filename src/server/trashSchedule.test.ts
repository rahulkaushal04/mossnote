import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';
import { scheduleTrashPurge, TRASH_PURGE_INTERVAL_MS } from './trashSchedule';

const HOUR = 3_600_000;
let lines: string[];
const logger = () => createLogger('debug', (line) => lines.push(line));

beforeEach(() => {
  vi.useFakeTimers();
  lines = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('purging Recently deleted while the server stays up', () => {
  it('checks every hour, and not at once, since opening a journal has just done it', async () => {
    const purge = vi.fn().mockResolvedValue(0);
    const stop = scheduleTrashPurge(purge, logger());

    expect(TRASH_PURGE_INTERVAL_MS).toBe(HOUR);
    expect(purge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(purge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(purge).toHaveBeenCalledTimes(4);
    stop();
  });

  it('says how many records it removed, and nothing when there were none', async () => {
    const purge = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const stop = scheduleTrashPurge(purge, logger());

    await vi.advanceTimersByTimeAsync(2 * HOUR);

    expect(lines).toEqual(['info purged old deleted records count=3']);
    stop();
  });

  it('keeps going after a failure, and says only what kind of failure it was', async () => {
    const failure = Object.assign(new Error('note text that must stay out of the log'), {
      name: 'SqliteError',
      code: 'SQLITE_BUSY',
    });
    const purge = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(2);
    const stop = scheduleTrashPurge(purge, logger());

    await vi.advanceTimersByTimeAsync(2 * HOUR);

    expect(purge).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      'error could not purge old deleted records kind=SqliteError errorCode=SQLITE_BUSY',
      'info purged old deleted records count=2',
    ]);
    stop();
  });

  it('does not start a run while the last one is still going', async () => {
    let finish: (count: number) => void = () => undefined;
    const purge = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = scheduleTrashPurge(purge, logger());

    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(purge).toHaveBeenCalledTimes(1);
    finish(0);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(purge).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops when told to, and does not keep the process alive', async () => {
    const purge = vi.fn().mockResolvedValue(0);
    const unref = vi.fn();
    const timers = {
      setInterval: (run: () => void, ms: number) => {
        const handle = setInterval(run, ms);
        const original = handle.unref.bind(handle);
        handle.unref = () => {
          unref();
          return original();
        };
        return handle;
      },
      clearInterval,
    };
    const stop = scheduleTrashPurge(purge, logger(), TRASH_PURGE_INTERVAL_MS, timers);
    expect(unref).toHaveBeenCalledOnce();

    stop();
    await vi.advanceTimersByTimeAsync(5 * HOUR);

    expect(purge).not.toHaveBeenCalled();
  });
});
