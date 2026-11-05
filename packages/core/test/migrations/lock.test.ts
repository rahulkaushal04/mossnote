import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../migrations/index.ts';
import { sha256 } from '../../src/db/hash.ts';

// Nothing has shipped yet, so 0001 was edited in core-store fix round 1 (indexes change_log(entity_id), note_tags(tag_id))
// and round 2 (PRAGMA application_id).
// 0002 (search) was added while nothing had shipped it. 0003 (attachments) likewise. Shipped migrations are immutable. If this fails you edited a shipped migration: add a new one instead.
const PINNED: Record<number, string> = {
  1: '04f284fe14df643a361f1571c8ecd8b4a5808df3b8248d8eb00d89d098547cfc',
  2: '46597c981179484e357c590d9f8dbc0e861a3523b80bebab7585f9d3ad77958d',
  3: '42f8579a7d366bd1e841974f8b848a235fb319ec1fcfa0820459f6732a83194d',
};

describe('shipped migrations are immutable', () => {
  it('every migration is pinned and matches its hash', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(Object.keys(PINNED).length).toBe(MIGRATIONS.length);
    for (const m of MIGRATIONS)
      expect(sha256(m.sql), `migration ${m.version}`).toBe(PINNED[m.version]);
  });
});
