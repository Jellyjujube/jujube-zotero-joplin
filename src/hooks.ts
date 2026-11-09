import { config } from "../package.json";
import { getLocaleID, getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { syncZoteroItemsAsDocument } from "./modules/sync";
import { appendDebugLog } from "./utils/debugLog";
import { clearPref } from "./utils/prefs";
import { createZToolkit } from "./utils/ztoolkit";

const MENU_ID = `${config.addonRef}-itemmenu-sync-to-joplin`;
const TOOLS_MENU_ID = `${config.addonRef}-toolsmenu`;
let menuRegistered = false;

async function onStartup(): Promise<void> {
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);

    initLocale();

    // Clean up preferences left by earlier experimental versions.
    try {
      clearPref("noteMap");
      clearPref("exportStructure");
    } catch {
      // Ignore.
    }

    try {
      Zotero.PreferencePanes.register({
        pluginID: config.addonID,
        src: `${rootURI}content/preferences.xhtml`,
        label: getString("prefs-title"),
        image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      });
    } catch (error) {
      await appendDebugLog(
        `PreferencePanes.register failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }

    await Promise.all(
      Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
    );

    addon.data.initialized = true;
    await appendDebugLog("Plugin startup complete");

  } catch (error) {
    await appendDebugLog(
      `onStartup failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`,
    );
    throw error;
  }
}

async function onMainWindowLoad(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  try {
    win.MozXULElement.insertFTLIfNeeded(
      `${config.addonRef}-mainWindow.ftl`,
    );
  } catch (error) {
    await appendDebugLog(
      `insertFTLIfNeeded failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`,
    );
  }

  if (menuRegistered) return;

  const itemMenus = [
    {
      menuType: "menuitem" as const,
      l10nID: getLocaleID("menuitem-export-content"),
      icon: `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`,
      onCommand: () => addon.hooks.onExportContent(),
    },
  ];

  try {
    Zotero.MenuManager.registerMenu({
      menuID: MENU_ID,
      pluginID: config.addonID,
      target: "main/library/item",
      menus: itemMenus,
    });
    menuRegistered = true;
    await appendDebugLog("Item context menu registered");
  } catch (error) {
    await appendDebugLog(
      `Item menu registration failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`,
    );
  }

  // Also expose the commands under Tools, which is useful when the item
  // context menu is unavailable (e.g. a different Zotero layout).
  try {
    Zotero.MenuManager.registerMenu({
      menuID: TOOLS_MENU_ID,
      pluginID: config.addonID,
      target: "main/menubar/tools",
      menus: itemMenus,
    });
    await appendDebugLog("Tools menu registered");
  } catch (error) {
    await appendDebugLog(
      `Tools menu registration failed: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`,
    );
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // MenuManager cleans up plugin menus on shutdown. Nothing per-window to do.
}

function onShutdown(): void {
  try {
    (Zotero.MenuManager as any).unregisterMenu?.(MENU_ID);
  } catch {
    // Older versions clean up by pluginID automatically.
  }
  menuRegistered = false;
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[config.addonInstance];
}

async function onExportContent(): Promise<void> {
  const win = Zotero.getMainWindow();
  if (!win) return;

  const selected = win.ZoteroPane.getSelectedItems();
  if (!selected.length) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: "请先在 Zotero 中选择要导出的条目。",
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: "准备导出到 Joplin...",
      type: "default",
      progress: 0,
    })
    .show();

  try {
    const summary = await syncZoteroItemsAsDocument(
      selected,
      (message, progress) => {
        progressWindow.changeLine({ text: message, progress });
      },
    );

    let text = `导出完成：新建 ${summary.created} 个笔记，更新 ${summary.updated} 个`;
    if (summary.skipped) text += `，跳过 ${summary.skipped}`;
    if (summary.failed) text += `，失败 ${summary.failed}`;
    if (summary.errors.length) {
      text += `\n${summary.errors.slice(0, 3).join("\n")}`;
    }

    progressWindow.changeLine({
      text,
      type: summary.failed ? "fail" : "success",
      progress: 100,
    });
    progressWindow.startCloseTimer(summary.errors.length ? 12000 : 5000);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "未知错误");
    progressWindow.changeLine({
      text: `导出失败：${message}`,
      type: "fail",
      progress: 100,
    });
    progressWindow.startCloseTimer(10000);
  }
}

async function onPrefsEvent(
  type: string,
  data: { [key: string]: any },
): Promise<void> {
  if (type === "load") {
    await registerPrefsScripts(data.window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onExportContent,
};
