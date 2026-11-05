/** Narrow database surface. Domain code uses only this, so fault injection can wrap it (wrapDb). */
export interface Stmt {
  run(...p: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
}
export interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  readonly inTransaction: boolean;
  close(): void;
}
export interface Clock {
  now(): number;
}
