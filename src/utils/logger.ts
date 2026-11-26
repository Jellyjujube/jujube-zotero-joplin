import { getPref } from "./prefs";

export type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 2_000_000;
const KEEP_LOG_BYTES = 1_000_000;

function isEnabled(): boolean {
  try {
    return Boolean((getPref as any)("loggingEnabled"));
  } catch {
    return false;
  }
}

export async function appendLog(
  level: LogLevel,
  message: string,
): Promise<void> {
  if (!isEnabled()) return;
  try {
    const path = `${(Zotero as any).DataDirectory.dir}/zotero-joplin.log`;
    const file = (Zotero as any).File.pathToFile(path);
    let existing = "";
    try {
      existing = String((await Zotero.File.getContentsAsync(file)) || "");
    } catch {
      existing = "";
    }
    if (existing.length > MAX_LOG_BYTES) {
      existing = existing.slice(-KEEP_LOG_BYTES);
    }
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${String(
      message || "",
    )
      .replace(/\s+/g, " ")
      .trim()}\n`;
    await Zotero.File.putContentsAsync(file, existing + line, "utf-8");
  } catch {
    // Logging must never break the plugin.
  }
}

export function logDebug(message: string): Promise<void> {
  return appendLog("debug", message);
}

export function logInfo(message: string): Promise<void> {
  return appendLog("info", message);
}

export function logWarn(message: string): Promise<void> {
  return appendLog("warn", message);
}

export function logError(message: string): Promise<void> {
  return appendLog("error", message);
}
