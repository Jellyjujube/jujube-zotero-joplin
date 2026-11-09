import {
  AnnotationData,
  AttachmentData,
  CreatorInfo,
  ItemData,
  NoteData,
} from "./types";

function getItem(id: number): Zotero.Item | null {
  const item = Zotero.Items.get(id);
  return item || null;
}

/**
 * Resolve a selected item to the regular item that owns it.
 * Selecting a PDF attachment or an annotation should sync its parent item.
 */
export function resolveRegularItem(item: Zotero.Item): Zotero.Item | null {
  if (item.isRegularItem()) {
    return item;
  }

  if (item.isAttachment()) {
    const parentID = (item as any).parentItemID as number | undefined;
    if (parentID) {
      const parent = getItem(parentID);
      if (parent?.isRegularItem()) return parent;
    }
    return null;
  }

  if (item.isAnnotation()) {
    const attachmentID = (item as any).parentItemID as number | undefined;
    if (!attachmentID) return null;
    const attachment = getItem(attachmentID);
    const parentID = attachment
      ? ((attachment as any).parentItemID as number | undefined)
      : undefined;
    if (parentID) {
      const parent = getItem(parentID);
      if (parent?.isRegularItem()) return parent;
    }
    return null;
  }

  if (item.isNote()) {
    const parentID = (item as any).parentItemID as number | undefined;
    if (parentID) {
      const parent = getItem(parentID);
      if (parent?.isRegularItem()) return parent;
    }
  }

  return null;
}

/**
 * Collect unique regular items from the current selection. Standalone notes
 * are returned separately so they can be synced as note-only items.
 */
export function collectSelectedItems(items: Zotero.Item[]): {
  regularItems: Zotero.Item[];
  standaloneNotes: Zotero.Item[];
} {
  const regularByKey = new Map<string, Zotero.Item>();
  const standaloneNotes: Zotero.Item[] = [];
  const seenNotes = new Set<string>();

  for (const item of items) {
    const regular = resolveRegularItem(item);
    if (regular) {
      regularByKey.set(`${regular.libraryID}:${regular.key}`, regular);
      continue;
    }

    if (item.isNote() && !(item as any).parentItemID) {
      const key = `${item.libraryID}:${item.key}`;
      if (!seenNotes.has(key)) {
        seenNotes.add(key);
        standaloneNotes.push(item);
      }
    }
  }

  return {
    regularItems: [...regularByKey.values()],
    standaloneNotes,
  };
}

function getField(item: Zotero.Item, field: string): string {
  try {
    return String(item.getField(field) || "");
  } catch {
    return "";
  }
}

function getYear(date: string): string {
  const match = String(date || "").match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
  return match ? match[1] : "";
}

function getCreators(item: Zotero.Item): CreatorInfo[] {
  return item.getCreators().map((creator: any) => {
    const firstName = String(creator.firstName || "");
    const lastName = String(creator.lastName || "");
    let role = "";
    try {
      role = Zotero.CreatorTypes.getName(creator.creatorTypeID) || "";
    } catch {
      role = "";
    }
    const name =
      creator.fieldMode === 1
        ? lastName
        : [firstName, lastName].filter(Boolean).join(" ");
    return { firstName, lastName, name, role };
  });
}

function getTags(item: Zotero.Item): string[] {
  try {
    return item.getTags().map((tag: any) => String(tag.tag || "")).filter(Boolean);
  } catch {
    return [];
  }
}

