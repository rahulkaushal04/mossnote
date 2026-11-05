import m0001 from './0001-init.ts';
import m0002 from './0002-search.ts';
import m0003 from './0003-attachments.ts';
import type { Migration } from './types.ts';

export type { Migration } from './types.ts';
/** Contiguous 1..N. Forward-only. */
export const MIGRATIONS: readonly Migration[] = [m0001, m0002, m0003];
