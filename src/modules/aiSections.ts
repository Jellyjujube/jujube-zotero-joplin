import { AiFeatureId } from "./types";

export interface ExistingAiSection {
  feature: AiFeatureId;
  hash: string;
  markdown: string;
}

const FEATURES = new Set<string>([
  "pdf-summary",
  "notes-summary",
  "notes-organize",
]);

export function hashPrefix(fullHash: string, length = 16): string {
  return String(fullHash || "").slice(0, Math.max(1, length));
}

export function wrapAiSection(
  feature: AiFeatureId,
  hash: string,
  markdown: string,
): string {
  return [
    `<!-- zotero-joplin-ai:begin feature=${feature} hash=${hash} -->`,
    "",
    String(markdown || "").trim(),
    "",
    `<!-- zotero-joplin-ai:end feature=${feature} -->`,
  ].join("\n");
}

export function parseAiSections(
  body: string,
): Map<AiFeatureId, ExistingAiSection> {
  const result = new Map<AiFeatureId, ExistingAiSection>();
  const pattern =
    /<!--\s*zotero-joplin-ai:begin\s+feature=([^\s]+)\s+hash=([^\s]+)\s*-->([\s\S]*?)<!--\s*zotero-joplin-ai:end\s+feature=\1\s*-->/g;
  const value = String(body || "");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const feature = match[1];
    if (!FEATURES.has(feature)) continue;
    result.set(feature as AiFeatureId, {
      feature: feature as AiFeatureId,
      hash: match[2],
      markdown: match[3].trim(),
    });
  }
  return result;
}
