import { hc } from 'hono/client';
import type { AppType } from '@server/app';
import { currentJournalId, markJournalChanged } from './journal';
import type { ApiErrorBody, ErrorCode } from '@shared/errors';
import type { NoteCreate, NotePatch } from '@shared/schemas/note';
import type { PersonCreate, PersonPatch } from '@shared/schemas/person';
import type { PlantingCreate, PlantingPatch } from '@shared/schemas/planting';
import type { MapChanges, MapCreate, MapPatch, PinCreate, PinPatch } from '@shared/schemas/map';
import type { JournalCreate, JournalDelete } from '@shared/schemas/journal';
import type { Settings, SettingsPatch } from '@shared/schemas/settings';
import type {
  BackupInfo,
  DataInfo,
  ImportSummary,
  JournalInfo,
  JournalList,
  MapDetail,
  MapPin,
  MapSummary,
  MapVersionInfo,
  Note,
  NoteDetail,
  Page,
  PairingCode,
  Person,
  PhoneStatus,
  PickItem,
  PinRef,
  Planting,
  SearchResponse,
  Tag,
  TrashItem,
} from '@shared/types';

/** The server could not be reached at all (stopped, or the network call failed). */
export class NetworkError extends Error {
  constructor() {
    super("Can't reach your journal.");
    this.name = 'NetworkError';
  }
}

/** The server answered with the JSON error shape. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
    this.details = body.details;
  }
}

/**
 * How requests reach the journal. By default the browser's own `fetch`, which talks to the
 * server. The standalone build replaces it with one that asks the worker holding the journal.
 */
let transport: typeof fetch | null = null;

export function setApiTransport(next: typeof fetch | null): void {
  transport = next;
}

const send = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  (transport ?? fetch)(input, init);

/**
 * The only module that knows about HTTP. Every request carries the
 * `X-Moss-Client` header the server's guard requires. A desktop wrapper replaces this file.
 */
const client = hc<AppType>('/', {
  // Every non-GET request needs both headers, including the ones with
  // no body (delete, restore, back up now). `X-Moss-Journal` names the journal this window shows,
  // so a window left on another journal cannot write into the one that is open now.
  headers: () => ({
    'X-Moss-Client': 'web',
    'Content-Type': 'application/json',
    ...journalHeader(),
  }),
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await send(input, init);
    } catch {
      throw new NetworkError();
    }
  },
});

function journalHeader(): Record<string, string> {
  const id = currentJournalId();
  return id === null ? {} : { 'X-Moss-Journal': id };
}

async function failure(response: Response): Promise<never> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = undefined;
  }
  if (body?.error.details?.reason === 'journal_changed') markJournalChanged();
  throw new ApiError(
    response.status,
    body?.error ?? { code: 'internal', message: 'Something went wrong.' },
  );
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  return failure(response);
}

async function unwrapEmpty(response: Response): Promise<void> {
  if (!response.ok) await failure(response);
}

export interface Health {
  ok: true;
  version: string;
  schemaVersion: number;
  /** The id of the open journal, or null on a first run. */
  journal: string | null;
}

