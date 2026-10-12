// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { useGuardedSave } from './useGuardedSave';

interface Rec {
  text: string;
  other: string;
  updatedAt: string;
}

const rec = (text: string, at: number, other = 'o'): Rec => ({
  text,
  other,
  updatedAt: `2026-01-01T00:00:0${at}.000Z`,
});

const stale = (current: Rec) =>
  new ApiError(409, { code: 'conflict', message: 'stale', details: { current } });

afterEach(cleanup);

function setup(first: Rec, send: (value: string, expectedUpdatedAt: string) => Promise<Rec>) {
  return renderHook(() =>
    useGuardedSave<Rec, string>({
      record: first,
      read: (r) => ({ value: r.text, updatedAt: r.updatedAt }),
      send,
      message: 'Changed in another window.',
    }),
  );
}

describe('useGuardedSave', () => {
  it('sends the version the text was loaded with, then the version each save returned', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockResolvedValueOnce(rec('one', 2))
      .mockResolvedValueOnce(rec('two', 3));
    const { result } = setup(rec('zero', 1), send);

    await act(() => result.current.save(() => 'one'));
    await act(() => result.current.save(() => 'two'));

    expect(send.mock.calls).toEqual([
      ['one', rec('zero', 1).updatedAt],
      ['two', rec('one', 2).updatedAt],
    ]);
  });

  it('does not send when the text matches what is stored', async () => {
    const send = vi.fn<(v: string, at: string) => Promise<Rec>>();
    const { result } = setup(rec('same', 1), send);

    await act(() => result.current.save(() => 'same'));

    expect(send).not.toHaveBeenCalled();
  });

  it('runs saves one at a time, each reading the latest text when its turn comes', async () => {
    const resolvers: ((r: Rec) => void)[] = [];
    const send = vi.fn<(v: string, at: string) => Promise<Rec>>().mockImplementation(
      () =>
        new Promise<Rec>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    let text = 'a';
    const { result } = setup(rec('zero', 1), send);

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.save(() => text);
      text = 'ab';
      second = result.current.save(() => text);
    });
    await act(() => Promise.resolve());
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]?.(rec('a', 2));
      await first;
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(['ab', rec('a', 2).updatedAt]);
    await act(async () => {
      resolvers[1]?.(rec('ab', 3));
      await second;
    });
  });

  it('retries quietly when the record moved on but this field was not what changed', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValueOnce(stale(rec('zero', 5, 'changed elsewhere')))
      .mockResolvedValueOnce(rec('mine', 6, 'changed elsewhere'));
    const { result } = setup(rec('zero', 1), send);

    await act(() => result.current.save(() => 'mine'));

    expect(send.mock.calls[1]).toEqual(['mine', rec('zero', 5).updatedAt]);
    expect(result.current.conflict).toBeNull();
  });

  it('stops and offers a choice when the same field changed elsewhere', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValue(stale(rec('theirs', 5)));
    const { result } = setup(rec('zero', 1), send);

    await act(async () => {
      await expect(result.current.save(() => 'mine')).rejects.toThrow('Changed in another window.');
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toBe('theirs');
  });

  it('sends nothing while a conflict waits for an answer', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValue(stale(rec('theirs', 5)));
    const { result } = setup(rec('zero', 1), send);
    await act(async () => {
      await result.current.save(() => 'mine').catch(() => undefined);
    });

    await act(async () => {
      await expect(result.current.save(() => 'mine more')).rejects.toThrow();
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Reload hands back the other copy and saves from it afterwards', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValueOnce(stale(rec('theirs', 5)))
      .mockResolvedValueOnce(rec('theirs more', 6));
    const { result } = setup(rec('zero', 1), send);
    await act(async () => {
      await result.current.save(() => 'mine').catch(() => undefined);
    });

    let reloaded = '';
    act(() => {
      reloaded = result.current.reload() ?? '';
    });
    expect(reloaded).toBe('theirs');
    expect(result.current.conflict).toBeNull();

    await act(() => result.current.save(() => 'theirs more'));
    expect(send.mock.calls[1]).toEqual(['theirs more', rec('theirs', 5).updatedAt]);
  });

  it('Keep mine sends my text over the other copy', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValueOnce(stale(rec('theirs', 5)))
      .mockResolvedValueOnce(rec('mine', 6));
    const { result } = setup(rec('zero', 1), send);
    await act(async () => {
      await result.current.save(() => 'mine').catch(() => undefined);
    });

    act(() => {
      result.current.keepMine();
    });
    await act(() => result.current.save(() => 'mine'));

    expect(send.mock.calls[1]).toEqual(['mine', rec('theirs', 5).updatedAt]);
    expect(result.current.conflict).toBeNull();
  });

  it('passes other failures on untouched', async () => {
    const send = vi
      .fn<(v: string, at: string) => Promise<Rec>>()
      .mockRejectedValue(new ApiError(400, { code: 'validation_failed', message: 'Too long.' }));
    const { result } = setup(rec('zero', 1), send);

    await act(async () => {
      await expect(result.current.save(() => 'mine')).rejects.toThrow('Too long.');
    });
    expect(result.current.conflict).toBeNull();
  });
});
