import { AiFeatureId } from "./types";

export interface AiModelInfo {
  id: string;
  contextLength?: number;
  maxOutputTokens?: number;
}

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiItemContext {
  title: string;
  abstract: string;
}

export interface AiSource {
  marker: string;
  kind: "annotation" | "note";
  label: string;
  text: string;
  uri: string;
  pageLabel?: string;
  annotationType?: string;
  color?: string;
  tags: string[];
}

export interface SourceRegistry {
  sources: AiSource[];
  byMarker: Map<string, AiSource>;
  truncated: boolean;
}

export interface ParsedAiOutput {
  markdown: string;
  warnings: string[];
}

export interface AiSectionSummary {
  feature: AiFeatureId;
  hash: string;
  markdown: string;
  cached: boolean;
  degraded: boolean;
}

export interface AiResult {
  pdfSummary?: AiSectionSummary;
  notesSummary?: AiSectionSummary;
  organized?: AiSectionSummary;
  warnings: string[];
  errors: string[];
}
