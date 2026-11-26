import { config } from "../package.json";
import { getLocaleID, getString, initLocale } from "./utils/locale";
import { getEffectiveLanguage, t } from "./modules/i18n";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { getSettings, syncZoteroItemsAsDocument } from "./modules/sync";
import { JoplinClient } from "./modules/joplinClient";
import { pickNotebook } from "./modules/notebookPicker";
import {
  ROOT_NOTEBOOK,
  ensureTarget,
  normalizeFixedSegments,
  resolveDefaultTarget,
} from "./modules/target";
import { appendDebugLog } from "./utils/debugLog";
import { logInfo, logWarn } from "./utils/logger";
import { clearPref, getPref, setPref } from "./utils/prefs";
import { createZToolkit } from "./utils/ztoolkit";

const MENU_ID = `${config.addonRef}-itemmenu-sync-to-joplin`;
const TOOLS_MENU_ID = `${config.addonRef}-toolsmenu`;
const MENU_ICON = `chrome://${config.addonRef}/content/icons/menu.png`;
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

    // The Zotero root is represented by an empty value so the settings input
    // can show it as the default placeholder.
    try {
      if (String(getPref("notebookName") || "").trim() === ROOT_NOTEBOOK) {
        setPref("notebookName", "");
      }
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

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  try {
    win.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);
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
      icon: MENU_ICON,
      darkIcon: MENU_ICON,
      onShowing: (_event: Event, context: any) => {
        const label = t(getEffectiveLanguage(), "menu.export");
        context.menuElem?.setAttribute("label", label);
        context.menuElem?.removeAttribute("data-l10n-id");
        context.setIcon?.(MENU_ICON, MENU_ICON);
      },
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
        text: t(getEffectiveLanguage(), "progress.selectItem"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  const settings = getSettings();
  await logInfo(
    `Export requested: selected=${selected.length} mode=${settings.exportLocationMode}`,
  );
  if (!settings.joplinToken) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: t(settings.language, "error.noToken"),
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  let target: { folderId: string; path: string } | null;

  try {
    if (settings.exportLocationMode === "ask") {
      target = await pickNotebook({
        settings,
        title: t(settings.language, "picker.exportTitle"),
        initialFolderId: String(getPref("lastTargetFolderId") || ""),
        initialPath: ROOT_NOTEBOOK,
        showEffectivePath: true,
      });
      if (target && !target.folderId) {
        const client = new JoplinClient(settings);
        await client.ping();
        target = await ensureTarget(client, {
          segments: normalizeFixedSegments(target.path),
        });
      }
    } else {
      const client = new JoplinClient(settings);
      await client.ping();
      target = await ensureTarget(client, resolveDefaultTarget(settings));
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || t(settings.language, "error.unknown"));
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: `${t(settings.language, "error.target")}${message}`,
        type: "fail",
        progress: 100,
      })
      .show();
    return;
  }

  if (!target) return;
  await logInfo(`Export target: ${target.path}`);
  setPref("lastTargetFolderId", target.folderId);

  const progressWindow = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: t(settings.language, "progress.preparing"),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    const summary = await syncZoteroItemsAsDocument(
      selected,
      target.folderId,
      (message, progress) => {
        progressWindow.changeLine({ text: message, progress });
      },
    );

    let text = t(settings.language, "summary.done", {
      created: summary.created,
      updated: summary.updated,
    });
    if (summary.skipped) {
      text += t(settings.language, "summary.skipped", {
        skipped: summary.skipped,
      });
    }
    if (summary.failed) {
      text += t(settings.language, "summary.failed", {
        failed: summary.failed,
      });
    }
    const noticeCount = summary.errors.length + summary.warnings.length;
    if (noticeCount) {
      text += `\n${t(settings.language, "summary.seeLog", {
        count: noticeCount,
      })}`;
    }

    progressWindow.changeLine({
      text,
      type: summary.failed ? "fail" : "success",
      progress: 100,
    });
    await logInfo(
      `Export finished: created=${summary.created} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed} notices=${noticeCount}`,
    );
    progressWindow.startCloseTimer(noticeCount ? 12000 : 5000);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || t(settings.language, "error.unknown"));
    await logWarn(`Export failed: ${message}`);
    progressWindow.changeLine({
      text: `${t(settings.language, "error.exportFailed")}${message}`,
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
