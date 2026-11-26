import { createAiRuntime, runAiForItem } from "../src/modules/aiOrchestrator";
import { parseAiSections, wrapAiSection } from "../src/modules/aiSections";
import { createDefaultAiSettings } from "../src/modules/aiConfig";
import { AiCacheStore } from "../src/modules/aiCache";
import { ItemData, PluginSettings } from "../src/modules/types";

class MemoryStore implements AiCacheStore {
  value: string | null = null;
  async read() {
    return this.value;
  }
  async write(text: string) {
    this.value = text;
  }
  async clear() {
    this.value = null;
  }
}

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

function makeSettings(
  overrides: Partial<PluginSettings["ai"]> = {},
): PluginSettings {
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
      provider: "custom",
      baseUrl: "https://example.test/v1",
      model: "test",
      cacheEnabled: false,
      annotationContextEnabled: false,
      notesSummaryEnabled: true,
      ...overrides,
    },
  };
}

let calls = 0;
const fakeClient: any = {
  chat: async () => {
    calls++;
    return {
      text: "<ai_output>\n### Theme\n- Claim {{zref:A1}}\n</ai_output>",
      model: "test",
      latencyMs: 1,
      attempts: 1,
    };
  },
};

const settings = makeSettings();
const runtime = await createAiRuntime(settings, { client: fakeClient });
if (!runtime.enabled)
  throw new Error(`runtime should be enabled: ${runtime.warnings}`);
const result = await runAiForItem({ settings, runtime, data, item: null });
if (
  !result.notesSummary ||
  !result.notesSummary.markdown.includes("[A1](zotero://")
) {
  throw new Error(`notes summary failed: ${JSON.stringify(result)}`);
}
if (calls !== 1) throw new Error(`expected 1 call, got ${calls}`);

// No cache: second run calls again.
calls = 0;
await runAiForItem({ settings, runtime, data, item: null });
if (calls !== 1) throw new Error("cache-disabled run should call again");

// Cache enabled: second run should reuse.
const cacheSettings = makeSettings({ cacheEnabled: true });
const store = new MemoryStore();
const cacheRuntime = await createAiRuntime(cacheSettings, {
  client: fakeClient,
  cacheStore: store,
});
calls = 0;
const first = await runAiForItem({
  settings: cacheSettings,
  runtime: cacheRuntime,
  data,
  item: null,
});
if (calls !== 1) throw new Error("first cached run should call");
calls = 0;
const second = await runAiForItem({
  settings: cacheSettings,
  runtime: cacheRuntime,
  data,
  item: null,
});
if (calls !== 0 || !second.notesSummary?.cached)
  throw new Error("cache hit failed");

// Existing body marker reuse.
const existingBody = wrapAiSection(
  "notes-summary",
  first.notesSummary!.hash,
  first.notesSummary!.markdown,
);
const store2 = new MemoryStore();
const reuseRuntime = await createAiRuntime(cacheSettings, {
  client: fakeClient,
  cacheStore: store2,
});
calls = 0;
const reused = await runAiForItem({
  settings: cacheSettings,
  runtime: reuseRuntime,
  data,
  item: null,
  existingBody,
});
if (calls !== 0 || !reused.notesSummary?.cached) {
  throw new Error("existing marker reuse failed");
}

// Organize only without citations must fail and not produce a section.
calls = 0;
const onlySettings = makeSettings({
  notesSummaryEnabled: false,
  organizeEnabled: true,
  organizeMode: "only",
});
const onlyRuntime = await createAiRuntime(onlySettings, {
  client: {
    chat: async () => ({ text: "<ai_output>\n### No cites\n</ai_output>" }),
  } as any,
});
const onlyResult = await runAiForItem({
  settings: onlySettings,
  runtime: onlyRuntime,
  data,
  item: null,
});
if (onlyResult.organized)
  throw new Error("uncited organize should not produce a section");
if (!onlyResult.warnings.some((warning) => warning.includes("citations"))) {
  throw new Error(`missing citation warning: ${JSON.stringify(onlyResult)}`);
}

// Organize only with a citation succeeds.
const citeSettings = makeSettings({
  notesSummaryEnabled: false,
  organizeEnabled: true,
  organizeMode: "only",
});
const citeRuntime = await createAiRuntime(citeSettings, { client: fakeClient });
const citeResult = await runAiForItem({
  settings: citeSettings,
  runtime: citeRuntime,
  data,
  item: null,
});
if (!citeResult.organized?.markdown.includes("[A1](zotero://")) {
  throw new Error("cited organize did not succeed");
}

// Failure retains a stale existing section.
const failingSettings = makeSettings({
  notesSummaryEnabled: false,
  organizeEnabled: true,
  organizeMode: "keep",
  cacheEnabled: false,
});
const failingRuntime = await createAiRuntime(failingSettings, {
  client: {
    chat: async () => {
      throw new Error("API down");
    },
  } as any,
});
const staleBody = wrapAiSection(
  "notes-organize",
  citeResult.organized!.hash,
  citeResult.organized!.markdown,
);
const stale = await runAiForItem({
  settings: failingSettings,
  runtime: failingRuntime,
  data,
  item: null,
  existingBody: staleBody,
});
if (!stale.organized?.degraded || !stale.organized.markdown.includes("Claim")) {
  throw new Error(`stale fallback failed: ${JSON.stringify(stale)}`);
}

// Section marker parsing.
const parsed = parseAiSections(staleBody);
if (
  !parsed.has("notes-organize") ||
  parsed.get("notes-organize")?.markdown !== citeResult.organized!.markdown
) {
  throw new Error("section parsing failed");
}

console.log("AI orchestrator tests: OK");
