import { truncateText } from "./aiConfig";
import { AttachmentData, AttachmentFullText, ItemData } from "./types";

export interface FullTextOptions {
  maxChars: number;
  ensureIndexed?: boolean;
  perAttachmentTimeoutMs?: number;
  indexTimeoutMs?: number;
}

export interface PdfTextDocument {
  attachmentKey: string;
  attachmentTitle: string;
  text: string;
  pages?: string[];
  truncated: boolean;
  source: AttachmentFullText["source"];
  charCount: number;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      },
      Math.max(1, timeoutMs),
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function normalizeFullText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\u0000")
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isPdfAttachment(attachment: Zotero.Item): boolean {
  try {
    if ((attachment as any).isPDFAttachment?.()) return true;
    const contentType = String(
      (attachment as any).attachmentContentType || "",
    ).toLowerCase();
    const filename = String(
      (attachment as any).attachmentFilename || "",
    ).toLowerCase();
    return contentType.includes("pdf") || filename.endsWith(".pdf");
  } catch {
    return false;
  }
}

async function ensureIndexed(
  attachment: Zotero.Item,
  timeoutMs: number,
): Promise<void> {
  const fulltext = (Zotero as any)?.Fulltext || (Zotero as any)?.FullText;
  if (!fulltext) return;
  try {
    if (await fulltext.isFullyIndexed?.(attachment)) return;
    if (!fulltext.canIndex?.(attachment)) return;
    await withTimeout(
      Promise.resolve(
        fulltext.indexItems?.([attachment.id], {
          complete: true,
          ignoreErrors: true,
        }),
      ),
      timeoutMs,
      "Full-text indexing",
    );
  } catch {
    // Indexing failure is non-fatal; attachmentText may still extract text.
  }
}

async function readCacheFile(
  attachment: Zotero.Item,
): Promise<{ text: string; pages: string[] }> {
  const fulltext = (Zotero as any)?.Fulltext || (Zotero as any)?.FullText;
  if (!fulltext?.getItemCacheFile) return { text: "", pages: [] };
  try {
    const file = fulltext.getItemCacheFile(attachment);
    if (!file) return { text: "", pages: [] };
    const exists = typeof file.exists === "function" ? file.exists() : true;
    if (!exists) return { text: "", pages: [] };
    const raw = normalizeFullText(
      String(
        (await (Zotero as any).File.getContentsAsync(file, "utf-8")) || "",
      ),
    );
    const pages = raw
      .split("\f")
      .map((page) => page.trim())
      .filter(Boolean);
    return {
      text: raw.replace(/\f/g, "\n\n").trim(),
      pages,
    };
  } catch {
    return { text: "", pages: [] };
  }
}

export async function extractAttachmentFullText(
  attachment: Zotero.Item,
  budgetChars: number,
  options: FullTextOptions,
): Promise<AttachmentFullText> {
  const timeoutMs = options.perAttachmentTimeoutMs ?? 30000;
  let text = "";
  let source: AttachmentFullText["source"] = "unavailable";
  let error: string | undefined;

  if (options.ensureIndexed !== false) {
    await ensureIndexed(attachment, options.indexTimeoutMs ?? 20000);
  }

  const cached = await readCacheFile(attachment);
  if (cached.text) {
    text = cached.text;
    source = "fulltext-cache";
    error = undefined;
  } else {
    try {
      const value = await withTimeout(
        Promise.resolve((attachment as any).attachmentText),
        timeoutMs,
        "Full-text extraction",
      );
      text = normalizeFullText(String(value || ""));
      if (text) source = "attachment-text";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  if (!text) {
    return {
      text: "",
      pages: [],
      source: "unavailable",
      charCount: 0,
      truncated: false,
      error: error || "no-extractable-text",
    };
  }

  const truncated = truncateText(text, budgetChars);
  const pages = cached.pages.map(
    (page) => truncateText(page, budgetChars).text,
  );
  return {
    text: truncated.text,
    pages,
    source,
    charCount: truncated.text.length,
    truncated: truncated.truncated,
    error,
  };
}

export async function collectPdfFullText(
  item: Zotero.Item,
  data: ItemData,
  options: FullTextOptions,
): Promise<PdfTextDocument[]> {
  const documents: PdfTextDocument[] = [];
  let attachmentIDs: number[] | undefined;
  try {
    attachmentIDs = item.getAttachments() || [];
  } catch {
    return documents;
  }
  if (!attachmentIDs) return documents;

  for (const attachmentID of attachmentIDs) {
    let attachment: Zotero.Item | false;
    try {
      attachment = Zotero.Items.get(attachmentID);
    } catch {
      continue;
    }
    if (!attachment || !(attachment as any).isFileAttachment?.()) continue;
    if (!isPdfAttachment(attachment)) continue;

    const key = String((attachment as any).key || "");
    const match = data.attachments.find((entry) => entry.key === key);
    if (match && match.itemID === undefined) match.itemID = attachment.id;

    const budget = Math.max(1000, options.maxChars);
    const fullText = await extractAttachmentFullText(
      attachment,
      budget,
      options,
    );
    if (match) match.fullText = fullText;
    if (!fullText.text) continue;

    documents.push({
      attachmentKey: key,
      attachmentTitle:
        match?.title ||
        String((attachment as any).getDisplayTitle?.() || "PDF"),
      text: fullText.text,
      truncated: fullText.truncated,
      pages: fullText.pages,
      source: fullText.source,
      charCount: fullText.charCount,
    });
  }

  return documents;
}
