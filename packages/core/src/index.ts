export { err, ok } from './result.ts';
export type { AppError, AppErrorCode, Result } from './result.ts';
export { MIGRATIONS } from '../migrations/index.ts';
export type { Migration } from '../migrations/types.ts';
export { nodeFs } from './db/fs.ts';
export type { FsPort } from './db/fs.ts';
export { migrate, schemaDump, userVersion } from './db/migrate.ts';
export { sha256 } from './db/hash.ts';
export { toAppError } from './db/errors.ts';
export type { Clock, Db, Stmt } from './db/types.ts';
export { createUlid } from './ids/ulid.ts';
export { tickHlc, formatHlc } from './ids/hlc.ts';
export { appendChange, redactFields } from './changelog/append.ts';
export type { ChangeInput, Entity, Op } from './changelog/append.ts';
export type { ChangeRow } from './changelog/read.ts';
export type { RemoteChange } from './changelog/apply.ts';
export { openStore } from './store/store.ts';
export type { Ctx, OpenGuard, OpenOptions, Store, Tx } from './store/store.ts';
export { openWorkspace } from './workspace.ts';
export type { Workspace, WorkspaceOptions } from './workspace.ts';
export * from './attachments/index.ts';
export { createNotesApi } from './notes/notes.ts';
export { createFoldersApi } from './folders/folders.ts';
export { createTagsApi, tagKey } from './tags/tags.ts';
export { createTrashApi } from './trash/trash.ts';
export { createVersionsApi } from './versions/versions.ts';
export { snapshotNote } from './versions/snapshot.ts';
export { createDraftsApi } from './drafts/index.ts';
export type { DraftsApi } from './drafts/index.ts';
export { integrityGuard, checkIntegrity, listBackups } from './integrity/index.ts';
export { lockGuard, acquireLock, BUSY_MESSAGE } from './lock/index.ts';
export { createDispatcher, deriveTitle, methods as rpcMethods } from './rpc/index.ts';
export type { Dispatcher, DispatcherOptions, RpcEvent } from './rpc/index.ts';
export { createSearchApi } from './search/index.ts';
export type {
  IndexStatus,
  SavedSearch,
  SearchApi,
  SearchHit,
  SearchPage,
  SearchParams,
  SearchSpec,
  StepResult,
} from './search/index.ts';
export {
  applyPendingRestore,
  createBackup,
  createBackupScheduler,
  createBulkApi,
  createJobRunner,
  createLibrary,
  createPortability,
  decryptStream,
  encryptStream,
  listLibrary,
  pendingRestoreExists,
  runExport,
  runImport,
  safeNameForExport,
  stageRestore,
  sweepTemp,
  verifyPackageFile,
} from './portability/index.ts';
export type {
  ApplyResult,
  BackupResult,
  BackupSummary as LibraryBackupSummary,
  ExportResult,
  ImportReport,
  Portability,
  PortabilityOptions,
  RestoreSource,
  StagedRestore,
} from './portability/index.ts';
