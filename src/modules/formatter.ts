import {
  AnnotationData,
  AttachmentData,
  CreatorInfo,
  ItemData,
  NoteKind,
  PluginSettings,
} from "./types";

const COLOR_NAMES: Record<string, string> = {
  "#ffd400": "黄色",
  "#ff6666": "红色",
  "#5fb236": "绿色",
  "#2ea8e5": "蓝色",
  "#a28ae5": "紫色",
  "#e56eee": "品红",
  "#f19837": "橙色",
  "#aaaaaa": "灰色",
};

const TYPE_NAMES: Record<string, string> = {
  highlight: "高亮",
  underline: "下划线",
  note: "笔记注释",
  text: "文字",
  image: "区域",
  ink: "绘图",
};

function escapeLinkText(text: string): string {
  return String(text || "").replace(/[\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
}

function formatAuthors(creators: CreatorInfo[]): string {
  const authors = creators.filter((creator) => creator.role === "author");
  const list = authors.length ? authors : creators;
  return list
    .map((creator) => creator.name || creator.lastName)
    .filter(Boolean)
    .join("; ");
}

function colorName(color: string): string {
  return COLOR_NAMES[String(color || "").toLowerCase()] || String(color || "");
}

function typeName(type: string): string {
  return TYPE_NAMES[String(type || "").toLowerCase()] || String(type || "");
}

function quote(text: string): string {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function inlineCode(value: string): string {
  return `\`${String(value).replace(/`/g, "'")}\``;
}

interface MarkdownHeading {
  lineIndex: number;
  indent: string;
  level: number;
}

const NOTE_CONTENT_HEADING_LEVEL = 4;

/**
 * Find ATX headings outside fenced code blocks.
 */
function scanMarkdownHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fenceChar = "";
  let fenceLength = 0;

  lines.forEach((line, lineIndex) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1];
      const char = marker[0];
      if (!fenceChar) {
        fenceChar = char;
        fenceLength = marker.length;
      } else if (
        char === fenceChar &&
        marker.length >= fenceLength &&
        !fence[2].trim()
      ) {
        fenceChar = "";
        fenceLength = 0;
      }
      return;
    }
    if (fenceChar) return;

    const heading = line.match(/^( {0,3})(#{1,6})(?=\s|$)/);
    if (heading) {
      headings.push({
        lineIndex,
        indent: heading[1],
        level: heading[2].length,
      });
    }
  });

  return headings;
}

/**
 * Re-level the headings inside a Zotero note so they become children of the
 * note's own heading (`### [note title]`). The shallowest heading is moved to
 * `startLevel`; deeper headings keep their relative order. Headings inside
 * fenced code blocks are left untouched.
 */
function nestNoteHeadings(markdown: string, startLevel = NOTE_CONTENT_HEADING_LEVEL): string {
  const source = String(markdown || "");
  const lines = source.split(/\r?\n/);
  const headings = scanMarkdownHeadings(lines);
  if (!headings.length) return source;

  let minLevel = 6;
  for (const heading of headings) {
    if (heading.level < minLevel) minLevel = heading.level;
  }
  const shift = startLevel - minLevel;

  for (const heading of headings) {
    const level = Math.max(1, Math.min(6, heading.level + shift));
    const line = lines[heading.lineIndex];
    const prefixLength = heading.indent.length + heading.level;
    lines[heading.lineIndex] =
      `${heading.indent}${"#".repeat(level)}${line.slice(prefixLength)}`;
  }

  return lines.join("\n");
}

function annotationLink(
  attachment: AttachmentData,
  annotation: AnnotationData,
): string {
  const page = annotation.pageIndex >= 0 ? annotation.pageIndex + 1 : 1;
  return `${attachment.uri}?page=${page}&annotation=${annotation.key}`;
}

function renderAnnotation(
  attachment: AttachmentData,
  annotation: AnnotationData,
  settings: PluginSettings,
): string[] {
  const lines: string[] = [];
  const parts = [typeName(annotation.type), colorName(annotation.color)]
    .filter(Boolean)
    .join(" · ");
  const link = annotationLink(attachment, annotation);

  lines.push(`**[${parts}](${link})**`);
  lines.push("");

  if (annotation.type === "image" || annotation.type === "ink") {
    if (annotation.imageDataUri && settings.includeImages) {
      lines.push(
        `![Zotero 注释图片]({{ZOTERO_JOPLIN_IMAGE:${annotation.key}}})`,
      );
    }
  } else if (annotation.text) {
    lines.push(quote(annotation.text));
  }

  if (annotation.comment) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(annotation.comment.trim());
  }

  if (annotation.tags.length) {
    lines.push("");
    lines.push(
      `标签: ${annotation.tags.map((tag) => inlineCode(tag)).join(", ")}`,
    );
  }

  lines.push("");
  return lines;
}

function annotationPageLabel(annotation: AnnotationData): string {
  if (annotation.pageLabel) return `p. ${annotation.pageLabel}`;
  if (annotation.pageIndex >= 0) return `p. ${annotation.pageIndex + 1}`;
  return "未知页";
}

function annotationPageKey(annotation: AnnotationData): string {
  if (annotation.pageIndex >= 0) return `index:${annotation.pageIndex}`;
  if (annotation.pageLabel) return `label:${annotation.pageLabel}`;
  return "unknown";
}

function renderAttachment(
  attachment: AttachmentData,
  settings: PluginSettings,
): string[] {
  if (!attachment.annotations.length) return [];
  const lines: string[] = [];
  const title = attachment.title || "PDF";
  lines.push(`### [${escapeLinkText(title)}](${attachment.uri})`);
  lines.push("");

  let currentPage = "";
  for (const annotation of attachment.annotations) {
    const pageKey = annotationPageKey(annotation);
    if (pageKey !== currentPage) {
      if (currentPage) lines.push("");
      lines.push(`#### ${annotationPageLabel(annotation)}`);
      lines.push("");
      currentPage = pageKey;
    }
    lines.push(...renderAnnotation(attachment, annotation, settings));
  }
  return lines;
}

