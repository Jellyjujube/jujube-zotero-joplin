import { ItemData } from "./types";

export function paperKey(data: ItemData): string {
  return `${data.libraryID}:${data.key}`;
}

/**
 * Build a unique note ID from the paper identifier plus the current
 * timestamp. The ID is only generated when a note is first created; later
 * exports find the note through its user_data, not by recomputing this ID.
 */
export async function generateNoteId(data: ItemData): Promise<string> {
  const value = `${data.libraryID}:${data.key}:${Date.now()}:${Math.random()}`;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  } catch {
    const internal = (Zotero.Utilities as any).Internal;
    if (internal?.md5) {
      return String(internal.md5(value)).slice(0, 32);
    }
    throw new Error("No hashing implementation available");
  }
}

export function makeUserData(
  data: ItemData,
  trackedTags: string[] = [],
): string {
  const tags = [
    ...new Set(
      trackedTags.map((tag) => String(tag || "").trim()).filter(Boolean),
    ),
  ];
  return JSON.stringify({
    "zotero-joplin": {
      libraryID: data.libraryID,
      key: data.key,
      tags,
    },
  });
}

/**
 * Extract "libraryID:itemKey" from a note's user_data, or null if the note
 * wasn't created by this plugin.
 */
export function parseUserData(value: string): string | null {
  try {
    const parsed = JSON.parse(String(value || ""));
    const data = parsed?.["zotero-joplin"];
    if (data && data.libraryID !== undefined && data.key) {
      return `${data.libraryID}:${data.key}`;
    }
  } catch {
    // Not our user_data.
  }
  return null;
}

/**
 * Tags previously applied by the plugin. They are kept in user_data so a
 * later export can remove tags that are no longer present in Zotero without
 * touching tags the user added manually in Joplin.
 */
export function parseUserDataTags(value: string): string[] {
  try {
    const parsed = JSON.parse(String(value || ""));
    const tags = parsed?.["zotero-joplin"]?.tags;
    if (Array.isArray(tags)) {
      return [
        ...new Set(
          tags.map((tag) => String(tag || "").trim()).filter(Boolean),
        ),
      ];
    }
  } catch {
    // Not our user_data.
  }
  return [];
}
