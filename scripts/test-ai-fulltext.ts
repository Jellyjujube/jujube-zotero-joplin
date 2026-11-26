import {
  collectPdfFullText,
  extractAttachmentFullText,
  normalizeFullText,
} from "../src/modules/aiFulltext";
import { ItemData } from "../src/modules/types";

let indexedCalls = 0;
let cacheExists = false;
let cacheText = "";
let fullyIndexed = true;
let attachmentText = "";
let neverResolve = false;

const fakeFile = {
  path: "/tmp/fake.zotero-ft-cache",
  exists: () => cacheExists,
};

(globalThis as any).Zotero = {
  Items: {
    get: (id: number) =>
      id === 1 ? attachment1 : id === 2 ? attachment2 : false,
  },
  Fulltext: {
    isFullyIndexed: async () => fullyIndexed,
    canIndex: () => true,
    indexItems: async () => {
      indexedCalls++;
    },
    getItemCacheFile: () => fakeFile,
  },
  File: {
    getContentsAsync: async () => cacheText,
  },
  debug: () => {},
};

const attachment1: any = {
  id: 1,
  key: "ATT1",
  attachmentContentType: "application/pdf",
  attachmentFilename: "paper.pdf",
  isFileAttachment: () => true,
  isPDFAttachment: () => true,
  getDisplayTitle: () => "paper.pdf",
  get attachmentText() {
    return neverResolve
      ? new Promise<string>(() => {})
      : Promise.resolve(attachmentText);
  },
};
const attachment2: any = {
  ...attachment1,
  id: 2,
  key: "ATT2",
  attachmentText: Promise.resolve("Second PDF text"),
};

const item: any = {
  getAttachments: () => [1, 2],
};

function makeData(): ItemData {
  return {
    key: "ITEM1",
    version: 1,
    itemType: "journalArticle",
    libraryID: 1,
    libraryType: "user",
    title: "Paper",
    creators: [],
    date: "",
    year: "",
    publicationTitle: "",
    journalAbbreviation: "",
    DOI: "",
    url: "",
    abstractNote: "",
    tags: [],
    collections: [],
    citekey: "",
    notes: [],
    attachments: [
      {
        key: "ATT1",
        itemID: 1,
        title: "paper.pdf",
        contentType: "application/pdf",
        filename: "paper.pdf",
        uri: "zotero://open-pdf/library/items/ATT1",
        annotations: [],
      },
      {
        key: "ATT2",
        itemID: 2,
        title: "supplement.pdf",
        contentType: "application/pdf",
        filename: "supplement.pdf",
        uri: "zotero://open-pdf/library/items/ATT2",
        annotations: [],
      },
    ],
    itemURI: "zotero://select/library/items/ITEM1",
  };
}

// Normalization.
const normalized = normalizeFullText("a\r\nb\x00\n\n\n\nc  \n");
if (normalized !== "a\nb\n\nc")
  throw new Error(`normalize failed: ${JSON.stringify(normalized)}`);

// Primary attachmentText path.
attachmentText = "Primary text";
neverResolve = false;
cacheExists = false;
fullyIndexed = true;
indexedCalls = 0;
let result = await extractAttachmentFullText(attachment1, 100, {
  maxChars: 100,
});
if (result.source !== "attachment-text" || result.text !== "Primary text") {
  throw new Error(`primary extraction failed: ${JSON.stringify(result)}`);
}

// Indexing preflight.
fullyIndexed = false;
indexedCalls = 0;
await extractAttachmentFullText(attachment1, 100, { maxChars: 100 });
if (indexedCalls !== 1) throw new Error("indexItems was not called");

// Cache fallback.
attachmentText = "";
cacheExists = true;
cacheText = "Cached text";
result = await extractAttachmentFullText(attachment1, 100, { maxChars: 100 });
if (result.source !== "fulltext-cache" || result.text !== "Cached text") {
  throw new Error(`cache fallback failed: ${JSON.stringify(result)}`);
}

// Unavailable.
cacheExists = false;
cacheText = "";
result = await extractAttachmentFullText(attachment1, 100, { maxChars: 100 });
if (result.source !== "unavailable" || result.text) {
  throw new Error(`unavailable path failed: ${JSON.stringify(result)}`);
}

// Timeout fallback.
attachmentText = "";
neverResolve = true;
cacheExists = false;
result = await extractAttachmentFullText(attachment1, 100, {
  maxChars: 100,
  perAttachmentTimeoutMs: 10,
});
if (result.source !== "unavailable" || !result.error?.includes("timed out")) {
  throw new Error(`timeout path failed: ${JSON.stringify(result)}`);
}
neverResolve = false;

// Budget truncation.
attachmentText = "x".repeat(5000);
cacheExists = false;
result = await extractAttachmentFullText(attachment1, 100, { maxChars: 100 });
if (!result.truncated || result.text.length !== 100) {
  throw new Error(`truncation failed: ${JSON.stringify(result)}`);
}

// First PDF with text wins; empty first PDF is skipped.
attachmentText = "";
cacheExists = false;
attachment2.attachmentText = Promise.resolve("Second PDF text");
const data = makeData();
const docs = await collectPdfFullText(item, data, { maxChars: 1000 });
if (docs.length !== 1 || docs[0].attachmentKey !== "ATT2") {
  throw new Error(`PDF selection failed: ${JSON.stringify(docs)}`);
}
if (data.attachments[1].fullText?.text !== "Second PDF text") {
  throw new Error("attachment fullText was not attached");
}

console.log("AI fulltext tests: OK");
