import { z } from 'zod';

const id = z.string().min(1).max(64);
const ms = z.number().int().min(0).max(8_640_000_000_000_000);

export const scopeSchema = z
  .object({ kind: z.enum(['all', 'trash', 'favorites', 'tag', 'folder']), id: id.optional() })
  .strict()
  .refine((s) => (s.kind === 'tag' || s.kind === 'folder' ? s.id !== undefined : true), {
    message: 'scope.id is required for tag and folder scopes',
  });

export const filtersSchema = z
  .object({
    tagIds: z.array(id).max(20).optional(),
    folderIds: z.array(id).max(20).optional(),
    createdFrom: ms.optional(),
    createdTo: ms.optional(),
    updatedFrom: ms.optional(),
    updatedTo: ms.optional(),
    favorite: z.boolean().optional(),
  })
  .strict();

export const MAX_QUERY = 1000;

/** What a saved search stores: everything but paging. */
export const specSchema = z
  .object({
    query: z.string().max(MAX_QUERY),
    scope: scopeSchema.optional(),
    filters: filtersSchema.optional(),
    sort: z.enum(['relevance', 'updated', 'created', 'title']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

/** A stored spec read back: tolerates (and keeps) keys a newer version added, so such an entry still lists. */
export const storedSpecSchema = z
  .object({
    query: z.string().max(MAX_QUERY),
    scope: scopeSchema.optional(),
    filters: filtersSchema.loose().optional(),
    sort: z.enum(['relevance', 'updated', 'created', 'title']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .loose();

export const searchParamsSchema = z
  .object({
    query: z.string().max(MAX_QUERY),
    scope: scopeSchema.optional(),
    filters: filtersSchema.optional(),
    sort: z.enum(['relevance', 'updated', 'created', 'title']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(2000).optional(),
  })
  .strict();

export type SearchSpec = z.infer<typeof specSchema>;
export type SearchParams = z.input<typeof searchParamsSchema>;
export type SearchSort = NonNullable<SearchSpec['sort']>;

export interface Marked {
  text: string;
  /** [start, end) UTF-16 offsets into `text`. */
  ranges: Array<[number, number]>;
}
export interface SearchHit {
  noteId: string;
  title: Marked;
  snippet: Marked;
  updatedAt: number;
  createdAt: number;
  folderId: string | null;
  favorite: boolean;
  trashed: boolean;
}
export interface SearchPage {
  state: 'ready' | 'rebuilding' | 'error';
  progress?: { done: number; total: number };
  hits: SearchHit[];
  nextCursor?: string;
  messages: string[];
}
