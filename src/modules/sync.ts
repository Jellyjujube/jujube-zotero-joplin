import { JoplinClient } from "./joplinClient";
import {
  formatAnnotationsNote,
  formatDocumentNote,
  formatLiteratureNote,
  formatNotesNote,
  hasAnnotations,
  hasNotes,
} from "./formatter";
import {
  collectItemData,
  collectSelectedItems,
  collectStandaloneNoteData,
} from "./zoteroData";
import {
  ExportMode,
  ItemData,
  NoteKind,
  PluginSettings,
  SyncSummary,
} from "./types";
import { getPref } from "../utils/prefs";
import { appendDebugLog } from "../utils/debugLog";
import {
  generateNoteId,
  makeUserData,
  paperKey,
  parseUserData,
  parseUserDataTags,
} from "./noteIdentity";

const MANAGED_BLOCK_RE =
  /<!-- zotero-joplin:begin[\s\S]*?<!-- zotero-joplin:end -->/;

export function getSettings(): PluginSettings {
  const mode = String(getPref("exportLocationMode") || "default");
  const source = String(getPref("defaultLocationSource") || "fixed");
  return {
    joplinBaseUrl:
      String(getPref("joplinBaseUrl") || "").trim() ||
      "http://127.0.0.1:41184",
    joplinToken: String(getPref("joplinToken") || "").trim(),
    notebookName: String(getPref("notebookName") || "").trim(),
    exportLocationMode: mode === "ask" ? "ask" : "default",
    defaultLocationSource:
      source === "collections" ? "collections" : "fixed",
    includeImages: Boolean(getPref("includeImages")),
    includeAbstract: Boolean(getPref("includeAbstract")),
    includeTags: Boolean(getPref("includeTags")),
  };
}

export function mergeManagedRegion(
  existingBody: string,
  generatedBlock: string,
): string | null {
  const body = String(existingBody || "");
  if (!MANAGED_BLOCK_RE.test(body)) {
    return null;
  }
  return body.replace(MANAGED_BLOCK_RE, generatedBlock.trim());
}

async function sha256Hex(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // crypto.subtle is available in Zotero 10, but keep a fallback for
    // older/odd environments.
    const internal = (Zotero.Utilities as any).Internal;
    if (internal?.md5) {
      return String(internal.md5(value));
    }
    throw new Error("No hashing implementation available");
  }
}

export async function deterministicFolderId(
  data: ItemData,
): Promise<string> {
  return (
    await sha256Hex(`zotero-joplin-folder:${data.libraryID}:${data.key}`)
  ).slice(0, 32);
}

export async function deterministicNoteId(
  data: ItemData,
  kind: NoteKind,
): Promise<string> {
  const suffix = kind === "literature" ? "" : `${kind}:`;
  return (
    await sha256Hex(`zotero-joplin:${suffix}${data.libraryID}:${data.key}`)
  ).slice(0, 32);
}

export interface ExistingImageResource {
  resourceId: string;
  hash: string;
}

const IMAGE_MARKER_RE =
  /!\[Zotero 注释图片\]\(:\/([a-f0-9]{32})\)<!-- zotero-joplin-image:([^:\s>]+):([0-9a-f]+) -->/g;

export function parseImageResources(
  body: string,
): Map<string, ExistingImageResource> {
  const resources = new Map<string, ExistingImageResource>();
  const value = String(body || "");
  let match: RegExpExecArray | null;
  IMAGE_MARKER_RE.lastIndex = 0;
  while ((match = IMAGE_MARKER_RE.exec(value))) {
    resources.set(match[2], {
      resourceId: match[1],
      hash: match[3],
    });
  }
  return resources;
}

