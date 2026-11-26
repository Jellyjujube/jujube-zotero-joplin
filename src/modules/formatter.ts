import { t, type MessageKey } from "./i18n";
import { annotationUrl } from "./links";
import { wrapAiSection } from "./aiSections";
import { AiResult, AiSectionSummary } from "./aiTypes";
import {
  AnnotationData,
  AttachmentData,
  CreatorInfo,
  ItemData,
  Language,
  NoteKind,
  PluginSettings,
} from "./types";

const COLOR_KEYS: Record<string, MessageKey> = {
  "#ffd400": "color.yellow",
  "#ff6666": "color.red",
  "#5fb236": "color.green",
  "#2ea8e5": "color.blue",
  "#a28ae5": "color.purple",
  "#e56eee": "color.magenta",
  "#f19837": "color.orange",
  "#aaaaaa": "color.gray",
};

const TYPE_KEYS: Record<string, MessageKey> = {
  highlight: "ann.highlight",
  underline: "ann.underline",
  note: "ann.note",
  text: "ann.text",
  image: "ann.image",
  ink: "ann.ink",
};

function escapeLinkText(text: string): string {
  return String(text || "")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

function formatAuthors(creators: CreatorInfo[]): string {
  const authors = creators.filter((creator) => creator.role === "author");
  const list = authors.length ? authors : creators;
  return list
    .map((creator) => creator.name || creator.lastName)
    .filter(Boolean)
    .join("; ");
}

function colorName(color: string, language: Language): string {
  const key = COLOR_KEYS[String(color || "").toLowerCase()];
  return key ? t(language, key) : String(color || "");
}

function typeName(type: string, language: Language): string {
  const key = TYPE_KEYS[String(type || "").toLowerCase()];
  return key ? t(language, key) : String(type || "");
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
function nestNoteHeadings(
  markdown: string,
  startLevel = NOTE_CONTENT_HEADING_LEVEL,
): string {
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

function renderAnnotation(
  attachment: AttachmentData,
  annotation: AnnotationData,
  settings: PluginSettings,
): string[] {
  const language = settings.language;
  const lines: string[] = [];
  const parts = [
    typeName(annotation.type, language),
    colorName(annotation.color, language),
  ]
    .filter(Boolean)
    .join(" · ");
  const link = annotationUrl(attachment, annotation);

  lines.push(`**[${parts}](${link})**`);
  lines.push("");

  if (annotation.type === "image" || annotation.type === "ink") {
    if (annotation.imageDataUri && settings.includeImages) {
      lines.push(
        `![${t(language, "doc.imageAlt")}]({{ZOTERO_JOPLIN_IMAGE:${annotation.key}}})`,
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
      `${t(language, "doc.tagsInline")}: ${annotation.tags
        .map((tag) => inlineCode(tag))
        .join(", ")}`,
    );
  }

  lines.push("");
  return lines;
}

function annotationPageLabel(
  annotation: AnnotationData,
  language: Language,
): string {
  if (annotation.pageLabel) return `p. ${annotation.pageLabel}`;
  if (annotation.pageIndex >= 0) return `p. ${annotation.pageIndex + 1}`;
  return t(language, "doc.unknownPage");
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
  const language = settings.language;
  const lines: string[] = [];
  const title = attachment.title || t(language, "doc.pdfFallback");
  lines.push(`### [${escapeLinkText(title)}](${attachment.uri})`);
  lines.push("");

  let currentPage = "";
  for (const annotation of attachment.annotations) {
    const pageKey = annotationPageKey(annotation);
    if (pageKey !== currentPage) {
      if (currentPage) lines.push("");
      lines.push(`#### ${annotationPageLabel(annotation, language)}`);
      lines.push("");
      currentPage = pageKey;
    }
    lines.push(...renderAnnotation(attachment, annotation, settings));
  }
  return lines;
}

function renderItemHeader(data: ItemData, language: Language): string[] {
  return [`# ${data.title || t(language, "doc.untitled")}`, ""];
}

function renderMetadata(data: ItemData, settings: PluginSettings): string[] {
  const language = settings.language;
  const lines: string[] = [];
  const authors = formatAuthors(data.creators);
  const meta: Array<[string, string]> = [];
  if (authors) meta.push([t(language, "doc.authors"), authors]);
  if (data.year) meta.push([t(language, "doc.year"), data.year]);
  if (data.itemType) meta.push([t(language, "doc.type"), data.itemType]);
  if (data.publicationTitle) {
    meta.push([t(language, "doc.publication"), data.publicationTitle]);
  }
  if (
    data.journalAbbreviation &&
    data.journalAbbreviation !== data.publicationTitle
  ) {
    meta.push([t(language, "doc.journalAbbrev"), data.journalAbbreviation]);
  }
  if (data.DOI) {
    meta.push([
      t(language, "doc.doi"),
      `[${escapeLinkText(data.DOI)}](https://doi.org/${encodeURI(data.DOI)})`,
    ]);
  }
  if (data.citekey) {
    meta.push([t(language, "doc.citekey"), inlineCode(data.citekey)]);
  }
  if (data.url) {
    meta.push([
      t(language, "doc.url"),
      `[${escapeLinkText(data.url)}](${data.url})`,
    ]);
  }
  meta.push([
    t(language, "doc.zotero"),
    `[${t(language, "doc.openInZotero")}](${data.itemURI})`,
  ]);
  if (settings.includeTags && data.tags.length) {
    meta.push([
      t(language, "doc.tags"),
      data.tags.map((tag) => inlineCode(tag)).join(", "),
    ]);
  }
  if (data.collections.length) {
    meta.push([t(language, "doc.collections"), data.collections.join(" / ")]);
  }

  for (const [label, value] of meta) {
    lines.push(`- **${label}**: ${value}`);
  }
  lines.push("");

  if (settings.includeAbstract && data.abstractNote) {
    lines.push(`## ${t(language, "doc.abstract")}`);
    lines.push("");
    lines.push(data.abstractNote.trim());
    lines.push("");
  }
  return lines;
}

function renderNotesSection(data: ItemData, language: Language): string[] {
  if (!data.notes.length) return [];
  const lines: string[] = [`## ${t(language, "doc.notes")}`, ""];

  for (const note of data.notes) {
    const markdown = nestNoteHeadings(note.markdown);
    if (!markdown) continue;
    lines.push(
      `### [${escapeLinkText(
        note.title || t(language, "doc.noteFallback"),
      )}](${note.uri})`,
    );
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

  const lines: string[] = [`## ${t(settings.language, "doc.annotations")}`, ""];
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
  const language = settings.language;
  const body = [
    ...renderItemHeader(data, language),
    ...renderMetadata(data, settings),
  ];

  const linkLines: string[] = [];
  if (links.notesNoteId) {
    linkLines.push(
      `- **${t(language, "doc.notesLink")}**: [${t(
        language,
        "doc.openNotes",
      )}](:/${links.notesNoteId})`,
    );
  }
  if (links.annotationsNoteId) {
    linkLines.push(
      `- **${t(language, "doc.annotationsLink")}**: [${t(
        language,
        "doc.openAnnotations",
      )}](:/${links.annotationsNoteId})`,
    );
  }
  if (linkLines.length) {
    body.push(`## ${t(language, "doc.related")}`, "", ...linkLines, "");
  }

  return wrapManaged("literature", data, body);
}

export function formatNotesNote(
  data: ItemData,
  language: Language = "zh-CN",
): string {
  const section = renderNotesSection(data, language);
  if (!section.length) return "";
  const body = [
    ...renderItemHeader(data, language),
    `[${t(language, "doc.openInZotero")}](${data.itemURI})`,
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
    ...renderItemHeader(data, settings.language),
    `[${t(settings.language, "doc.openInZotero")}](${data.itemURI})`,
    "",
    ...section,
  ];
  return wrapManaged("annotations", data, body);
}

function renderAiSection(
  section: AiSectionSummary | undefined,
  headingKey:
    "ai.headingPdfSummary" | "ai.headingNotesSummary" | "ai.headingOrganize",
  settings: PluginSettings,
): string[] {
  if (!section?.markdown) return [];
  const language = settings.language;
  const lines: string[] = [`## ${t(language, headingKey)}`, ""];
  if (section.degraded) {
    lines.push(`> ${t(language, "ai.staleWarning")}`, "");
  }
  lines.push(
    ...wrapAiSection(section.feature, section.hash, section.markdown).split(
      "\n",
    ),
  );
  lines.push("");
  return lines;
}

function renderAiSections(
  ai: AiResult | undefined,
  settings: PluginSettings,
): string[] {
  if (!ai) return [];
  const sections = [
    ...renderAiSection(ai.pdfSummary, "ai.headingPdfSummary", settings),
    ...renderAiSection(ai.notesSummary, "ai.headingNotesSummary", settings),
    ...renderAiSection(ai.organized, "ai.headingOrganize", settings),
  ];
  if (!sections.length) return [];
  sections.push(`_${t(settings.language, "ai.disclaimer")}_`, "");
  return sections;
}

function renderCombinedBody(
  data: ItemData,
  settings: PluginSettings,
  ai?: AiResult,
): string[] {
  const organizeOnly =
    Boolean(ai?.organized?.markdown) &&
    !ai?.organized?.degraded &&
    settings.ai.organizeMode === "only";
  const lines = [
    ...renderItemHeader(data, settings.language),
    ...renderMetadata(data, settings),
    ...renderAiSections(ai, settings),
  ];
  if (!organizeOnly) {
    lines.push(
      ...renderNotesSection(data, settings.language),
      ...renderAnnotationsSection(data, settings),
    );
  } else {
    lines.push(
      `> ${t(settings.language, "ai.originalNotExported")} [${t(
        settings.language,
        "ai.openOriginal",
      )}](${data.itemURI})`,
      "",
    );
  }
  return lines;
}

/**
 * Single-document export: one Joplin note per Zotero item containing
 * literature metadata, child notes, and PDF annotations.
 */
export function formatDocumentNote(
  data: ItemData,
  settings: PluginSettings,
  ai?: AiResult,
): string {
  return wrapManaged("document", data, renderCombinedBody(data, settings, ai));
}

export function hasNotes(data: ItemData): boolean {
  return data.notes.some((note) => Boolean(note.markdown));
}

export function hasAnnotations(data: ItemData): boolean {
  return data.attachments.some((attachment) =>
    attachment.annotations.some((annotation) => Boolean(annotation.key)),
  );
}
