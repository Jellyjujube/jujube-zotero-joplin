import { formatDocumentNote } from "../src/modules/formatter";
import { parseAiSections } from "../src/modules/aiSections";
import { createDefaultAiSettings } from "../src/modules/aiConfig";
import { AiResult } from "../src/modules/aiTypes";
import { ItemData, PluginSettings } from "../src/modules/types";

const data: ItemData = {
  key: "ITEM1",
  version: 1,
  itemType: "journalArticle",
  libraryID: 1,
  libraryType: "user",
  title: "Paper",
  creators: [],
  date: "2026",
  year: "2026",
  publicationTitle: "Journal",
  journalAbbreviation: "",
  DOI: "",
  url: "",
  abstractNote: "",
  tags: [],
  collections: [],
  citekey: "",
  notes: [
    {
      key: "NOTE1",
      title: "Note",
      html: "",
      markdown: "Note body",
      uri: "zotero://select/library/items/NOTE1",
    },
  ],
  attachments: [
    {
      key: "ATT1",
      title: "paper.pdf",
      contentType: "application/pdf",
      filename: "paper.pdf",
      uri: "zotero://open-pdf/library/items/ATT1",
      annotations: [
        {
          key: "ANN1",
          type: "highlight",
          text: "Quote",
          comment: "Comment",
          color: "#ffd400",
          pageLabel: "5",
          pageIndex: 4,
          sortIndex: "1",
          tags: [],
        },
      ],
    },
  ],
  itemURI: "zotero://select/library/items/ITEM1",
};

function settings(mode: "keep" | "only" = "keep"): PluginSettings {
  return {
    joplinBaseUrl: "",
    joplinToken: "",
    notebookName: "",
    exportLocationMode: "default",
    defaultLocationSource: "fixed",
    includeImages: true,
    includeAbstract: false,
    includeTags: true,
    language: "en-US",
    ai: {
      ...createDefaultAiSettings(),
      enabled: true,
      pdfSummaryEnabled: true,
      notesSummaryEnabled: true,
      organizeEnabled: true,
      organizeMode: mode,
    },
  };
}

function result(degraded = false): AiResult {
  return {
    pdfSummary: {
      feature: "pdf-summary",
      hash: "aaaaaaaaaaaaaaaa",
      markdown: "### Findings\n- PDF finding",
      cached: false,
      degraded: false,
    },
    notesSummary: {
      feature: "notes-summary",
      hash: "bbbbbbbbbbbbbbbb",
      markdown:
        "### Themes\n- Note claim [N1](zotero://select/library/items/NOTE1)",
      cached: false,
      degraded: false,
    },
    organized: {
      feature: "notes-organize",
      hash: "cccccccccccccccc",
      markdown:
        "### Organized\n- Annotation claim [A1](zotero://open-pdf/library/items/ATT1?page=5&annotation=ANN1)",
      cached: false,
      degraded,
    },
    warnings: [],
    errors: [],
  };
}

const noAi = formatDocumentNote(data, settings("keep"));
if (noAi.includes("AI Summary") || noAi.includes("AI Organized")) {
  throw new Error("no-AI output contains AI sections");
}

const kept = formatDocumentNote(data, settings("keep"), result());
const indexes = [
  kept.indexOf("## AI Summary (PDF)"),
  kept.indexOf("## AI Summary (Notes)"),
  kept.indexOf("## AI Organized Notes and Annotations"),
  kept.indexOf("## Zotero Notes"),
  kept.indexOf("## PDF Annotations"),
];
if (
  indexes.some((value) => value < 0) ||
  [...indexes].sort((a, b) => a - b).join(",") !== indexes.join(",")
) {
  throw new Error(`AI section order or originals missing: ${indexes}`);
}
const sections = parseAiSections(kept);
if (
  !sections.has("pdf-summary") ||
  !sections.has("notes-summary") ||
  !sections.has("notes-organize")
) {
  throw new Error("AI section markers missing");
}
if (!kept.includes("AI-generated content"))
  throw new Error("disclaimer missing");

const only = formatDocumentNote(data, settings("only"), result());
if (only.includes("## Zotero Notes") || only.includes("## PDF Annotations")) {
  throw new Error("only mode should omit original sections");
}
if (!only.includes("Original notes and annotations are not included")) {
  throw new Error("only mode original link missing");
}
if (!only.includes("## AI Organized Notes and Annotations")) {
  throw new Error("only mode AI organized section missing");
}

const degradedOnly = formatDocumentNote(data, settings("only"), result(true));
if (
  !degradedOnly.includes("## Zotero Notes") ||
  !degradedOnly.includes("## PDF Annotations")
) {
  throw new Error("degraded only mode should retain originals");
}
if (!degradedOnly.includes("may be stale")) {
  throw new Error("stale warning missing");
}

console.log("AI formatter tests: OK");
