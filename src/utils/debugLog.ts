import { logDebug } from "./logger";

/**
 * Compatibility wrapper for older call sites. All plugin file logging is
 * controlled by the logging preference and written to zotero-joplin.log.
 */
export async function appendDebugLog(message: string): Promise<void> {
  await logDebug(message);
}
