import { JoplinClient } from "./joplinClient";
import { PluginSettings } from "./types";

export const ROOT_NOTEBOOK = "Zotero";
export const GROUPS_NOTEBOOK = "Groups";

export interface CollectionNode {
  libraryID: number;
  key: string;
  name: string;
}

export interface TargetDescriptor {
  segments: string[];
  collectionChain?: CollectionNode[];
  groupName?: string;
}

/**
 * All plugin-created notebooks live under the Zotero root. This accepts
 * "Papers", "Zotero/Papers", or "/Zotero/Papers" and always returns a path
 * starting with "Zotero".
 */
export function normalizeFixedSegments(value: string): string[] {
  const parts = String(value || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return [ROOT_NOTEBOOK];
  if (parts[0] === ROOT_NOTEBOOK) return parts;
  return [ROOT_NOTEBOOK, ...parts];
}

/**
 * Return the path and collection chain for the currently selected Zotero
 * collection. Only a single selected collection is accepted; My Library,
 * saved searches, and multi-collection selections return null.
 */
export function getCurrentCollectionTarget(): TargetDescriptor | null {
  try {
    const pane: any = (Zotero.getMainWindow() as any)?.ZoteroPane;
    let selected: any[] = [];

    if (typeof pane?.getSelectedCollections === "function") {
      selected = pane.getSelectedCollections(true) || [];
    } else if (typeof pane?.getSelectedCollection === "function") {
      const id = pane.getSelectedCollection(true);
      if (id) selected = [id];
    }

    if (selected.length !== 1) return null;
    const first = selected[0];
    const collection: any =
      typeof first === "number" ? Zotero.Collections.get(first) : first;
    if (!collection) return null;

    const nodes: any[] = [];
    const seen = new Set<number>();
    let current: any = collection;

    while (current) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      nodes.unshift(current);

      if (!current.parentID) break;
      current = Zotero.Collections.get(current.parentID);
    }

    const chain: CollectionNode[] = nodes.map((node) => ({
      libraryID: node.libraryID,
      key: node.key,
      name: String(node.name || `Collection ${node.key}`),
    }));

    const library: any = Zotero.Libraries.get(collection.libraryID);
    const groupName =
      library?.libraryType === "group"
        ? library.name || `Group ${library.groupID || collection.libraryID}`
        : undefined;

    const segments = [
      ROOT_NOTEBOOK,
      ...(groupName ? [GROUPS_NOTEBOOK, groupName] : []),
      ...chain.map((node) => node.name),
    ];

    return { segments, collectionChain: chain, groupName };
  } catch {
    return null;
  }
}

export function resolveDefaultTarget(
  settings: PluginSettings,
): TargetDescriptor {
  if (settings.defaultLocationSource === "collections") {
    return (
      getCurrentCollectionTarget() || {
        segments: [ROOT_NOTEBOOK],
      }
    );
  }

  return {
    segments: normalizeFixedSegments(settings.notebookName),
  };
}

export async function ensureTarget(
  client: JoplinClient,
  target: TargetDescriptor,
): Promise<{ folderId: string; path: string }> {
  const rootId = await client.ensureFolderChain([ROOT_NOTEBOOK]);

  if (target.collectionChain?.length) {
    let parentId = rootId;

    if (target.groupName) {
      parentId = await client.ensureFolderChain([
        ROOT_NOTEBOOK,
        GROUPS_NOTEBOOK,
        target.groupName,
      ]);
    }

    for (const collection of target.collectionChain) {
      parentId = await client.ensureCollectionFolder(
        parentId,
        collection.libraryID,
        collection.key,
        collection.name,
      );
    }

    return {
      folderId: parentId,
      path: target.segments.join("/"),
    };
  }

  const folderId = await client.ensureFolderChain(target.segments);
  return { folderId, path: target.segments.join("/") };
}
