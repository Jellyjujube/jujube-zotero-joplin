import { AiClient, AiClientConfig, AiError, AiRequestFn } from "./aiClient";
import {
  AiCache,
  AiCacheStore,
  computeAiCacheKey,
  createZoteroAiCacheStore,
} from "./aiCache";
import {
  groupByCharBudget,
  joinWithBudget,
  splitTextIntoChunks,
} from "./aiChunking";
import {
  resolveAiOutputLanguage,
  hasAnyAiFeature,
  parseExtraHeaders,
} from "./aiConfig";
import {
  buildItemContext,
  buildNotesReduceMessages,
  buildNotesSummaryMessages,
  buildOrganizeMessages,
  buildPdfMapMessages,
  buildPdfSummaryMessages,
  buildReduceMessages,
  buildSourceRegistry,
  expandCitations,
  getEffectiveUserPrompt,
  parseAiOutput,
  sanitizeAiMarkdown,
} from "./aiPrompts";
import { hashPrefix, parseAiSections } from "./aiSections";
import { t } from "./i18n";
import {
  AiItemContext,
  AiSectionSummary,
  AiResult,
  SourceRegistry,
} from "./aiTypes";
import { collectPdfFullText, PdfTextDocument } from "./aiFulltext";
import { hashJson, sha256Hex } from "../utils/hash";
import { logInfo, logWarn } from "../utils/logger";
import {
  AiFeatureId,
  AiSettings,
  ItemData,
  Language,
  PluginSettings,
} from "./types";