export interface NoteFilters {
  flag?: 'discovery' | 'question';
  state?: 'open' | 'solved';
  tag?: string[];
  person?: string;
  planting?: string;
  gameDate?: number;
  from?: number;
  to?: number;
  createdFrom?: number;
  createdTo?: number;
  undated?: boolean;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

/** Query strings: repeated `tag`, booleans as `1`, undefined values dropped. */
function toQuery(filters: NoteFilters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (filters.flag) out.flag = filters.flag;
  if (filters.state) out.state = filters.state;
  if (filters.tag && filters.tag.length > 0) out.tag = filters.tag;
  if (filters.person) out.person = filters.person;
  if (filters.planting) out.planting = filters.planting;
  if (filters.gameDate !== undefined) out.gameDate = String(filters.gameDate);
  if (filters.from !== undefined) out.from = String(filters.from);
  if (filters.to !== undefined) out.to = String(filters.to);
  if (filters.createdFrom !== undefined) out.createdFrom = String(filters.createdFrom);
  if (filters.createdTo !== undefined) out.createdTo = String(filters.createdTo);
  if (filters.undated) out.undated = '1';
  if (filters.order) out.order = filters.order;
  if (filters.limit !== undefined) out.limit = String(filters.limit);
  if (filters.cursor) out.cursor = filters.cursor;
  return out;
}

const withBody = <T>(json: T) => ({ json });

export const api = {
  getHealth: async () => unwrap<Health>(await client.api.health.$get()),

  // journals
  listJournals: async () => unwrap<JournalList>(await client.api.journals.$get()),
  createJournal: async (input: JournalCreate) =>
    unwrap<JournalInfo>(await client.api.journals.$post(withBody(input))),
  activateJournal: async (id: string) =>
    unwrap<JournalInfo>(await client.api.journals[':id'].activate.$post({ param: { id } })),
  renameJournal: async (id: string, name: string) =>
    unwrap<JournalInfo>(
      await client.api.journals[':id'].$patch({ param: { id }, ...withBody({ name }) }),
    ),
  deleteJournal: async (id: string, input: JournalDelete) =>
    unwrap<{ active: string | null; snapshot: string | null }>(
      await client.api.journals[':id'].$delete({ param: { id }, ...withBody(input) }),
    ),

  // settings
  getSettings: async () => unwrap<Settings>(await client.api.settings.$get()),
  patchSettings: async (patch: SettingsPatch) =>
    unwrap<Settings>(await client.api.settings.$patch(withBody(patch))),

  // notes
  listNotes: async (filters: NoteFilters = {}) =>
    unwrap<Page<Note>>(await client.api.notes.$get({ query: toQuery(filters) })),
  countNotes: async (filters: NoteFilters = {}) =>
    unwrap<{ count: number }>(await client.api.notes.count.$get({ query: toQuery(filters) })),
  createNote: async (input: NoteCreate) =>
    unwrap<Note>(await client.api.notes.$post(withBody(input))),
  getNote: async (id: string) =>
    unwrap<NoteDetail>(await client.api.notes[':id'].$get({ param: { id } })),
  patchNote: async (id: string, patch: NotePatch) =>
    unwrap<Note>(await client.api.notes[':id'].$patch({ param: { id }, ...withBody(patch) })),
  deleteNote: async (id: string) =>
    unwrapEmpty(await client.api.notes[':id'].$delete({ param: { id } })),
  restoreNote: async (id: string) =>
    unwrap<Note>(await client.api.notes[':id'].restore.$post({ param: { id } })),

  // people
  listPeople: async (query: { tag?: string; sort?: 'name' | 'updated'; cursor?: string } = {}) =>
    unwrap<Page<Person>>(
      await client.api.people.$get({ query: stripUndefined({ ...query, limit: '500' }) }),
    ),
  createPerson: async (input: PersonCreate) =>
    unwrap<Person>(await client.api.people.$post(withBody(input))),
  getPerson: async (id: string) =>
    unwrap<Person>(await client.api.people[':id'].$get({ param: { id } })),
  patchPerson: async (id: string, patch: PersonPatch) =>
    unwrap<Person>(await client.api.people[':id'].$patch({ param: { id }, ...withBody(patch) })),
  deletePerson: async (id: string) =>
    unwrapEmpty(await client.api.people[':id'].$delete({ param: { id } })),
  restorePerson: async (id: string) =>
    unwrap<Person>(await client.api.people[':id'].restore.$post({ param: { id } })),
  personNotes: async (id: string, cursor?: string) =>
    unwrap<Page<Note>>(
      await client.api.people[':id'].notes.$get({
        param: { id },
        query: stripUndefined({ cursor }),
      }),
    ),

  // farm entries
  listPlantings: async (query: { tag?: string; status?: 'growing' | 'done' | 'noted' } = {}) =>
    unwrap<Page<Planting>>(
      await client.api.plantings.$get({ query: stripUndefined({ ...query, limit: '500' }) }),
    ),
  createPlanting: async (input: PlantingCreate) =>
    unwrap<Planting>(await client.api.plantings.$post(withBody(input))),
  getPlanting: async (id: string) =>
    unwrap<Planting>(await client.api.plantings[':id'].$get({ param: { id } })),
  patchPlanting: async (id: string, patch: PlantingPatch) =>
    unwrap<Planting>(
      await client.api.plantings[':id'].$patch({ param: { id }, ...withBody(patch) }),
    ),
  deletePlanting: async (id: string) =>
    unwrapEmpty(await client.api.plantings[':id'].$delete({ param: { id } })),
  restorePlanting: async (id: string) =>
    unwrap<Planting>(await client.api.plantings[':id'].restore.$post({ param: { id } })),
  plantingNotes: async (id: string, cursor?: string) =>
    unwrap<Page<Note>>(
      await client.api.plantings[':id'].notes.$get({
        param: { id },
        query: stripUndefined({ cursor }),
      }),
    ),

  // maps
  listMaps: async () =>
    unwrap<Page<MapSummary>>(await client.api.maps.$get({ query: { limit: '500' } })),
  createMap: async (input: MapCreate) =>
    unwrap<MapDetail>(await client.api.maps.$post(withBody(input))),
  getMap: async (id: string) =>
    unwrap<MapDetail>(await client.api.maps[':id'].$get({ param: { id } })),
  patchMap: async (id: string, patch: MapPatch) =>
    unwrap<MapDetail>(await client.api.maps[':id'].$patch({ param: { id }, ...withBody(patch) })),
  deleteMap: async (id: string) =>
    unwrapEmpty(await client.api.maps[':id'].$delete({ param: { id } })),
  restoreMap: async (id: string) =>
    unwrap<MapDetail>(await client.api.maps[':id'].restore.$post({ param: { id } })),
  /** Save the drawing and pin changes together. */
  saveMapChanges: async (id: string, changes: MapChanges) =>
    unwrap<{ updatedAt: string }>(
      await client.api.maps[':id'].changes.$post({ param: { id }, ...withBody(changes) }),
    ),
  /** A last-chance save while the page is going away; `keepalive` lets it finish after unload. */
  saveMapChangesOnExit: (id: string, changes: MapChanges): Promise<void> =>
    send(`/api/maps/${id}/changes`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Moss-Client': 'web',
        ...journalHeader(),
      },
      body: JSON.stringify(changes),
    }).then(
      () => undefined,
      () => undefined,
    ),
  duplicateMap: async (id: string, input: { id?: string; name?: string } = {}) =>
    unwrap<MapDetail>(
      await client.api.maps[':id'].duplicate.$post({ param: { id }, ...withBody(input) }),
    ),
  mapVersions: async (id: string) =>
    unwrap<{ items: MapVersionInfo[] }>(
      await client.api.maps[':id'].versions.$get({ param: { id } }),
    ),
  saveMapVersion: async (id: string, name?: string) =>
    unwrap<{ items: MapVersionInfo[] }>(
      await client.api.maps[':id'].versions.$post({
        param: { id },
        ...withBody(name === undefined ? {} : { name }),
      }),
    ),
  restoreMapVersion: async (id: string, versionId: string) =>
    unwrap<MapDetail>(
      await client.api.maps[':id'].versions[':versionId'].restore.$post({
        param: { id, versionId },
      }),
    ),
  deleteMapVersion: async (id: string, versionId: string) =>
    unwrapEmpty(
      await client.api.maps[':id'].versions[':versionId'].$delete({ param: { id, versionId } }),
    ),
  importMapProject: async (file: unknown) =>
    unwrap<MapDetail>(await client.api.maps.import.$post(withBody(file as never))),
  createPin: async (mapId: string, input: PinCreate) =>
    unwrap<MapPin>(
      await client.api.maps[':id'].pins.$post({ param: { id: mapId }, ...withBody(input) }),
    ),
  patchPin: async (mapId: string, pinId: string, patch: PinPatch) =>
    unwrap<MapPin>(
      await client.api.maps[':id'].pins[':pinId'].$patch({
        param: { id: mapId, pinId },
        ...withBody(patch),
      }),
    ),
  deletePin: async (mapId: string, pinId: string) =>
    unwrapEmpty(
      await client.api.maps[':id'].pins[':pinId'].$delete({ param: { id: mapId, pinId } }),
    ),
  places: async () =>
    unwrap<{ items: (MapPin & { mapName: string })[] }>(await client.api.maps.places.$get()),
  pinsFor: async (type: 'note' | 'person' | 'planting', id: string) =>
    unwrap<{ items: PinRef[] }>(await client.api.maps.pins.$get({ query: { type, id } })),

  fieldLabels: async (kind: 'person' | 'planting', q: string) =>
    unwrap<{ labels: string[] }>(await client.api['field-labels'].$get({ query: { kind, q } })),

  // tags
  listTags: async () => unwrap<Tag[]>(await client.api.tags.$get()),
  createTag: async (name: string) => unwrap<Tag>(await client.api.tags.$post(withBody({ name }))),
  patchTag: async (id: string, patch: { name?: string; pinned?: boolean }) =>
    unwrap<Tag>(await client.api.tags[':id'].$patch({ param: { id }, ...withBody(patch) })),
  mergeTag: async (id: string, intoId: string) =>
    unwrap<Tag>(
      await client.api.tags[':id'].merge.$post({ param: { id }, ...withBody({ intoId }) }),
    ),
  deleteTag: async (id: string) =>
    unwrapEmpty(await client.api.tags[':id'].$delete({ param: { id } })),

  // search and pickers
  search: async (
    q: string,
    options: { kinds?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) =>
    unwrap<SearchResponse>(
      await client.api.search.$get(
        {
          query: stripUndefined({
            q,
            kinds: options.kinds,
            limit: options.limit === undefined ? undefined : String(options.limit),
          }),
        },
        signal ? { init: { signal } } : undefined,
      ),
    ),
  pick: async (
    kind: 'tag' | 'person' | 'note' | 'planting' | 'any',
    q: string,
    exclude: readonly string[] = [],
    signal?: AbortSignal,
  ) =>
    unwrap<{ items: PickItem[] }>(
      await client.api.pick.$get(
        { query: { kind, q, ...(exclude.length > 0 ? { exclude: exclude.join(',') } : {}) } },
        signal ? { init: { signal } } : undefined,
      ),
    ),

  // data and backups
  dataInfo: async () => unwrap<DataInfo>(await client.api.data.info.$get()),
  backups: async () => unwrap<{ items: BackupInfo[] }>(await client.api.data.backups.$get()),
  backupNow: async () => unwrap<BackupInfo>(await client.api.data.backup.$post()),
  restoreBackup: async (name: string) =>
    unwrap<{ restored: BackupInfo; safety: BackupInfo }>(
      await client.api.data.backups[':name'].restore.$post({ param: { name } }),
    ),
  deleteBackup: async (name: string) =>
    unwrapEmpty(await client.api.data.backups[':name'].$delete({ param: { name } })),
  openDataFolder: async () => unwrapEmpty(await client.api.data['open-folder'].$post()),

  importDryRun: async (file: unknown) =>
    unwrap<ImportSummary>(
      await client.api.data.import.$post({ query: { dryRun: '1' }, ...withBody(file as object) }),
    ),
  importJournal: async (file: unknown) =>
    unwrap<{ counts: ImportSummary['counts']; snapshot: string }>(
      await client.api.data.import.$post({ query: {}, ...withBody(file as object) }),
    ),

  // recently deleted
  trash: async () => unwrap<{ items: TrashItem[] }>(await client.api.trash.$get({ query: {} })),
  restoreFromTrash: async (kind: TrashItem['kind'], id: string) =>
    unwrap<unknown>(await client.api.trash[':kind'][':id'].restore.$post({ param: { kind, id } })),
  deleteForever: async (kind: TrashItem['kind'], id: string) =>
    unwrapEmpty(await client.api.trash[':kind'][':id'].$delete({ param: { kind, id } })),
  emptyTrash: async () => unwrap<{ removed: number }>(await client.api.trash.$delete()),

  // phone access (from the computer itself)
  getPhone: async () => unwrap<PhoneStatus>(await client.api.phone.$get()),
  setPhoneAccess: async (enabled: boolean) =>
    unwrap<PhoneStatus>(await client.api.phone.$put({ json: { enabled } })),
  makePairingCode: async () => unwrap<PairingCode>(await client.api.phone.code.$post()),
  removeDevice: async (id: string) =>
    unwrapEmpty(await client.api.phone.devices[':id'].$delete({ param: { id } })),
  removeAllDevices: async () =>
    unwrap<{ removed: number }>(await client.api.phone.devices.$delete()),

  // files
  /** Fetch an export (`/api/data/export.json` and the like) as a file to save. */
  download: async (path: string): Promise<DownloadedFile> => {
    let response: Response;
    try {
      response = await send(path, { headers: { 'X-Moss-Client': 'web', ...journalHeader() } });
    } catch {
      throw new NetworkError();
    }
    if (!response.ok) return failure(response);
    return { blob: await response.blob(), filename: filenameOf(response) };
  },
};

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** The file name the server suggests in `Content-Disposition`, or a plain fallback. */
function filenameOf(response: Response): string {
  const header = response.headers.get('content-disposition') ?? '';
  return /filename="([^"]+)"/.exec(header)?.[1] ?? 'mossnote-export';
}

function stripUndefined(value: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}