function renderItemHeader(data: ItemData): string[] {
  return [`# ${data.title || "Untitled"}`, ""];
}

function renderMetadata(
  data: ItemData,
  settings: PluginSettings,
): string[] {
  const lines: string[] = [];
  const authors = formatAuthors(data.creators);
  const meta: Array<[string, string]> = [];
  if (authors) meta.push(["作者", authors]);
  if (data.year) meta.push(["年份", data.year]);
  if (data.itemType) meta.push(["类型", data.itemType]);
  if (data.publicationTitle) meta.push(["期刊/出版物", data.publicationTitle]);
  if (
    data.journalAbbreviation &&
    data.journalAbbreviation !== data.publicationTitle
  ) {
    meta.push(["期刊缩写", data.journalAbbreviation]);
  }
  if (data.DOI) {
    meta.push([
      "DOI",
      `[${escapeLinkText(data.DOI)}](https://doi.org/${encodeURI(data.DOI)})`,
    ]);
  }
  if (data.citekey) meta.push(["Citekey", inlineCode(data.citekey)]);
  if (data.url) meta.push(["URL", `[${escapeLinkText(data.url)}](${data.url})`]);
  meta.push(["Zotero", `[在 Zotero 中打开](${data.itemURI})`]);
  if (settings.includeTags && data.tags.length) {
    meta.push(["标签", data.tags.map((tag) => inlineCode(tag)).join(", ")]);
  }
  if (data.collections.length) {
    meta.push(["集合", data.collections.join(" / ")]);
  }

  for (const [label, value] of meta) {
    lines.push(`- **${label}**: ${value}`);
  }
  lines.push("");

  if (settings.includeAbstract && data.abstractNote) {
    lines.push("## 摘要");
    lines.push("");
    lines.push(data.abstractNote.trim());
    lines.push("");
  }
  return lines;
}

function renderNotesSection(data: ItemData): string[] {
  if (!data.notes.length) return [];
  const lines: string[] = ["## Zotero 笔记", ""];

  for (const note of data.notes) {
    const markdown = nestNoteHeadings(note.markdown);
    if (!markdown) continue;
    lines.push(`### [${escapeLinkText(note.title || "笔记")}](${note.uri})`);
    lines.push("");
    lines.push(markdown);
    lines.push("");
  }

  return lines.length > 2 ? lines : [];
}

function renderAnnotationsSection(
  data: ItemData,
  settings: PluginSettings,
): string[] {
  const sections = data.attachments
    .map((attachment) => renderAttachment(attachment, settings))
    .filter((section) => section.length);
  if (!sections.length) return [];

  const lines: string[] = ["## PDF 注释", ""];
  for (const section of sections) {
    lines.push(...section);
  }
  return lines;
}

function wrapManaged(
  kind: NoteKind | "document",
  data: ItemData,
  body: string[],
): string {
  return [
    `<!-- zotero-joplin:begin item=${data.key} kind=${kind} library=${data.libraryID} version=${data.version} -->`,
    "",
    ...body,
    "<!-- zotero-joplin:end -->",
    "",
  ].join("\n");
}

export interface LiteratureLinks {
  notesNoteId?: string;
  annotationsNoteId?: string;
}

export function formatLiteratureNote(
  data: ItemData,
  settings: PluginSettings,
  links: LiteratureLinks = {},
): string {
  const body = [...renderItemHeader(data), ...renderMetadata(data, settings)];

  const linkLines: string[] = [];
  if (links.notesNoteId) {
    linkLines.push(`- **笔记**: [打开笔记](:/${links.notesNoteId})`);
  }
  if (links.annotationsNoteId) {
    linkLines.push(
      `- **注释**: [打开注释](:/${links.annotationsNoteId})`,
    );
  }
  if (linkLines.length) {
    body.push("## 相关笔记", "", ...linkLines, "");
  }

  return wrapManaged("literature", data, body);
}

export function formatNotesNote(data: ItemData): string {
  const section = renderNotesSection(data);
  if (!section.length) return "";
  const body = [
    ...renderItemHeader(data),
    `[在 Zotero 中打开](${data.itemURI})`,
    "",
    ...section,
  ];
  return wrapManaged("notes", data, body);
}

export function formatAnnotationsNote(
  data: ItemData,
  settings: PluginSettings,
): string {
  const section = renderAnnotationsSection(data, settings);
  if (!section.length) return "";
  const body = [
    ...renderItemHeader(data),
    `[在 Zotero 中打开](${data.itemURI})`,
    "",
    ...section,
  ];
  return wrapManaged("annotations", data, body);
}

function renderCombinedBody(
  data: ItemData,
  settings: PluginSettings,
): string[] {
  return [
    ...renderItemHeader(data),
    ...renderMetadata(data, settings),
    ...renderNotesSection(data),
    ...renderAnnotationsSection(data, settings),
  ];
}

/**
 * Single-document export: one Joplin note per Zotero item containing
 * literature metadata, child notes, and PDF annotations.
 */
export function formatDocumentNote(
  data: ItemData,
  settings: PluginSettings,
): string {
  return wrapManaged("document", data, renderCombinedBody(data, settings));
}

export function hasNotes(data: ItemData): boolean {
  return data.notes.some((note) => Boolean(note.markdown));
}

export function hasAnnotations(data: ItemData): boolean {
  return data.attachments.some((attachment) =>
    attachment.annotations.some((annotation) => Boolean(annotation.key)),
  );
}