export interface AiRuntimeOverrides {
  client?: AiClient;
  cacheStore?: AiCacheStore;
  requestFn?: AiRequestFn;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AiRuntime {
  enabled: boolean;
  language: Language;
  settings: PluginSettings;
  client: AiClient | null;
  cache: AiCache | null;
  warnings: string[];
}

export interface RunAiOptions {
  settings: PluginSettings;
  runtime: AiRuntime;
  data: ItemData;
  item: Zotero.Item | null;
  existingBody?: string;
  onProgress?: (message: string) => void;
}

const EMPTY_REGISTRY: SourceRegistry = {
  sources: [],
  byMarker: new Map(),
  truncated: false,
};

export async function createAiRuntime(
  settings: PluginSettings,
  overrides: AiRuntimeOverrides = {},
): Promise<AiRuntime> {
  const ai = settings.ai;
  const language = resolveAiOutputLanguage(ai, settings.language);
  const warnings: string[] = [];
  if (!ai.enabled || !hasAnyAiFeature(ai)) {
    return {
      enabled: false,
      language,
      settings,
      client: null,
      cache: null,
      warnings,
    };
  }

  const parsedHeaders = parseExtraHeaders(ai.extraHeaders);
  if (parsedHeaders.error) {
    warnings.push(
      t(language, "ai.warn.invalidHeaders", {
        error: parsedHeaders.error,
      }),
    );
    return {
      enabled: false,
      language,
      settings,
      client: null,
      cache: null,
      warnings,
    };
  }
  if (!ai.baseUrl.trim()) {
    warnings.push(t(language, "ai.warn.noBaseUrl"));
    return {
      enabled: false,
      language,
      settings,
      client: null,
      cache: null,
      warnings,
    };
  }
  if (!ai.model.trim()) {
    warnings.push(t(language, "ai.warn.noModel"));
    return {
      enabled: false,
      language,
      settings,
      client: null,
      cache: null,
      warnings,
    };
  }
  if (ai.provider === "openai" && !ai.apiKey) {
    warnings.push(t(language, "ai.warn.noApiKey"));
    return {
      enabled: false,
      language,
      settings,
      client: null,
      cache: null,
      warnings,
    };
  }

  const client =
    overrides.client ||
    new AiClient({
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: ai.maxTokens,
      extraHeaders: parsedHeaders.headers,
      timeoutMs: ai.timeoutMs,
      maxRetries: ai.maxRetries,
      requestFn: overrides.requestFn,
      sleepFn: overrides.sleepFn,
    } as AiClientConfig);

  let cache: AiCache | null = null;
  if (ai.cacheEnabled) {
    cache = new AiCache(overrides.cacheStore || createZoteroAiCacheStore(), {
      now: overrides.now,
    });
    await cache.load();
  }

  return {
    enabled: true,
    language,
    settings,
    client,
    cache,
    warnings,
  };
}

export async function flushAiRuntime(runtime: AiRuntime): Promise<void> {
  await runtime.cache?.flush();
}

function parseAndSanitize(raw: string): {
  markdown: string;
  warnings: string[];
} {
  const parsed = parseAiOutput(raw);
  return {
    markdown: sanitizeAiMarkdown(parsed.markdown),
    warnings: parsed.warnings,
  };
}

async function chatText(runtime: AiRuntime, messages: any[]): Promise<string> {
  if (!runtime.client) throw new Error("AI client is not configured");
  const result = await runtime.client.chat(messages);
  return result.text;
}

function reduceBudget(chunkSizeChars: number): number {
  return Math.max(2 * chunkSizeChars, 32000);
}

function hasCitationLink(markdown: string): boolean {
  return /\[[AN]\d+\]\(zotero:\/\//.test(String(markdown || ""));
}

async function summarizePdf(
  runtime: AiRuntime,
  ai: AiSettings,
  data: ItemData,
  pdf: PdfTextDocument,
  itemContext: AiItemContext,
  userPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const overlap = Math.min(800, Math.floor(ai.chunkSizeChars * 0.05));
  const chunks = splitTextIntoChunks(pdf.text, ai.chunkSizeChars, overlap);
  if (!chunks.length) throw new Error("PDF has no text");
  await logInfo(
    `AI PDF item ${data.key}: ${pdf.charCount} chars, ${chunks.length} chunk(s), overlap ${overlap}`,
  );
  if (chunks.length === 1) {
    onProgress?.(
      t(runtime.language, "progress.aiPdf", { title: pdf.attachmentTitle }),
    );
    const raw = await chatText(
      runtime,
      buildPdfSummaryMessages({
        item: itemContext,
        language: runtime.language,
        userPrompt,
        chunk: chunks[0],
        chunkIndex: 0,
        chunkTotal: 1,
        attachmentTitle: pdf.attachmentTitle,
      }),
    );
    const parsed = parseAndSanitize(raw);
    if (!parsed.markdown) throw new Error("AI PDF summary was empty");
    return parsed.markdown;
  }

  const partials: string[] = [];
  for (const chunk of chunks) {
    onProgress?.(
      t(runtime.language, "progress.aiPdfChunk", {
        index: chunk.index + 1,
        total: chunks.length,
      }),
    );
    const raw = await chatText(
      runtime,
      buildPdfMapMessages({
        item: itemContext,
        language: runtime.language,
        chunk,
        chunkIndex: chunk.index,
        chunkTotal: chunks.length,
        attachmentTitle: pdf.attachmentTitle,
      }),
    );
    const parsed = parseAndSanitize(raw);
    if (!parsed.markdown) throw new Error("AI PDF chunk summary was empty");
    partials.push(parsed.markdown);
  }

  let current = partials;
  const budget = reduceBudget(ai.chunkSizeChars);
  let rounds = 0;
  while (
    current.join("\n\n").length > budget &&
    rounds < 3 &&
    current.length > 1
  ) {
    onProgress?.(t(runtime.language, "progress.aiPdfReduce"));
    const groups = joinWithBudget(current, (part) => part, budget);
    const next: string[] = [];
    for (const group of groups) {
      const raw = await chatText(
        runtime,
        buildReduceMessages({
          item: itemContext,
          language: runtime.language,
          userPrompt,
          partials: [group],
          phase: "intermediate",
        }),
      );
      const parsed = parseAndSanitize(raw);
      if (!parsed.markdown) throw new Error("AI PDF reduce was empty");
      next.push(parsed.markdown);
    }
    current = next;
    rounds++;
  }

  onProgress?.(t(runtime.language, "progress.aiPdfReduce"));
  const raw = await chatText(
    runtime,
    buildReduceMessages({
      item: itemContext,
      language: runtime.language,
      userPrompt,
      partials: current,
      phase: "final",
    }),
  );
  const parsed = parseAndSanitize(raw);
  if (!parsed.markdown) throw new Error("AI PDF summary was empty");
  return parsed.markdown;
}

async function summarizeSources(
  runtime: AiRuntime,
  ai: AiSettings,
  feature: "notes-summary" | "notes-organize",
  registry: SourceRegistry,
  itemContext: AiItemContext,
  userPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  if (!registry.sources.length) throw new Error("No notes or annotations");
  const groups = groupByCharBudget(
    registry.sources,
    (source) => source.text,
    ai.chunkSizeChars,
  );
  const build =
    feature === "notes-summary"
      ? buildNotesSummaryMessages
      : buildOrganizeMessages;

  if (groups.length === 1) {
    onProgress?.(
      t(
        runtime.language,
        feature === "notes-summary"
          ? "progress.aiNotes"
          : "progress.aiOrganize",
      ),
    );
    const raw = await chatText(
      runtime,
      build({
        item: itemContext,
        language: runtime.language,
        userPrompt,
        sources: groups[0],
        partIndex: 0,
        partTotal: 1,
      }),
    );
    const parsed = parseAndSanitize(raw);
    if (!parsed.markdown) throw new Error("AI notes output was empty");
    return parsed.markdown;
  }

  const partials: string[] = [];
  for (let index = 0; index < groups.length; index++) {
    onProgress?.(
      t(runtime.language, "progress.aiGroup", {
        index: index + 1,
        total: groups.length,
      }),
    );
    const raw = await chatText(
      runtime,
      build({
        item: itemContext,
        language: runtime.language,
        userPrompt,
        sources: groups[index],
        partIndex: index,
        partTotal: groups.length,
      }),
    );
    const parsed = parseAndSanitize(raw);
    if (!parsed.markdown) throw new Error("AI notes partial output was empty");
    partials.push(parsed.markdown);
  }

  let current = partials;
  const budget = reduceBudget(ai.chunkSizeChars);
  let rounds = 0;
  while (
    current.join("\n\n").length > budget &&
    rounds < 3 &&
    current.length > 1
  ) {
    onProgress?.(t(runtime.language, "progress.aiNotesReduce"));
    const groups2 = joinWithBudget(current, (part) => part, budget);
    const next: string[] = [];
    for (const group of groups2) {
      const raw = await chatText(
        runtime,
        buildNotesReduceMessages({
          feature,
          item: itemContext,
          language: runtime.language,
          userPrompt,
          partials: [group],
          phase: "intermediate",
        }),
      );
      const parsed = parseAndSanitize(raw);
      if (!parsed.markdown) throw new Error("AI notes reduce was empty");
      next.push(parsed.markdown);
    }
    current = next;
    rounds++;
  }

  const raw = await chatText(
    runtime,
    buildNotesReduceMessages({
      feature,
      item: itemContext,
      language: runtime.language,
      userPrompt,
      partials: current,
      phase: "final",
    }),
  );
  const parsed = parseAndSanitize(raw);
  if (!parsed.markdown) throw new Error("AI notes output was empty");
  return parsed.markdown;
}

function featureSourceChars(
  feature: AiFeatureId,
  pdf: PdfTextDocument | undefined,
  registry: SourceRegistry,
): number {
  if (feature === "pdf-summary") return pdf?.charCount || 0;
  return registry.sources.reduce((sum, source) => sum + source.text.length, 0);
}

function featureSourceHash(
  feature: AiFeatureId,
  pdf: PdfTextDocument | undefined,
  registry: SourceRegistry,
): Promise<string> {
  if (feature === "pdf-summary") {
    return sha256Hex(`${pdf?.attachmentKey || ""}\n${pdf?.text || ""}`);
  }
  return hashJson(
    registry.sources.map((source) => ({
      marker: source.marker,
      kind: source.kind,
      text: source.text,
      uri: source.uri,
    })),
  );
}

export async function runAiForItem(options: RunAiOptions): Promise<AiResult> {
  const { settings, runtime, data, item, existingBody, onProgress } = options;
  const result: AiResult = { warnings: [], errors: [] };
  const ai = settings.ai;
  if (!runtime.enabled) return result;

  const existingSections = parseAiSections(existingBody || "");
  const itemContext = buildItemContext(data);
  const parsedHeaders = parseExtraHeaders(ai.extraHeaders);

  let pdf: PdfTextDocument | undefined;
  let pdfDocuments: PdfTextDocument[] = [];
  let registry: SourceRegistry = EMPTY_REGISTRY;
  const notesFeatures = ai.notesSummaryEnabled || ai.organizeEnabled;
  const wantsAnnotationContext =
    notesFeatures &&
    ai.annotationContextEnabled &&
    data.attachments.some((attachment) =>
      attachment.annotations.some(
        (annotation) => String(annotation.text || "").trim().length >= 3,
      ),
    );
  const needPdfText = ai.pdfSummaryEnabled || wantsAnnotationContext;

  if (needPdfText) {
    if (!item) {
      result.warnings.push(t(runtime.language, "ai.warn.noItem"));
      if (wantsAnnotationContext) {
        result.warnings.push(
          t(runtime.language, "ai.warn.noAnnotationContext"),
        );
      }
    } else {
      try {
        onProgress?.(t(runtime.language, "progress.aiReadingPdf"));
        const documents = await collectPdfFullText(item, data, {
          maxChars: ai.maxPdfChars,
        });
        pdfDocuments = documents;
        pdf = documents[0];
        if (!pdf) {
          if (ai.pdfSummaryEnabled) {
            result.warnings.push(t(runtime.language, "ai.warn.noPdfText"));
          }
          if (wantsAnnotationContext) {
            result.warnings.push(
              t(runtime.language, "ai.warn.noAnnotationContext"),
            );
          }
        } else if (pdf.truncated && ai.pdfSummaryEnabled) {
          result.warnings.push(t(runtime.language, "ai.warn.pdfTruncated"));
        }
      } catch (error) {
        result.warnings.push(
          t(runtime.language, "ai.warn.pdfExtractFailed", {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  if (notesFeatures) {
    const contextByAttachment = new Map<string, string>();
    if (pdf && ai.annotationContextEnabled) {
      contextByAttachment.set(pdf.attachmentKey, pdf.text);
    }
    registry = buildSourceRegistry(data, {
      totalChars: ai.maxNotesChars,
      contextByAttachment,
      contextChars: ai.annotationContextEnabled ? ai.annotationContextChars : 0,
    });
    if (!registry.sources.length) {
      result.warnings.push(t(runtime.language, "ai.warn.noSources"));
    } else if (registry.truncated) {
      result.warnings.push(t(runtime.language, "ai.warn.notesTruncated"));
    }
  }

  const runFeature = async (
    feature: AiFeatureId,
    runner: (userPrompt: string) => Promise<string>,
  ): Promise<AiSectionSummary | undefined> => {
    const userPrompt = getEffectiveUserPrompt(ai, feature, runtime.language);
    const sourceHash = await featureSourceHash(feature, pdf, registry);
    const sourceChars = featureSourceChars(feature, pdf, registry);
    const cacheKey = await computeAiCacheKey({
      feature,
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: ai.maxTokens,
      extraHeaders: parsedHeaders.headers,
      outputLanguage: runtime.language,
      userPrompt,
      sourceHash,
      chunkSizeChars: ai.chunkSizeChars,
      maxPdfChars: ai.maxPdfChars,
      maxNotesChars: ai.maxNotesChars,
      annotationContextChars: ai.annotationContextChars,
    });
    const prefix = hashPrefix(cacheKey);
    const existing = existingSections.get(feature);
    const requiresCitation =
      feature === "notes-organize" &&
      ai.organizeMode === "only" &&
      registry.sources.length > 0;

    if (
      ai.cacheEnabled &&
      existing &&
      existing.hash === prefix &&
      existing.markdown &&
      (!requiresCitation || hasCitationLink(existing.markdown))
    ) {
      return {
        feature,
        hash: prefix,
        markdown: existing.markdown,
        cached: true,
        degraded: false,
      };
    }
    if (ai.cacheEnabled && runtime.cache) {
      const cached = runtime.cache.get(cacheKey);
      if (cached && (!requiresCitation || hasCitationLink(cached))) {
        return {
          feature,
          hash: prefix,
          markdown: cached,
          cached: true,
          degraded: false,
        };
      }
    }

    try {
      const raw = await runner(userPrompt);
      const parsed = parseAiOutput(raw);
      const clean = sanitizeAiMarkdown(parsed.markdown);
      if (!clean) throw new Error("AI response was empty");
      const expanded = expandCitations(clean, registry);
      if (
        feature === "notes-organize" &&
        registry.sources.length > 0 &&
        expanded.used.length === 0
      ) {
        if (ai.organizeMode === "only") {
          throw new Error("AI organize output has no source citations");
        }
        result.warnings.push(
          t(runtime.language, "ai.warn.organizeNoCitations"),
        );
      }
      if (parsed.warnings.includes("missing-output-tag")) {
        result.warnings.push(t(runtime.language, "ai.warn.missingOutputTag"));
      }
      if (parsed.warnings.includes("empty-response")) {
        result.warnings.push(t(runtime.language, "ai.warn.emptyResponse"));
      }
      if (expanded.unknown.length) {
        result.warnings.push(
          t(runtime.language, "ai.warn.unknownCitations", {
            markers: expanded.unknown.join(", "),
          }),
        );
      }
      await logInfo(
        `AI ${feature}: generated ${expanded.markdown.length} chars, ${expanded.used.length} cited source(s)`,
      );
      if (ai.cacheEnabled && runtime.cache) {
        runtime.cache.set(cacheKey, {
          feature,
          output: expanded.markdown,
          model: ai.model,
          sourceChars,
        });
      }
      return {
        feature,
        hash: prefix,
        markdown: expanded.markdown,
        cached: false,
        degraded: false,
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      result.errors.push(message);
      await logWarn(`AI ${feature} failed: ${message}`);
      if (caught instanceof AiError && caught.code === "truncated") {
        result.warnings.push(t(runtime.language, "ai.warn.truncated"));
      } else {
        result.warnings.push(
          t(runtime.language, "ai.warn.featureFailed", {
            feature,
            error: message,
          }),
        );
      }
      if (
        existing &&
        existing.markdown &&
        (!requiresCitation || hasCitationLink(existing.markdown))
      ) {
        return {
          feature,
          hash: existing.hash,
          markdown: existing.markdown,
          cached: true,
          degraded: true,
        };
      }
      return undefined;
    }
  };

  if (ai.pdfSummaryEnabled && pdf) {
    const section = await runFeature("pdf-summary", (userPrompt) =>
      summarizePdf(
        runtime,
        ai,
        data,
        pdf!,
        itemContext,
        userPrompt,
        onProgress,
      ),
    );
    if (section) result.pdfSummary = section;
  }

  if (ai.notesSummaryEnabled && registry.sources.length) {
    const section = await runFeature("notes-summary", (userPrompt) =>
      summarizeSources(
        runtime,
        ai,
        "notes-summary",
        registry,
        itemContext,
        userPrompt,
        onProgress,
      ),
    );
    if (section) result.notesSummary = section;
  }

  if (ai.organizeEnabled && registry.sources.length) {
    const section = await runFeature("notes-organize", (userPrompt) =>
      summarizeSources(
        runtime,
        ai,
        "notes-organize",
        registry,
        itemContext,
        userPrompt,
        onProgress,
      ),
    );
    if (section) result.organized = section;
  }

  return result;
}

export function emptyAiResult(): AiResult {
  return { warnings: [], errors: [] };
}
