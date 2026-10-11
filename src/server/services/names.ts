import { fold } from '@shared/text';

/** Compares a name with what was typed ignoring case and accents, which SQLite's LIKE cannot do. */
export function foldedName(name: string): string {
  return fold(name);
}

export function matchesName(name: string, typed: string): boolean {
  return foldedName(name).includes(foldedName(typed));
}

export function startsWithName(name: string, typed: string): boolean {
  return foldedName(name).startsWith(foldedName(typed));
}

/** A to Z ignoring case and accents, so "Élise" sits among the E names. */
export const compareNames = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { sensitivity: 'base' });