async function uploadAnnotationImages(
  client: JoplinClient,
  data: ItemData,
  markdown: string,
  existingBody = "",
): Promise<string> {
  let result = markdown;
  const existingResources = parseImageResources(existingBody);

  for (const attachment of data.attachments) {
    for (const annotation of attachment.annotations) {
      if (!annotation.imageDataUri) continue;

      const token = `![Zotero 注释图片]({{ZOTERO_JOPLIN_IMAGE:${annotation.key}}})`;
      if (!result.includes(token)) continue;

      const hash = (await sha256Hex(annotation.imageDataUri)).slice(0, 16);
      const cached = existingResources.get(annotation.key);

      if (cached && cached.hash === hash) {
        result = result.replace(
          token,
          `![Zotero 注释图片](:/${cached.resourceId})<!-- zotero-joplin-image:${annotation.key}:${hash} -->`,
        );
        continue;
      }

      try {
        const resourceId = await client.uploadImage(
          annotation.imageDataUri,
          `zotero-${data.key}-${annotation.key}.png`,
        );
        result = result.replace(
          token,
          `![Zotero 注释图片](:/${resourceId})<!-- zotero-joplin-image:${annotation.key}:${hash} -->`,
        );
      } catch (error) {
        const detail =
          error instanceof Error ? error.stack || error.message : String(error);
        Zotero.debug(
          `[Zotero to Joplin] Failed to upload annotation image ${annotation.key}: ${detail}`,
        );
        await appendDebugLog(
          `Image upload failed for item ${data.key}, annotation ${annotation.key}: ${detail}`,
        );
        result = result.replace(token, "（图片上传失败）");
      }
    }
  }
  return result;
}

type UpsertAction = "created" | "updated" | "skipped";

interface UpsertInput {
  id: string;
  title: string;
  body: string;
  parent_id?: string;
  user_data?: string;
}

async function upsertNote(
  client: JoplinClient,
  input: UpsertInput,
  existingNote?: any,
): Promise<UpsertAction> {
  const existing =
    existingNote !== undefined
      ? existingNote
      : await client.getNote(input.id);
  if (existing) {
    const merged = mergeManagedRegion(
      String(existing.body || ""),
      input.body,
    );
    if (merged === null) return "skipped";
    await client.updateNote(input.id, {
      title: input.title,
      body: merged,
      parent_id: input.parent_id,
      user_data: input.user_data,
    });
    return "updated";
  }

  try {
    await client.createNote(input);
    if (input.user_data) {
      // Joplin's POST endpoint ignores user_data (it is only copied on PUT).
      try {
        await client.updateNote(input.id, {
          user_data: input.user_data,
        });
      } catch {
        // Retry once; user_data is the lookup key for future exports.
        await client.updateNote(input.id, {
          user_data: input.user_data,
        });
      }
    }
    return "created";
  } catch (error) {
    // The note may exist but getNote() was unavailable. Try an update once
    // before giving up.
    const raced = await client.getNote(input.id);
    if (!raced) throw error;
    const merged = mergeManagedRegion(
      String(raced.body || ""),
      input.body,
    );
    if (merged === null) return "skipped";
    await client.updateNote(input.id, {
      title: input.title,
      body: merged,
      parent_id: input.parent_id,
      user_data: input.user_data,
    });
    return "updated";
  }
}

function recordAction(
  action: UpsertAction,
  summary: SyncSummary,
  message: string,
): boolean {
  if (action === "created") {
    summary.created++;
    return true;
  }
  if (action === "updated") {
    summary.updated++;
    return true;
  }
  summary.skipped++;
  summary.errors.push(message);
  return false;
}

/**
 * Build an index of "libraryID:itemKey" -> Joplin note ID from the notes'
 * user_data. Deleted notes and Joplin conflict copies are ignored.
 */
async function buildUserDataIndex(
  client: JoplinClient,
): Promise<Map<string, string>> {
  const notes = await client.listAllNotesForSync();
  const index = new Map<string, string>();
  const createdTimes = new Map<string, number>();

  for (const note of notes) {
    if (Number(note.deleted_time || 0) > 0) continue;
    if (Number(note.is_conflict || 0) === 1) continue;

    const key = parseUserData(String(note.user_data || ""));
    if (!key) continue;

    const id = String(note.id || "");
    if (!id) continue;
    const created = Number(note.created_time || 0);
    const existingId = index.get(key);

    if (!existingId) {
      index.set(key, id);
      createdTimes.set(key, created);
      continue;
    }

    // If the user duplicated a note (copying user_data), prefer the oldest
    // non-conflict note.
    const existingTime =
      createdTimes.get(key) || Number.MAX_SAFE_INTEGER;
    if (created && created < existingTime) {
      index.set(key, id);
      createdTimes.set(key, created);
    }
  }

  return index;
}

function uniqueTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags.map((tag) => String(tag || "").trim()).filter(Boolean),
    ),
  ];
}

async function applyTags(
  client: JoplinClient,
  noteId: string,
  tags: string[],
  cache: Map<string, string | undefined>,
): Promise<void> {
  for (const tag of uniqueTags(tags)) {
    let tagId = cache.get(tag);
    if (tagId === undefined) {
      tagId = await client.ensureTag(tag);
      cache.set(tag, tagId);
    }
    if (tagId) {
      await client.addTagToNote(tagId, noteId);
    }
  }
}

/**
 * Add the current Zotero tags and remove only tags that this plugin synced
 * earlier. Tags added manually in Joplin are left untouched.
 */
async function syncNoteTags(
  client: JoplinClient,
  noteId: string,
  desiredTags: string[],
  trackedTags: string[],
  cache: Map<string, string | undefined>,
): Promise<void> {
  const desired = uniqueTags(desiredTags);
  const tracked = new Set(uniqueTags(trackedTags));

  await applyTags(client, noteId, desired, cache);
  if (!tracked.size) return;

  let currentTags: Array<{ id: string; title: string }> = [];
  try {
    currentTags = await client.listNoteTags(noteId);
  } catch {
    return;
  }

  const desiredSet = new Set(desired);
  for (const tag of currentTags) {
    if (!tracked.has(tag.title) || desiredSet.has(tag.title)) continue;
    await client.removeTagFromNote(tag.id, noteId);
  }
}

export interface SyncProgress {
  (message: string, progress: number): void;
}

/**
 * Single-document export: one Joplin note per Zotero item, containing
 * metadata, child notes, and PDF annotations together.
 */
