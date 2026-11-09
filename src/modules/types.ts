export interface PluginSettings {
  joplinBaseUrl: string;
  joplinToken: string;
  notebookName: string;
  includeImages: boolean;
  includeAbstract: boolean;
  includeTags: boolean;
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

export interface AttachmentData {
  key: string;
  title: string;
  contentType: string;
  filename: string;
  uri: string;
  annotations: AnnotationData[];
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
}
