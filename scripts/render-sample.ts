import {
  formatAnnotationsNote,
  formatDocumentNote,
  formatLiteratureNote,
  formatNotesNote,
} from "../src/modules/formatter";
import { ItemData, PluginSettings } from "../src/modules/types";

const settings: PluginSettings = {
  joplinBaseUrl: "http://127.0.0.1:41184",
  joplinToken: "test-token",
  notebookName: "Zotero",
  exportLocationMode: "default",
  defaultLocationSource: "fixed",
  includeImages: true,
  includeAbstract: true,
  includeTags: true,
};

const data: ItemData = {
  key: "ITEMKEY1",
  version: 42,
  itemType: "journalArticle",
  libraryID: 1,
  libraryType: "user",
  title: "A Sample Paper: Testing [brackets]",
  creators: [
    { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", role: "author" },
    { firstName: "Alan", lastName: "Turing", name: "Alan Turing", role: "author" },
  ],
  date: "2026-05-01",
  year: "2026",
  publicationTitle: "Journal of Tests",
  journalAbbreviation: "J. Tests",
  DOI: "10.1234/example",
  url: "https://example.com/paper",
  abstractNote: "This is the abstract.",
  tags: ["important", "to-read"],
  collections: ["Research / Papers"],
  citekey: "lovelace2026sample",
  notes: [
    {
      key: "NOTEKEY1",
      title: "My reading note",
      html: "<h2>Idea</h2><p>Use <strong>managed regions</strong>.</p>",
      markdown:
        "# Reading idea\n\n## Idea\n\nUse **managed regions**.\n\n### Detail\n\n```js\n# not a heading\n```\n\n- first\n- second",
      uri: "zotero://select/library/items/NOTEKEY1",
    },
    {
      key: "NOTEKEY2",
      title: "Short note",
      html: "<h2>Only section</h2><p>Second note.</p>",
      markdown: "## Only section\n\nSecond note.",
      uri: "zotero://select/library/items/NOTEKEY2",
    },
  ],
  attachments: [
    {
      key: "ATTACH01",
      title: "paper.pdf",
      contentType: "application/pdf",
      filename: "paper.pdf",
      uri: "zotero://open-pdf/library/items/ATTACH01",
      annotations: [
        {
          key: "ANN00001",
          type: "highlight",
          text: "Key sentence about [important] things.",
          comment: "This supports my argument.",
          color: "#ffd400",
          pageLabel: "5",
          pageIndex: 4,
          sortIndex: "00004|002694|00195",
          tags: ["method"],
        },
        {
          key: "ANN00002",
          type: "image",
          text: "",
          comment: "Architecture diagram",
          color: "#2ea8e5",
          pageLabel: "7",
          pageIndex: 6,
          sortIndex: "00006|001000|00010",
          tags: [],
          imageDataUri: "data:image/png;base64,AAAA",
        },
      ],
    },
  ],
  itemURI: "zotero://select/library/items/ITEMKEY1",
};

const literature = formatLiteratureNote(data, settings, {
  notesNoteId: "notesnoteid",
  annotationsNoteId: "annotationsnoteid",
});
const notes = formatNotesNote(data);
const annotations = formatAnnotationsNote(data, settings);
const preview = formatDocumentNote(data, settings);

console.log("===== literature =====");
console.log(literature);
console.log("===== notes =====");
console.log(notes);
console.log("===== annotations =====");
console.log(annotations);

const checks: Array<[string, boolean]> = [
  ["literature kind", literature.includes("kind=literature")],
  ["literature item link", literature.includes("zotero://select/library/items/ITEMKEY1")],
  ["literature notes link", literature.includes(":/notesnoteid")],
  ["literature annotations link", literature.includes(":/annotationsnoteid")],
  ["literature no annotation content", !literature.includes("annotation=ANN")],
  ["notes kind", notes.includes("kind=notes")],
  ["notes content", notes.includes("Use **managed regions**.")],
  ["note h1 nested under note title", notes.includes("#### Reading idea")],
  ["note h2 nested under h1", notes.includes("##### Idea")],
  ["note h3 nested under h2", notes.includes("###### Detail")],
  ["note code fence untouched", notes.includes("```js\n# not a heading\n```")],
  ["note h2-only starts at h4", notes.includes("#### Only section")],
  ["note h2-only not h5", !notes.includes("##### Only section")],
  ["document note h1 nested", preview.includes("#### Reading idea")],
  ["document note h1 not sibling", !preview.includes("\n### Reading idea")],
  ["note heading link", notes.includes("### [My reading note](zotero://select/library/items/NOTEKEY1)")],
  ["no redundant note link", !notes.includes("在 Zotero 中打开这条笔记")],
  ["notes no annotation", !notes.includes("annotation=ANN")],
  ["annotations kind", annotations.includes("kind=annotations")],
  ["annotation link", annotations.includes("annotation=ANN00001")],
  ["annotation page", annotations.includes("p. 5")],
  ["attachment heading link", annotations.includes("### [paper.pdf](zotero://open-pdf/library/items/ATTACH01)")],
  ["annotation heading link", annotations.includes("**[高亮 · 黄色](zotero://open-pdf/library/items/ATTACH01?page=5&annotation=ANN00001)**")],
  ["image heading uses 区域", annotations.includes("**[区域 · 蓝色](zotero://open-pdf/library/items/ATTACH01?page=7&annotation=ANN00002)**")],
  ["page group p5", annotations.includes("#### p. 5")],
  ["page group p7", annotations.includes("#### p. 7")],
  ["no annotation label headings", !annotations.includes("#### [")],
  ["no redundant PDF link", !annotations.includes("[打开 PDF]")],
  ["no redundant annotation link", !annotations.includes("[定位到注释]")],
  ["annotation image placeholder", annotations.includes("{{ZOTERO_JOPLIN_IMAGE:ANN00002}}")],
  ["annotations no note content", !annotations.includes("managed regions")],
  ["preview has everything", preview.includes("managed regions") && preview.includes("annotation=ANN00001")],
  ["managed end", preview.includes("<!-- zotero-joplin:end -->")],
];
for (const [name, ok] of checks) {
  console.log(`${ok ? "OK" : "FAIL"}: ${name}`);
}
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
