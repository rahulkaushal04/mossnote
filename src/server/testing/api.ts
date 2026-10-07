import { ulid } from 'ulid';
import type { ApiErrorBody } from '@shared/errors';
import type { Note, NoteDetail, Page, Person, Planting, Tag } from '@shared/types';
import { expect } from 'vitest';
import type { TestApp } from './app';

/** Small typed helpers over the test app. Every call is a real request through the guard. */
export class Api {
  constructor(readonly t: TestApp) {}

  async json<T>(res: Response, status = 200): Promise<T> {
    expect(res.status, await res.clone().text()).toBe(status);
    return (await res.json()) as T;
  }

  async error(res: Response, status: number): Promise<ApiErrorBody['error']> {
    expect(res.status, await res.clone().text()).toBe(status);
    return ((await res.json()) as ApiErrorBody).error;
  }

  /** Advance the fake clock so records get distinct creation times. */
  tick(ms = 1000): void {
    this.t.clock.advance(ms);
  }

  async note(body: Record<string, unknown>): Promise<Note> {
    this.tick();
    return this.json<Note>(await this.t.call('POST', '/api/notes', body), 201);
  }
  async getNote(id: string): Promise<NoteDetail> {
    return this.json<NoteDetail>(await this.t.call('GET', `/api/notes/${id}`));
  }
  async patchNote(id: string, body: Record<string, unknown>): Promise<Note> {
    this.tick();
    return this.json<Note>(await this.t.call('PATCH', `/api/notes/${id}`, body));
  }
  async notes(query = ''): Promise<Page<Note>> {
    return this.json<Page<Note>>(await this.t.call('GET', `/api/notes${query}`));
  }
  async person(body: Record<string, unknown>): Promise<Person> {
    this.tick();
    return this.json<Person>(await this.t.call('POST', '/api/people', body), 201);
  }
  async planting(body: Record<string, unknown>): Promise<Planting> {
    this.tick();
    return this.json<Planting>(await this.t.call('POST', '/api/plantings', body), 201);
  }
  async tags(): Promise<Tag[]> {
    return this.json<Tag[]>(await this.t.call('GET', '/api/tags'));
  }

  /** Index rows must equal the live records exactly. */
  expectIndexConsistent(): void {
    const sqlite = this.t.database.sqlite;
    const ids = (sql: string) =>
      (sqlite.prepare(sql).all() as { id: string }[]).map((r) => r.id).sort();
    for (const [kind, table] of [
      ['note', 'notes'],
      ['person', 'people'],
      ['planting', 'plantings'],
    ] as const) {
      const indexed = ids(`SELECT ref_id AS id FROM search_fts WHERE kind = '${kind}'`);
      const live = ids(`SELECT id FROM ${table} WHERE deleted_at IS NULL`);
      expect(indexed, `${kind} index rows`).toEqual(live);
    }
  }

  /** Records with no parent: join and link rows must never point at a missing row. */
  expectNoOrphans(): void {
    const sqlite = this.t.database.sqlite;
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  }
}

export const newId = (): string => ulid();
