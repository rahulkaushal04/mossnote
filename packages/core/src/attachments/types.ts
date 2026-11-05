/** Pure types shared with the RPC contract (no Node imports: the UI may import them). */

export const KINDS = [
  'image',
  'svg',
  'pdf',
  'text',
  'html',
  'audio',
  'video',
  'executable',
  'other',
] as const;
export type Kind = (typeof KINDS)[number];
export type TextState = 'none' | 'pending' | 'done' | 'failed';
export type VerifyState = 'ok' | 'missing' | 'corrupt';

export interface AttachmentRef {
  refId: string;
  noteId: string;
  sha256: string;
  /** Sanitized display name. Untrusted text: render with textContent only. */
  name: string;
  size: number;
  mime: string;
  kind: Kind;
  textState: TextState;
  verifyState: VerifyState;
  createdAt: number;
  /** `mossnote-attachment://a/<sha256>` */
  url: string;
  /** Ready-to-insert Markdown (image syntax for image and svg). */
  markdown: string;
}

export interface AttachmentInfo {
  sha256: string;
  size: number;
  mime: string;
  kind: Kind;
  textState: TextState;
  verifyState: VerifyState;
  createdAt: number;
  /** Where the blob is used (at most 20). Names are sanitized, titles are note titles. */
  refs: { refId: string; noteId: string; noteTitle: string; name: string }[];
  /** Set by `verify: true`: the result of hashing the file now. */
  state?: VerifyState;
  /** Set when state is 'missing' or 'corrupt': names the note and suggests a backup (AT-2). */
  message?: string;
}

export interface CleanupItem {
  sha256: string;
  size: number;
  mime: string;
  kind: Kind | 'unknown';
  /** On disk with no database row (an add that crashed before it committed). */
  untracked: boolean;
}
export interface CleanupPreview {
  items: CleanupItem[];
  totalBytes: number;
}
export interface CleanupResult {
  deleted: number;
  bytes: number;
  /** In use now, changed meanwhile, or not deletable. Never deleted. */
  skipped: string[];
}

export interface VerifyFailure {
  sha256: string;
  size: number;
  /** Up to 5 notes that use the file. */
  notes: { noteId: string; title: string; name: string }[];
}
export interface VerifyReport {
  checked: number;
  ok: number;
  missing: VerifyFailure[];
  corrupt: VerifyFailure[];
  /** Files on disk that no row describes (listed by Cleanup). */
  untracked: string[];
}
