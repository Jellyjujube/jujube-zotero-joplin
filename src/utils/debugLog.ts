/**
 * Append a line to a debug log in the Zotero data directory.
 * Debug logging must never break the plugin.
 */
export async function appendDebugLog(message: string): Promise<void> {
  try {
    const path = `${Zotero.DataDirectory.dir}/zotero-joplin-debug.log`;
    let existing = "";
    try {
      existing = String((await Zotero.File.getContentsAsync(path)) || "");
    } catch {
      existing = "";
    }
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await Zotero.File.putContentsAsync(path, existing + line);
  } catch {
    // Ignore.
  }
}