function getCollections(item: Zotero.Item): string[] {
  try {
    return item
      .getCollections()
      .map((id: number) => {
        const collection = Zotero.Collections.get(id);
        return collection ? collection.name : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getCitekey(item: Zotero.Item): string {
  const extra = getField(item, "extra");
  const match = extra.match(/^\s*Citation Key:\s*(\S+)\s*$/im);
  if (match) return match[1];

  try {
    const bbt = (Zotero as any).BetterBibTeX;
    const keyManager = bbt?.keyManager;
    if (keyManager?.getCiteKey) {
      return String(keyManager.getCiteKey(item) || "");
    }
    if (keyManager?.get) {
      const entry = keyManager.get(item.id);
      return String(entry?.citekey || entry?.citeKey || "");
    }
  } catch {
    // Better BibTeX is optional.
  }

  return "";
}

export function getLibraryInfo(item: Zotero.Item): {
  libraryType: string;
  groupID?: number;
  pathPrefix: string;
} {
  let libraryType = "user";
  let groupID: number | undefined;

  try {
    const library: any = Zotero.Libraries.get(item.libraryID);
    libraryType = library?.libraryType || "user";
    if (libraryType === "group") {
      groupID = library.groupID;
    }
  } catch {
    // Fall back to the user library.
  }

  return {
    libraryType,
    groupID,
    pathPrefix:
      libraryType === "group" && groupID ? `groups/${groupID}` : "library",
  };
}

export function makeItemURI(item: Zotero.Item): string {
  const { pathPrefix } = getLibraryInfo(item);
  return `zotero://select/${pathPrefix}/items/${item.key}`;
}

export function makeNoteURI(note: Zotero.Item): string {
  const { pathPrefix } = getLibraryInfo(note);
  return `zotero://select/${pathPrefix}/items/${note.key}`;
}

export function makeAttachmentURI(attachment: Zotero.Item): string {
  const { pathPrefix } = getLibraryInfo(attachment);
  return `zotero://open-pdf/${pathPrefix}/items/${attachment.key}`;
}

export function makeAnnotationURI(
  attachment: Zotero.Item,
  annotation: AnnotationData,
): string {
  const { pathPrefix } = getLibraryInfo(attachment);
  const page = annotation.pageIndex >= 0 ? annotation.pageIndex + 1 : 1;
  return (
    `zotero://open-pdf/${pathPrefix}/items/${attachment.key}` +
    `?page=${page}&annotation=${annotation.key}`
  );
}

function parsePosition(position: unknown): any {
  if (!position) return null;
  if (typeof position === "object") return position;
  try {
    return JSON.parse(String(position));
  } catch {
    return null;
  }
}

function normalizeAnnotation(
  annotation: Zotero.Item,
  json: any,
): AnnotationData {
  const position = parsePosition(json?.position ?? (annotation as any).annotationPosition);
  const rawTags = json?.tags || (annotation as any).getTags?.() || [];
  const tags = rawTags
    .map((tag: any) =>
      typeof tag === "string" ? tag : String(tag?.name || tag?.tag || ""),
    )
    .filter(Boolean);

  return {
    key: annotation.key,
    type: String(json?.type || (annotation as any).annotationType || ""),
    text: String(json?.text ?? (annotation as any).annotationText ?? ""),
    comment: String(
      json?.comment ?? (annotation as any).annotationComment ?? "",
    ),
    color: String(json?.color ?? (annotation as any).annotationColor ?? ""),
    pageLabel: String(
      json?.pageLabel ?? (annotation as any).annotationPageLabel ?? "",
    ),
    pageIndex:
      typeof position?.pageIndex === "number" ? position.pageIndex : -1,
    sortIndex: String(
      json?.sortIndex ?? (annotation as any).annotationSortIndex ?? "",
    ),
    tags,
    imageDataUri: typeof json?.image === "string" ? json.image : undefined,
  };
}

async function getAnnotations(attachment: Zotero.Item): Promise<AnnotationData[]> {
  let annotations: Zotero.Item[] = [];
  try {
    annotations = attachment.getAnnotations(false);
  } catch {
    return [];
  }

  const result: AnnotationData[] = [];
  for (const annotation of annotations) {
    let json: any = null;
    try {
      if ((Zotero.Annotations as any)?.toJSON) {
        json = await (Zotero.Annotations as any).toJSON(annotation);
      }
    } catch {
      // Fall back to the item's own annotation fields.
    }
    result.push(normalizeAnnotation(annotation, json));
  }

  result.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    return a.sortIndex.localeCompare(b.sortIndex);
  });
  return result;
}

async function getAttachments(item: Zotero.Item): Promise<AttachmentData[]> {
  const result: AttachmentData[] = [];
  let ids: number[] = [];
  try {
    ids = item.getAttachments();
  } catch {
    return result;
  }

  for (const id of ids) {
    const attachment = getItem(id);
    if (!attachment || !attachment.isFileAttachment()) continue;

    const contentType = String((attachment as any).attachmentContentType || "");
    const annotations = await getAnnotations(attachment);
    if (!annotations.length && !/pdf|epub|html/i.test(contentType)) {
      continue;
    }

    result.push({
      key: attachment.key,
      title: String(
        (attachment as any).attachmentFilename ||
          (attachment as any).getDisplayTitle?.() ||
          "附件",
      ),
      contentType,
      filename: String((attachment as any).attachmentFilename || ""),
      uri: makeAttachmentURI(attachment),
      annotations,
    });
  }

  return result;
}

async function noteToMarkdown(note: Zotero.Item): Promise<string> {
  const html = String(note.getNote() || "");
  if (!html) return "";

  // Prefer Zotero's own Note Markdown translator. It produces Markdown with
  // Zotero links and images without requiring a DOM implementation in the
  // plugin sandbox.
  try {
    const translators = Zotero.Translators as any;
    const translatorID = translators?.TRANSLATOR_ID_NOTE_MARKDOWN;
    const quickCopy = (Zotero.QuickCopy as any);
    if (translatorID && quickCopy?.getContentFromItems) {
      await Zotero.Translators.init();
      const translator = Zotero.Translators.get(translatorID);
      if (translator) {
        (translator as any).cacheCode = true;
        await (Zotero.Translators as any).getCodeForTranslator(translator);
      }

      const result: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Note Markdown translator timed out")),
          15000,
        );
        let accepted = false;
        try {
          accepted = quickCopy.getContentFromItems(
            [note],
            { mode: "export", id: translatorID },
            (obj: any) => {
              clearTimeout(timer);
              resolve(obj);
            },
          );
        } catch (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        if (!accepted) {
          clearTimeout(timer);
          reject(new Error("QuickCopy refused the note"));
        }
      });

      const markdown = String(result?.string || result?.text || "").trim();
      if (markdown) return markdown;
    }
  } catch (error) {
    Zotero.debug(
      `[Zotero to Joplin] Note Markdown translator failed: ${error}`,
    );
  }

  // Fallback: strip HTML using the main window's DOM. This loses formatting
  // but keeps the note text usable.
  try {
    const win = Zotero.getMainWindow();
    const doc = win.document.implementation.createHTMLDocument("");
    if (doc.body) {
      doc.body.innerHTML = html;
      return String(doc.body.textContent || "").trim();
    }
    return "";
  } catch {
    return html;
  }
}

