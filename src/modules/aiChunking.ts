export interface TextChunk {
  index: number;
  text: string;
  start: number;
  end: number;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function findBoundary(
  text: string,
  start: number,
  end: number,
  maxChars: number,
): number {
  if (end >= text.length) return text.length;
  const lookback = Math.min(Math.floor(maxChars * 0.2), end - start);
  const min = Math.max(start + 1, end - lookback);
  const window = text.slice(min, end);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= 0) return min + paragraph + 2;

  const line = window.lastIndexOf("\n");
  if (line >= 0) return min + line + 1;

  const sentence = window.search(/[。！？.!?](?=\s|$)[^。！？.!?]*$/);
  if (sentence >= 0) return min + sentence + 1;

  const whitespace = window.search(/\s\S*$/);
  if (whitespace >= 0) return min + whitespace + 1;

  return end;
}

export function splitTextIntoChunks(
  text: string,
  maxChars: number,
  overlapChars = 0,
): TextChunk[] {
  const value = String(text || "");
  const max = Math.max(1, Math.floor(maxChars));
  if (!value.length) return [];
  if (value.length <= max) {
    return [{ index: 0, text: value, start: 0, end: value.length }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + max);
    if (end < value.length) {
      end = findBoundary(value, start, end, max);
      if (end <= start) end = Math.min(value.length, start + max);
      if (
        end < value.length &&
        end > start &&
        isHighSurrogate(value.charCodeAt(end - 1))
      ) {
        end--;
      }
    }
    if (end <= start) end = Math.min(value.length, start + max);

    chunks.push({
      index: chunks.length,
      text: value.slice(start, end),
      start,
      end,
    });
    if (end >= value.length) break;

    const overlap = Math.max(0, Math.floor(overlapChars));
    let next = Math.max(start + 1, end - overlap);
    if (next < end && isLowSurrogate(value.charCodeAt(next))) next++;
    start = next;
  }

  // Merge a tiny tail into the previous chunk.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    if (last.text.length < max * 0.2) {
      previous.text = value.slice(previous.start, last.end);
      previous.end = last.end;
      chunks.pop();
    }
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

export function groupByCharBudget<T>(
  items: T[],
  getText: (item: T) => string,
  budgetChars: number,
): T[][] {
  const budget = Math.max(1, Math.floor(budgetChars));
  const groups: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const item of items) {
    const length = String(getText(item) || "").length;
    if (current.length && currentChars + length > budget) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += length;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function joinWithBudget<T>(
  items: T[],
  getText: (item: T) => string,
  budgetChars: number,
): string[] {
  return groupByCharBudget(items, getText, budgetChars).map((group) =>
    group.map((item) => String(getText(item) || "")).join("\n\n"),
  );
}
