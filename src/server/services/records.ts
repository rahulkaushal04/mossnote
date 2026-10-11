import type { CustomField } from '@shared/types';
import { conflict } from '../errors';
import type { Ctx } from './ctx';

/** `custom_fields` is TEXT holding a JSON array of `{label, value}`. */
export function parseFields(json: string): CustomField[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as CustomField[]) : [];
  } catch {
    return [];
  }
}

export const serializeFields = (fields: readonly CustomField[]): string => JSON.stringify(fields);

/** The 409 for a stale edit: the current record is returned so the client can offer a choice. */
export function assertFresh(
  expectedUpdatedAt: string | undefined,
  currentUpdatedAt: number,
  current: () => unknown,
  noun: string,
): void {
  if (expectedUpdatedAt !== undefined && Date.parse(expectedUpdatedAt) !== currentUpdatedAt) {
    throw conflict(`This ${noun} changed in another window.`, { current: current() });
  }
}

/** updatedAt always advances, so two saves in the same millisecond still conflict correctly. */
export const nextUpdatedAt = (ctx: Ctx, previous: number): number =>
  Math.max(ctx.clock.now(), previous + 1);

/** A create that reuses the id of a deleted record is refused, not answered as if it were live. */
export function refuseDeleted(existing: { deleted_at: number | null }, noun: string): void {
  if (existing.deleted_at !== null) {
    throw conflict(`That ${noun} was deleted. Restore it from Recently deleted.`);
  }
}
