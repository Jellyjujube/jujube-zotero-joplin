import {
  AI_CACHE_SCHEMA_VERSION,
  SYSTEM_PROMPT_VERSION,
  AI_PROMPT_VERSION,
} from "./aiConfig";
import { hashJson } from "../utils/hash";
import { AiFeatureId } from "./types";

export interface AiCacheEntry {
  feature: AiFeatureId;
  hash: string;
  output: string;
  createdAt: number;
  model: string;
  sourceChars: number;
}

export interface AiCacheData {
  version: number;
  entries: Record<string, AiCacheEntry>;
}

export interface AiCacheStore {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  clear?(): Promise<void>;
}

export function createZoteroAiCacheStore(
  fileName = "zotero-joplin-ai-cache.json",
): AiCacheStore {
  const path = () => `${(Zotero as any).DataDirectory.dir}/${fileName}`;
  const file = () => (Zotero as any).File.pathToFile(path());
  return {
    async read() {
      try {
        const text = await Zotero.File.getContentsAsync(file(), "utf-8");
        return String(text || "");
      } catch {
        return null;
      }
    },
    async write(text) {
      await Zotero.File.putContentsAsync(file(), text, "utf-8");
    },
    async clear() {
      try {
        await Zotero.File.removeIfExists(path());
      } catch {
        // Ignore missing cache files.
      }
    },
  };
}

export class AiCache {
  private data: AiCacheData = {
    version: AI_CACHE_SCHEMA_VERSION,
    entries: {},
  };
  private dirty = false;

  constructor(
    private store: AiCacheStore,
    private options: { maxEntries?: number; now?: () => number } = {},
  ) {}

  async load(): Promise<void> {
    const raw = await this.store.read();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AiCacheData;
      if (
        parsed &&
        parsed.version === AI_CACHE_SCHEMA_VERSION &&
        parsed.entries &&
        typeof parsed.entries === "object"
      ) {
        this.data = parsed;
      }
    } catch {
      this.data = { version: AI_CACHE_SCHEMA_VERSION, entries: {} };
    }
  }

  get(hash: string): string | null {
    const entry = this.data.entries[hash];
    return entry ? entry.output : null;
  }

  set(hash: string, entry: Omit<AiCacheEntry, "hash" | "createdAt">): void {
    this.data.entries[hash] = {
      ...entry,
      hash,
      createdAt: (this.options.now || Date.now)(),
    };
    this.prune();
    this.dirty = true;
  }

  private prune(): void {
    const max = Math.max(1, Math.floor(this.options.maxEntries ?? 500));
    const entries = Object.values(this.data.entries);
    if (entries.length <= max) return;
    entries
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, entries.length - max)
      .forEach((entry) => {
        delete this.data.entries[entry.hash];
      });
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await this.store.write(JSON.stringify(this.data));
    this.dirty = false;
  }

  async clear(): Promise<void> {
    this.data = { version: AI_CACHE_SCHEMA_VERSION, entries: {} };
    this.dirty = false;
    if (this.store.clear) await this.store.clear();
    else await this.store.write(JSON.stringify(this.data));
  }
}

export async function computeAiCacheKey(parts: {
  feature: AiFeatureId;
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraHeaders: Record<string, string>;
  outputLanguage: string;
  userPrompt: string;
  sourceHash: string;
  chunkSizeChars: number;
  maxPdfChars: number;
  maxNotesChars: number;
  annotationContextChars?: number;
}): Promise<string> {
  const headers = Object.fromEntries(
    Object.entries(parts.extraHeaders || {})
      .filter(([name]) => name.toLowerCase() !== "authorization")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return hashJson({
    schema: AI_CACHE_SCHEMA_VERSION,
    systemPrompt: SYSTEM_PROMPT_VERSION,
    promptVersion: AI_PROMPT_VERSION,
    feature: parts.feature,
    provider: parts.provider,
    baseUrl: parts.baseUrl,
    model: parts.model,
    temperature: parts.temperature,
    maxTokens: parts.maxTokens,
    extraHeaders: headers,
    outputLanguage: parts.outputLanguage,
    userPrompt: parts.userPrompt,
    sourceHash: parts.sourceHash,
    chunkSizeChars: parts.chunkSizeChars,
    maxPdfChars: parts.maxPdfChars,
    maxNotesChars: parts.maxNotesChars,
    annotationContextChars: parts.annotationContextChars ?? 0,
  });
}
