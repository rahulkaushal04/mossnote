import type { Client } from '../rpc/client';
import type { NativeBridge } from './native';
import type { AttachmentRef } from './types';

export interface AddOutcome {
  added: AttachmentRef[];
  errors: string[];
}
const none = (): AddOutcome => ({ added: [], errors: [] });
const msg = (e: unknown) => (e instanceof Error ? e.message : 'The file could not be added.');

/** Adds each token in order; one failure does not stop the rest. */
export async function addTokens(
  client: Client,
  noteId: string,
  tokens: string[],
): Promise<AddOutcome> {
  const out = none();
  for (const token of tokens) {
    const r = await client.call('attachments.addPath', { noteId, token });
    if (r.ok) out.added.push(r.value);
    else out.errors.push(r.error.message);
  }
  return out;
}

export async function addFromPick(
  client: Client,
  native: NativeBridge,
  noteId: string,
): Promise<AddOutcome> {
  let token: string | undefined;
  try {
    token = await native.pickFile();
  } catch (e) {
    return { added: [], errors: [msg(e)] };
  }
  return token ? addTokens(client, noteId, [token]) : none();
}

export async function addFromDrop(
  client: Client,
  native: NativeBridge,
  noteId: string,
  files: File[],
): Promise<AddOutcome> {
  if (files.length === 0) return none();
  let tokens: string[];
  try {
    tokens = await native.dropTokens(files);
  } catch (e) {
    return { added: [], errors: [msg(e)] };
  }
  if (tokens.length === 0)
    return { added: [], errors: ['The dropped item is not a file that can be attached.'] };
  return addTokens(client, noteId, tokens);
}

export async function addFromPaste(native: NativeBridge, noteId: string): Promise<AddOutcome> {
  try {
    const r = await native.pasteImage(noteId);
    if (!r.ok) return { added: [], errors: [r.error.message] };
    return { added: r.value ? [r.value] : [], errors: [] };
  } catch (e) {
    return { added: [], errors: [msg(e)] };
  }
}