async function getNotes(item: Zotero.Item): Promise<NoteData[]> {
  const result: NoteData[] = [];
  let ids: number[] = [];
  try {
    ids = item.getNotes();
  } catch {
    return result;
  }

  for (const id of ids) {
    const note = getItem(id);
    if (!note || !note.isNote()) continue;
    let title = "";
    try {
      title = String((note as any).getDisplayTitle?.() || "");
    } catch {
      title = "";
    }
    const html = String(note.getNote() || "");
    result.push({
      key: note.key,
      title,
      html,
      markdown: await noteToMarkdown(note),
      uri: makeNoteURI(note),
    });
  }

  return result;
}

async function collectAllNotes(item: Zotero.Item): Promise<NoteData[]> {
  const notes: NoteData[] = [];
  const seen = new Set<string>();
  const add = (list: NoteData[]) => {
    for (const note of list) {
      if (seen.has(note.key)) continue;
      seen.add(note.key);
      notes.push(note);
    }
  };

  add(await getNotes(item));

  // Notes can also be attached to an attachment item in some workflows.
  for (const id of item.getAttachments()) {
    const attachment = getItem(id);
    if (attachment) {
      add(await getNotes(attachment));
    }
  }

  return notes;
}

export async function collectItemData(item: Zotero.Item): Promise<ItemData> {
  const library = getLibraryInfo(item);
  const date = getField(item, "date");

  return {
    key: item.key,
    version: Number((item as any).version || 0),
    itemType: String((item as any).itemType || ""),
    libraryID: item.libraryID,
    libraryType: library.libraryType,
    groupID: library.groupID,
    title:
      getField(item, "title") ||
      String((item as any).getDisplayTitle?.() || "") ||
      "Untitled",
    creators: getCreators(item),
    date,
    year: getYear(date),
    publicationTitle: getField(item, "publicationTitle"),
    journalAbbreviation: getField(item, "journalAbbreviation"),
    DOI: getField(item, "DOI"),
    url: getField(item, "url"),
    abstractNote: getField(item, "abstractNote"),
    tags: getTags(item),
    collections: getCollections(item),
    citekey: getCitekey(item),
    notes: await collectAllNotes(item),
    attachments: await getAttachments(item),
    itemURI: makeItemURI(item),
  };
}

export async function collectStandaloneNoteData(
  note: Zotero.Item,
): Promise<ItemData> {
  const library = getLibraryInfo(note);
  const title = String((note as any).getDisplayTitle?.() || "Zotero Note");
  const html = String(note.getNote() || "");
  return {
    key: note.key,
    version: Number((note as any).version || 0),
    itemType: "note",
    libraryID: note.libraryID,
    libraryType: library.libraryType,
    groupID: library.groupID,
    title,
    creators: [],
    date: "",
    year: "",
    publicationTitle: "",
    journalAbbreviation: "",
    DOI: "",
    url: "",
    abstractNote: "",
    tags: getTags(note),
    collections: getCollections(note),
    citekey: "",
    notes: [
      {
        key: note.key,
        title,
        html,
        markdown: await noteToMarkdown(note),
        uri: makeNoteURI(note),
      },
    ],
    attachments: [],
    itemURI: makeNoteURI(note),
  };
}
