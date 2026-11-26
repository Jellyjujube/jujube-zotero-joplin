import {
  AiFeatureId,
  AiOrganizeMode,
  AiOutputLanguage,
  AiProvider,
  AiSettings,
  Language,
} from "./types";

// Notes summary and AI organization are temporarily disabled while we
// iterate on better annotation context. Keep the implementation for later.
export const AI_NOTES_FEATURES_ENABLED = false;

export const AI_CACHE_SCHEMA_VERSION = 1;
export const SYSTEM_PROMPT_VERSION = 2;
export const AI_PROMPT_VERSION = 1;

export interface AiProviderPreset {
  baseUrl: string;
  modelPlaceholder: string;
}

export const AI_PROVIDER_PRESETS: Record<AiProvider, AiProviderPreset> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelPlaceholder: "gpt-4o-mini",
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    modelPlaceholder: "llama3.1",
  },
  lmstudio: {
    baseUrl: "http://127.0.0.1:1234/v1",
    modelPlaceholder: "local-model",
  },
  custom: {
    baseUrl: "",
    modelPlaceholder: "",
  },
};

export function createDefaultAiSettings(): AiSettings {
  return {
    enabled: false,
    provider: "openai",
    baseUrl: AI_PROVIDER_PRESETS.openai.baseUrl,
    apiKey: "",
    model: AI_PROVIDER_PRESETS.openai.modelPlaceholder,
    temperature: 0.2,
    maxTokens: 8192,
    extraHeaders: "{}",
    timeoutMs: 120000,
    maxRetries: 2,
    outputLanguage: "ui",
    pdfSummaryEnabled: false,
    pdfSummaryPrompt: "",
    notesSummaryEnabled: false,
    notesSummaryPrompt: "",
    organizeEnabled: false,
    organizePrompt: "",
    organizeMode: "keep",
    chunkSizeChars: 16000,
    maxPdfChars: 320000,
    maxNotesChars: 200000,
    annotationContextEnabled: false,
    annotationContextChars: 500,
    cacheEnabled: true,
  };
}

export function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeProvider(value: unknown): AiProvider {
  const raw = String(value || "");
  return raw === "ollama" || raw === "lmstudio" || raw === "custom"
    ? raw
    : "openai";
}

export function normalizeOrganizeMode(value: unknown): AiOrganizeMode {
  return String(value) === "only" ? "only" : "keep";
}

export function normalizeOutputLanguage(value: unknown): AiOutputLanguage {
  const raw = String(value || "");
  return raw === "zh-CN" || raw === "en-US" ? raw : "ui";
}

export function resolveAiOutputLanguage(
  ai: AiSettings,
  uiLanguage: Language,
): Language {
  return ai.outputLanguage === "ui" ? uiLanguage : ai.outputLanguage;
}

export function parseExtraHeaders(raw: string): {
  headers: Record<string, string>;
  error?: string;
} {
  const value = String(raw || "").trim();
  if (!value) return { headers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { headers: {}, error: "invalid-json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { headers: {}, error: "not-an-object" };
  }
  const headers: Record<string, string> = {};
  const validName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  for (const [name, headerValue] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!validName.test(name)) {
      return { headers: {}, error: `invalid-name:${name}` };
    }
    if (
      typeof headerValue !== "string" &&
      typeof headerValue !== "number" &&
      typeof headerValue !== "boolean"
    ) {
      return { headers: {}, error: `invalid-value:${name}` };
    }
    headers[name] = String(headerValue);
  }
  return { headers };
}

export function normalizeModelsUrl(baseUrl: string): string {
  let base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  base = base.replace(/\/chat\/completions$/i, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

export function normalizeChatCompletionsUrl(baseUrl: string): string {
  let base = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function isAiFeatureEnabled(
  ai: AiSettings,
  feature: AiFeatureId,
): boolean {
  if (!ai.enabled) return false;
  if (feature === "pdf-summary") return ai.pdfSummaryEnabled;
  if (feature === "notes-summary") return ai.notesSummaryEnabled;
  return ai.organizeEnabled;
}

export function hasAnyAiFeature(ai: AiSettings): boolean {
  return (
    ai.enabled &&
    (ai.pdfSummaryEnabled || ai.notesSummaryEnabled || ai.organizeEnabled)
  );
}

export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const value = String(text || "");
  const max = Math.max(0, Math.floor(maxChars));
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}
