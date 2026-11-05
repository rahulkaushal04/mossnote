// better-sqlite3 ships no types and adding @types needs lead approval; this covers only what core uses.
declare module 'better-sqlite3' {
  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
  }
  class Database {
    constructor(path: string | Buffer, options?: Options);
    prepare(sql: string): {
      run(...p: unknown[]): { changes: number; lastInsertRowid: number | bigint };
      get(...p: unknown[]): unknown;
      all(...p: unknown[]): unknown[];
      iterate(...p: unknown[]): IterableIterator<unknown>;
    };
    exec(sql: string): unknown;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    readonly inTransaction: boolean;
    serialize(): Buffer;
    close(): void;
  }
  export default Database;
}