export async function syncZoteroItemsAsDocument(
  items: Zotero.Item[],
  targetFolderId: string,
  onProgress?: SyncProgress,
): Promise<SyncSummary> {
  const settings = getSettings();
  if (!settings.joplinToken) {
    throw new Error(
      "尚未配置 Joplin Token。请打开 Zotero 设置 → Zotero to Joplin，填入 Joplin Web Clipper 的 Token。",
    );
  }

  const client = new JoplinClient(settings);
  onProgress?.("正在连接 Joplin...", 0);
  await client.ping();

  onProgress?.("正在读取已有 Joplin 笔记...", 1);
  const userDataIndex = await buildUserDataIndex(client);

  const { regularItems, standaloneNotes } = collectSelectedItems(items);
  const dataList: ItemData[] = [];
  for (const item of regularItems) {
    dataList.push(await collectItemData(item));
  }
  for (const note of standaloneNotes) {
    dataList.push(await collectStandaloneNoteData(note));
  }

  const summary: SyncSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  if (!dataList.length) return summary;

  const tagCache = new Map<string, string | undefined>();

  for (let index = 0; index < dataList.length; index++) {
    const data = dataList[index];
    const progress = Math.round((index / dataList.length) * 100);
    onProgress?.(`正在导出内容：${data.title}`, progress);

    try {
      const mapKey = paperKey(data);
      let noteId = userDataIndex.get(mapKey);
      let existingNote: any = null;

      if (noteId) {
        existingNote = await client.getNote(noteId);
        if (
          !existingNote ||
          Number(existingNote.deleted_time || 0) > 0 ||
          Number(existingNote.is_conflict || 0) === 1
        ) {
          noteId = undefined;
          existingNote = null;
        }
      }

      // One-time migration from the old deterministic ID. Never reuse an ID
      // that has been deleted: Joplin sync treats that as a conflict.
      if (!noteId) {
        const legacyId = await deterministicNoteId(data, "literature");
        const legacy = await client.getNote(legacyId);
        if (
          legacy &&
          Number(legacy.deleted_time || 0) === 0 &&
          Number(legacy.is_conflict || 0) !== 1
        ) {
          noteId = legacyId;
          existingNote = legacy;
        }
      }

      if (!noteId) {
        noteId = await generateNoteId(data);
      }

      const previousTags = parseUserDataTags(
        String(existingNote?.user_data || ""),
      );
      const desiredTags = settings.includeTags
        ? uniqueTags(data.tags)
        : [];
      // Track every tag ever seen in Zotero. This lets the next export remove
      // a tag even if tag syncing was turned off in between.
      const trackedTags = uniqueTags([...previousTags, ...data.tags]);

      let markdown = formatDocumentNote(data, settings);
      markdown = await uploadAnnotationImages(
        client,
        data,
        markdown,
        String(existingNote?.body || ""),
      );

      const action = await upsertNote(
        client,
        {
          id: noteId,
          title: data.title || "Untitled",
          body: markdown,
          parent_id: targetFolderId,
          user_data: makeUserData(data, trackedTags),
        },
        existingNote,
      );
      const ok = recordAction(
        action,
        summary,
        `${data.title}：找不到托管区域标记，已跳过。`,
      );

      if (ok) {
        userDataIndex.set(mapKey, noteId);
      }

      if (ok) {
        await syncNoteTags(
          client,
          noteId,
          desiredTags,
          trackedTags,
          tagCache,
        );
      }
    } catch (error) {
      summary.failed++;
      const message =
        error instanceof Error ? error.message : String(error || "未知错误");
      summary.errors.push(`${data.title}：${message}`);
      Zotero.debug(
        `[Zotero to Joplin] Document export failed for ${data.key}: ${error}`,
      );
      await appendDebugLog(
        `Document export failed for ${data.key}: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  onProgress?.("导出完成", 100);
  return summary;
}

function modeLabel(mode: ExportMode): string {
  switch (mode) {
    case "notes":
      return "笔记";
    case "annotations":
      return "注释";
    default:
      return "内容";
  }
}

export async function syncZoteroItems(
  items: Zotero.Item[],
  mode: ExportMode = "all",
  onProgress?: SyncProgress,
): Promise<SyncSummary> {
  const settings = getSettings();
  if (!settings.joplinToken) {
    throw new Error(
      "尚未配置 Joplin Token。请打开 Zotero 设置 → Zotero to Joplin，填入 Joplin Web Clipper 的 Token。",
    );
  }

  const client = new JoplinClient(settings);
  onProgress?.(`正在连接 Joplin（${modeLabel(mode)}）...`, 0);
  await client.ping();

  const rootNotebookId = await client.ensureNotebookPath(settings.notebookName);

  const { regularItems, standaloneNotes } = collectSelectedItems(items);
  const dataList: ItemData[] = [];
  for (const item of regularItems) {
    dataList.push(await collectItemData(item));
  }
  for (const note of standaloneNotes) {
    dataList.push(await collectStandaloneNoteData(note));
  }

  const summary: SyncSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!dataList.length) {
    return summary;
  }

  const tagCache = new Map<string, string | undefined>();

  for (let index = 0; index < dataList.length; index++) {
    const data = dataList[index];
    const progress = Math.round((index / dataList.length) * 100);
    onProgress?.(
      `正在导出${modeLabel(mode)}：${data.title}`,
      progress,
    );

    try {
      const hasNotesContent = hasNotes(data);
      const hasAnnotationsContent = hasAnnotations(data);

      // A standalone Zotero note gets a single "笔记" note in its own folder.
      if (data.itemType === "note") {
        if (mode === "annotations") {
          summary.skipped++;
          summary.errors.push(`${data.title}：独立笔记没有 PDF 注释可导出。`);
          continue;
        }
        if (!hasNotesContent) {
          summary.skipped++;
          summary.errors.push(`${data.title}：笔记内容为空，已跳过。`);
          continue;
        }

        const folderId = await client.ensureItemFolder(
          await deterministicFolderId(data),
          data.title || "Untitled",
          rootNotebookId,
        );
        const notesId = await deterministicNoteId(data, "notes");
        const action = await upsertNote(client, {
          id: notesId,
          title: "笔记",
          body: formatNotesNote(data),
          parent_id: folderId,
        });
        if (
          recordAction(
            action,
            summary,
            `${data.title}：笔记找不到托管区域标记，已跳过。`,
          ) &&
          settings.includeTags &&
          data.tags.length
        ) {
          await applyTags(client, notesId, data.tags, tagCache);
        }
        continue;
      }

      if (mode === "notes" && !hasNotesContent) {
        summary.skipped++;
        summary.errors.push(`${data.title}：没有 Zotero 子笔记可导出。`);
        continue;
      }
      if (mode === "annotations" && !hasAnnotationsContent) {
        summary.skipped++;
        summary.errors.push(`${data.title}：没有 PDF 注释可导出。`);
        continue;
      }

      const folderId = await client.ensureItemFolder(
        await deterministicFolderId(data),
        data.title || "Untitled",
        rootNotebookId,
      );

      const literatureId = await deterministicNoteId(data, "literature");
      const notesId = await deterministicNoteId(data, "notes");
      const annotationsId = await deterministicNoteId(data, "annotations");

      let primaryNoteId = literatureId;

      if (mode === "all") {
        const literatureBody = formatLiteratureNote(data, settings, {
          notesNoteId: hasNotesContent ? notesId : undefined,
          annotationsNoteId: hasAnnotationsContent
            ? annotationsId
            : undefined,
        });
        recordAction(
          await upsertNote(client, {
            id: literatureId,
            title: "文献信息",
            body: literatureBody,
            parent_id: folderId,
          }),
          summary,
          `${data.title}：文献信息笔记找不到托管区域标记，已跳过。`,
        );
        primaryNoteId = literatureId;

        if (hasNotesContent) {
          recordAction(
            await upsertNote(client, {
              id: notesId,
              title: "笔记",
              body: formatNotesNote(data),
              parent_id: folderId,
            }),
            summary,
            `${data.title}：笔记汇总找不到托管区域标记，已跳过。`,
          );
        }

        if (hasAnnotationsContent) {
          let annotationsBody = formatAnnotationsNote(data, settings);
          annotationsBody = await uploadAnnotationImages(
            client,
            data,
            annotationsBody,
          );
          recordAction(
            await upsertNote(client, {
              id: annotationsId,
              title: "注释",
              body: annotationsBody,
              parent_id: folderId,
            }),
            summary,
            `${data.title}：注释汇总找不到托管区域标记，已跳过。`,
          );
        }
      } else if (mode === "notes") {
        primaryNoteId = notesId;
        const ok = recordAction(
          await upsertNote(client, {
            id: notesId,
            title: "笔记",
            body: formatNotesNote(data),
            parent_id: folderId,
          }),
          summary,
          `${data.title}：笔记汇总找不到托管区域标记，已跳过。`,
        );
        if (!ok) continue;
      } else if (mode === "annotations") {
        primaryNoteId = annotationsId;
        let annotationsBody = formatAnnotationsNote(data, settings);
        annotationsBody = await uploadAnnotationImages(
          client,
          data,
          annotationsBody,
        );
        const ok = recordAction(
          await upsertNote(client, {
            id: annotationsId,
            title: "注释",
            body: annotationsBody,
            parent_id: folderId,
          }),
          summary,
          `${data.title}：注释汇总找不到托管区域标记，已跳过。`,
        );
        if (!ok) continue;
      }

      if (settings.includeTags && data.tags.length) {
        await applyTags(client, primaryNoteId, data.tags, tagCache);
      }
    } catch (error) {
      summary.failed++;
      const message =
        error instanceof Error ? error.message : String(error || "未知错误");
      summary.errors.push(`${data.title}：${message}`);
      Zotero.debug(`[Zotero to Joplin] Sync failed for ${data.key}: ${error}`);
      await appendDebugLog(
        `Sync failed for ${data.key} (${mode}): ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  onProgress?.("同步完成", 100);
  return summary;
}
