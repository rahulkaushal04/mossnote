// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetJournalState, setCurrentJournal } from '../../../lib/journal';
import type { Doc } from './doc';
import {
  clearUnsaved,
  fitsExitRequest,
  readUnsaved,
  stashUnsaved,
  EXIT_REQUEST_BYTES,
} from './unsavedDrawing';

const doc: Doc = {
  scene: { v: 2, layers: [{ id: 'layer-1', name: 'Layer 1' }], shapes: [] },
  pins: [],
};

beforeEach(() => {
  setCurrentJournal('journal');
});

afterEach(() => {
  localStorage.clear();
  resetJournalState();
  vi.restoreAllMocks();
});

describe('unsaved drawing', () => {
  it('keeps a drawing for the next visit and hands it back with the updatedAt it was based on', () => {
    stashUnsaved('MAP', 'v1', doc);

    expect(readUnsaved('MAP')).toEqual({ updatedAt: 'v1', doc });
  });

  it('forgets a drawing once it is cleared', () => {
    stashUnsaved('MAP', 'v1', doc);

    clearUnsaved('MAP');

    expect(readUnsaved('MAP')).toBeNull();
  });

  it('keeps drawings of different maps and journals apart', () => {
    stashUnsaved('MAP', 'v1', doc);
    setCurrentJournal('other');

    expect(readUnsaved('MAP')).toBeNull();
  });

  it('ignores stored text that is not a drawing', () => {
    localStorage.setItem('moss:unsavedMap:journal:MAP', '{"updatedAt":"v1","doc":{"scene":1}}');

    expect(readUnsaved('MAP')).toBeNull();
  });

  it('reports that it could not keep a drawing when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(stashUnsaved('MAP', 'v1', doc)).toBe(false);
  });
});

describe('fitsExitRequest', () => {
  it('accepts a small body and refuses one a keepalive request could not carry', () => {
    expect(fitsExitRequest({ a: 'x' })).toBe(true);
    expect(fitsExitRequest({ a: 'x'.repeat(EXIT_REQUEST_BYTES) })).toBe(false);
  });

  it('counts bytes, not characters', () => {
    expect(fitsExitRequest({ a: '日'.repeat(EXIT_REQUEST_BYTES / 3) })).toBe(false);
  });
});
