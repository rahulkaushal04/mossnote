import type { Folder } from '@mossnote/core/rpc';

export interface FolderRow {
  folder: Folder;
  /** 1 = top level. */
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  posinset: number;
  setsize: number;
  parentId: string | null;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The visible folder rows in tree order (iterative: depth never grows the call stack). A folder's
 * children are listed only when `isExpanded(id)`. `excludeId` drops that folder and its subtree.
 * Folders whose parent is missing from `folders` (e.g. trashed) are not reachable and not listed.
 */
export function flattenFolders(
  folders: readonly Folder[],
  isExpanded: (id: string) => boolean,
  excludeId?: string,
): FolderRow[] {
  const kids = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const k = f.parentId ?? null;
    const a = kids.get(k);
    if (a) a.push(f);
    else kids.set(k, [f]);
  }
  for (const a of kids.values()) a.sort((x, y) => collator.compare(x.name, y.name));
  const out: FolderRow[] = [];
  const seen = new Set<string>();
  const stack: { f: Folder; level: number; pos: number; size: number }[] = [];
  const pushKids = (parent: string | null, level: number) => {
    const a = (kids.get(parent) ?? []).filter((f) => f.id !== excludeId);
    for (let i = a.length - 1; i >= 0; i--)
      stack.push({ f: a[i]!, level, pos: i + 1, size: a.length });
  };
  pushKids(null, 1);
  for (let s = stack.pop(); s; s = stack.pop()) {
    if (seen.has(s.f.id)) continue;
    seen.add(s.f.id);
    const hasChildren = (kids.get(s.f.id) ?? []).some((c) => c.id !== excludeId);
    const expanded = hasChildren && isExpanded(s.f.id);
    out.push({
      folder: s.f,
      level: s.level,
      hasChildren,
      expanded,
      posinset: s.pos,
      setsize: s.size,
      parentId: s.f.parentId,
    });
    if (expanded) pushKids(s.f.id, s.level + 1);
  }
  return out;
}
