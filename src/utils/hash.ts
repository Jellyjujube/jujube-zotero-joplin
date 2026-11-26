function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // crypto.subtle is available in Zotero 10, but keep a fallback for
    // older/odd environments.
    const internal = (Zotero.Utilities as any).Internal;
    if (internal?.md5) {
      return String(internal.md5(value));
    }
    throw new Error("No hashing implementation available");
  }
}

export async function hashJson(value: unknown): Promise<string> {
  return sha256Hex(stableStringify(value));
}
