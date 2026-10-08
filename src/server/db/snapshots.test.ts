import { describe, expect, it } from 'vitest';
import {
  journalOfSnapshotName,
  nextSnapshotSequence,
  parseSnapshotName,
  snapshotName,
  snapshotsToPrune,
  sortSnapshots,
  type Snapshot,
} from './snapshots';

const at = (hour: number, minute = 0) => new Date(2026, 9, 7, hour, minute).getTime();

const snap = (
  journal: string,
  time: number,
  reason: Snapshot['reason'],
  sequence = 1,
): Snapshot => {
  const name = snapshotName(journal, time, reason, sequence);
  return { name, path: `/b/${name}`, reason, takenAt: at(0) + (time - at(0)), size: 1 };
};

describe('snapshot names', () => {
  it('read back into their parts', () => {
    const name = snapshotName('my-game', at(9, 5), 'manual', 2);

    expect(name).toBe('my-game-20261007-0905-2-manual.db');
    expect(parseSnapshotName('my-game', name)).toEqual({
      reason: 'manual',
      takenAt: at(9, 5),
      sequence: 2,
    });
  });

  it('are not read for another journal, even one whose name starts the same', () => {
    const name = snapshotName('game-2', at(9), 'auto');

    expect(parseSnapshotName('game', name)).toBeNull();
    expect(journalOfSnapshotName(name)).toBe('game-2');
  });

  it('give no journal for a name that is not a snapshot', () => {
    expect(journalOfSnapshotName('notes.txt')).toBeNull();
  });
});

describe('snapshot order and numbering', () => {
  it('sorts oldest first, and by sequence within a minute', () => {
    const later = snap('j', at(10), 'auto');
    const second = snap('j', at(9), 'auto', 2);
    const first = snap('j', at(9), 'auto', 1);

    expect(sortSnapshots('j', [later, second, first]).map((s) => s.name)).toEqual([
      first.name,
      second.name,
      later.name,
    ]);
  });

  it('numbers a snapshot after the highest in its minute, even after pruning', () => {
    const existing = [snap('j', at(9), 'manual', 3)];

    expect(nextSnapshotSequence('j', existing, 'manual', at(9))).toBe(4);
    expect(nextSnapshotSequence('j', existing, 'auto', at(9))).toBe(1);
    expect(nextSnapshotSequence('j', existing, 'manual', at(10))).toBe(1);
  });
});

describe('pruning', () => {
  it('keeps the newest of each reason and never prunes manual snapshots', () => {
    const autos = [8, 9, 10].map((hour) => snap('j', at(hour), 'auto'));
    const manuals = [8, 9, 10].map((hour) => snap('j', at(hour), 'manual'));

    const doomed = snapshotsToPrune([...autos, ...manuals], 2);

    expect(doomed.map((s) => s.name)).toEqual([autos[0]?.name]);
  });
});
