import {
  AiCache,
  AiCacheStore,
  computeAiCacheKey,
} from "../src/modules/aiCache";

class MemoryStore implements AiCacheStore {
  value: string | null = null;
  writes = 0;
  cleared = 0;
  async read() {
    return this.value;
  }
  async write(text: string) {
    this.value = text;
    this.writes++;
  }
  async clear() {
    this.value = null;
    this.cleared++;
  }
}

const baseParts = {
  feature: "pdf-summary" as const,
  provider: "openai",
  baseUrl: "https://api.example/v1",
  model: "m",
  temperature: 0.2,
  maxTokens: 128,
  extraHeaders: { "X-Test": "1", Authorization: "Bearer secret" },
  outputLanguage: "en-US",
  userPrompt: "prompt",
  sourceHash: "source",
  chunkSizeChars: 16000,
  maxPdfChars: 320000,
  maxNotesChars: 200000,
};
const key = await computeAiCacheKey(baseParts);
if (key.length !== 64) throw new Error("cache key length incorrect");
if (key !== (await computeAiCacheKey(baseParts)))
  throw new Error("cache key not stable");
if (key === (await computeAiCacheKey({ ...baseParts, model: "m2" })))
  throw new Error("model did not change key");
if (key === (await computeAiCacheKey({ ...baseParts, userPrompt: "p2" })))
  throw new Error("prompt did not change key");
if (
  key === (await computeAiCacheKey({ ...baseParts, outputLanguage: "zh-CN" }))
)
  throw new Error("language did not change key");
if (
  key !==
  (await computeAiCacheKey({
    ...baseParts,
    extraHeaders: { "X-Test": "1", authorization: "Bearer other" },
  }))
) {
  throw new Error("authorization header should not affect key");
}

const store = new MemoryStore();
let now = 1;
const cache = new AiCache(store, { maxEntries: 2, now: () => now++ });
await cache.load();
cache.set("a", {
  feature: "pdf-summary",
  output: "A",
  model: "m",
  sourceChars: 1,
});
cache.set("b", {
  feature: "pdf-summary",
  output: "B",
  model: "m",
  sourceChars: 1,
});
if (cache.get("a") !== "A") throw new Error("cache get failed");
cache.set("c", {
  feature: "pdf-summary",
  output: "C",
  model: "m",
  sourceChars: 1,
});
if (cache.get("a") !== null) throw new Error("LRU prune did not remove oldest");
if (cache.get("b") !== "B" || cache.get("c") !== "C")
  throw new Error("LRU prune removed wrong entry");
await cache.flush();
if (store.writes !== 1)
  throw new Error("cache flush wrote wrong number of times");
await cache.clear();
if (store.cleared !== 1 || store.value !== null)
  throw new Error("cache clear failed");

const corrupt = new MemoryStore();
corrupt.value = "not json";
const cache2 = new AiCache(corrupt);
await cache2.load();
cache2.set("x", {
  feature: "notes-summary",
  output: "X",
  model: "m",
  sourceChars: 1,
});
if (cache2.get("x") !== "X") throw new Error("corrupt cache reset failed");

console.log("AI cache tests: OK");
