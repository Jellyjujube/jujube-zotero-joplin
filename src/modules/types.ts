export type ExportLocationMode = "ask" | "default";
export type DefaultLocationSource = "fixed" | "collections";
export type Language = "zh-CN" | "en-US";
export type LanguagePreference = "auto" | Language;

export type AiProvider = "openai" | "ollama" | "lmstudio" | "custom";
export type AiOrganizeMode = "keep" | "only";
export type AiOutputLanguage = "ui" | "zh-CN" | "en-US";
export type AiFeatureId = "pdf-summary" | "notes-summary" | "notes-organize";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  extraHeaders: string;
  extraHeadersError?: string;
  timeoutMs: number;
  maxRetries: number;
  outputLanguage: AiOutputLanguage;
  pdfSummaryEnabled: boolean;
  pdfSummaryPrompt: string;
  notesSummaryEnabled: boolean;
  notesSummaryPrompt: string;
  organizeEnabled: boolean;
  organizePrompt: string;
  organizeMode: AiOrganizeMode;
  chunkSizeChars: number;
  maxPdfChars: number;
  maxNotesChars: number;
  annotationContextEnabled: boolean;
  annotationContextChars: number;
  cacheEnabled: boolean;
}

export interface PluginSettings {
  joplinBaseUrl: string;
  joplinToken: string;
  notebookName: string;
  exportLocationMode: ExportLocationMode;
  defaultLocationSource: DefaultLocationSource;
  includeImages: boolean;
  includeAbstract: boolean;
  includeTags: boolean;
  language: Language;
  ai: AiSettings;
}

export type ExportMode = "all" | "notes" | "annotations";

export type NoteKind = "literature" | "notes" | "annotations";

export interface CreatorInfo {
  firstName: string;
  lastName: string;
  name: string;
  role: string;
}

export interface AnnotationData {
  key: string;
  type: string;
  text: string;
  comment: string;
  color: string;
  pageLabel: string;
  pageIndex: number;
  sortIndex: string;
  tags: string[];
  imageDataUri?: string;
}

export type AttachmentTextSource =
  "attachment-text" | "fulltext-cache" | "unavailable";

export interface AttachmentFullText {
  text: string;
  pages?: string[];
  source: AttachmentTextSource;
  charCount: number;
  truncated: boolean;
  error?: string;
}

export interface AttachmentData {
  key: string;
  itemID?: number;
  title: string;
  contentType: string;
  filename: string;
  uri: string;
  annotations: AnnotationData[];
  fullText?: AttachmentFullText;
}

export interface NoteData {
  key: string;
  title: string;
  html: string;
  markdown: string;
  uri: string;
}

export interface ItemData {
  key: string;
  version: number;
  itemType: string;
  libraryID: number;
  libraryType: string;
  groupID?: number;
  title: string;
  creators: CreatorInfo[];
  date: string;
  year: string;
  publicationTitle: string;
  journalAbbreviation: string;
  DOI: string;
  url: string;
  abstractNote: string;
  tags: string[];
  collections: string[];
  citekey: string;
  notes: NoteData[];
  attachments: AttachmentData[];
  itemURI: string;
}

export interface SyncSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  warnings: string[];
}
