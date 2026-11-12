import { config } from "../../package.json";
import { JoplinClient } from "./joplinClient";
import { getSettings } from "./sync";
import { pickNotebook } from "./notebookPicker";
import { ROOT_NOTEBOOK } from "./target";
import { setPref } from "../utils/prefs";

function readSettingsFromInputs(doc: Document) {
  const baseUrlInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-joplinBaseUrl`,
  ) as HTMLInputElement | null;
  const tokenInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-joplinToken`,
  ) as HTMLInputElement | null;

  const settings = getSettings();
  if (baseUrlInput) settings.joplinBaseUrl = baseUrlInput.value;
  if (tokenInput) settings.joplinToken = tokenInput.value;
  return settings;
}

export async function registerPrefsScripts(window: Window): Promise<void> {
  const doc = window.document;
  bindTestConnection(doc);
  bindNotebookChooser(doc);
  bindLocationControls(doc);
  updateLocationVisibility(doc);
}

function bindTestConnection(doc: Document): void {
  const button = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-testConnection`,
  ) as HTMLButtonElement | null;
  const status = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-connectionStatus`,
  ) as HTMLElement | null;

  if (!button || !status) return;
  if (button.dataset.bound === "1") return;
  button.dataset.bound = "1";

  button.addEventListener("click", async () => {
    const settings = readSettingsFromInputs(doc);
    status.textContent = "正在连接...";
    status.style.color = "";
    button.disabled = true;

    try {
      const client = new JoplinClient(settings);
      await client.ping();
      status.textContent = "连接成功";
      status.style.color = "green";
    } catch (error) {
      status.textContent = `连接失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      status.style.color = "red";
    } finally {
      button.disabled = false;
    }
  });
}

function bindNotebookChooser(doc: Document): void {
  const button = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-chooseNotebook`,
  ) as HTMLButtonElement | null;
  const input = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-notebookName`,
  ) as HTMLInputElement | null;
  const status = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-notebookStatus`,
  ) as HTMLElement | null;

  if (!button || !input || !status) return;
  if (button.dataset.bound === "1") return;
  button.dataset.bound = "1";

  button.addEventListener("click", async () => {
    const settings = readSettingsFromInputs(doc);
    status.textContent = "";
    status.style.color = "";
    button.disabled = true;

    try {
      const result = await pickNotebook({
        settings,
        title: "选择默认笔记本",
        initialPath: input.value,
      });

      if (result) {
        const storedPath = result.path === ROOT_NOTEBOOK ? "" : result.path;
        setPref("notebookName", storedPath);
        input.value = storedPath;
        status.textContent = "";
        status.style.color = "";
      } else {
        status.textContent = "";
      }
    } catch (error) {
      status.textContent = `读取失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      status.style.color = "red";
    } finally {
      updateLocationVisibility(doc);
    }
  });
}

function bindLocationControls(doc: Document): void {
  const modeControls: Array<[string, "ask" | "default"]> = [
    [
      `zotero-prefpane-${config.addonRef}-modeAsk`,
      "ask",
    ],
    [
      `zotero-prefpane-${config.addonRef}-modeDefault`,
      "default",
    ],
  ];

  for (const [id, value] of modeControls) {
    const control = doc.getElementById(id) as any;
    if (!control) continue;
    if (control.getAttribute?.("data-bound") === "1") continue;
    control.setAttribute?.("data-bound", "1");
    const refresh = () => {
      setPref("exportLocationMode", value);
      syncLocationCheckboxes(doc);
      updateLocationVisibility(doc);
    };
    control.addEventListener("command", refresh);
    control.addEventListener("change", refresh);
  }

  const sourceGroup = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-defaultLocationSourceGroup`,
  ) as any;
  const sourceFixed = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-sourceFixed`,
  ) as any;
  const sourceCollections = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-sourceCollections`,
  ) as any;

  for (const control of [sourceGroup, sourceFixed, sourceCollections]) {
    if (!control) continue;
    if (control.getAttribute?.("data-bound") === "1") continue;
    control.setAttribute?.("data-bound", "1");
    const refresh = () =>
      setTimeout(() => {
        if (sourceGroup?.value) {
          setPref("defaultLocationSource", String(sourceGroup.value));
        }
        syncLocationCheckboxes(doc);
        updateLocationVisibility(doc);
      }, 0);
    control.addEventListener("command", refresh);
    control.addEventListener("change", refresh);
  }

  syncLocationCheckboxes(doc);
}

function syncLocationCheckboxes(doc: Document): void {
  const mode = String(
    Zotero.Prefs.get(
      `${config.prefsPrefix}.exportLocationMode`,
      true,
    ) || "default",
  );
  const source = String(
    Zotero.Prefs.get(
      `${config.prefsPrefix}.defaultLocationSource`,
      true,
    ) || "fixed",
  );

  const setChecked = (id: string, checked: boolean) => {
    const element = doc.getElementById(id) as any;
    if (element) element.checked = checked;
  };

  setChecked(
    `zotero-prefpane-${config.addonRef}-modeAsk`,
    mode === "ask",
  );
  setChecked(
    `zotero-prefpane-${config.addonRef}-modeDefault`,
    mode === "default",
  );

  const sourceGroup = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-defaultLocationSourceGroup`,
  ) as any;
  if (sourceGroup) {
    sourceGroup.value = source;
  }
}

function updateLocationVisibility(doc: Document): void {
  const mode = String(
    Zotero.Prefs.get(
      `${config.prefsPrefix}.exportLocationMode`,
      true,
    ) || "default",
  );
  const source = String(
    Zotero.Prefs.get(
      `${config.prefsPrefix}.defaultLocationSource`,
      true,
    ) || "fixed",
  );

  const defaultLocationBox = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-defaultLocationBox`,
  ) as any;
  const defaultNotebookBox = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-defaultNotebookBox`,
  ) as any;
  const collectionsHelp = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-collectionsHelp`,
  ) as any;
  const sourceGroup = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-defaultLocationSourceGroup`,
  ) as any;
  const notebookInput = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-notebookName`,
  ) as HTMLInputElement | null;
  const notebookButton = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-chooseNotebook`,
  ) as HTMLButtonElement | null;

  const modeAsk = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-modeAsk`,
  ) as any;
  const modeDefault = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-modeDefault`,
  ) as any;
  const sourceFixed = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-sourceFixed`,
  ) as any;
  const sourceCollections = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-sourceCollections`,
  ) as any;

  const useDefault = mode === "default";
  const follow = source === "collections";
  const notebookEnabled = useDefault && !follow;

  if (defaultLocationBox) {
    defaultLocationBox.style.opacity = useDefault ? "1" : "0.55";
  }
  if (sourceGroup) {
    sourceGroup.disabled = !useDefault;
  }
  if (defaultNotebookBox) {
    defaultNotebookBox.style.opacity = notebookEnabled ? "1" : "0.55";
  }
  if (notebookInput) notebookInput.disabled = !notebookEnabled;
  if (notebookButton) notebookButton.disabled = !notebookEnabled;
  if (collectionsHelp) {
    collectionsHelp.style.opacity = useDefault && follow ? "1" : "0.55";
  }

  const setRadioLook = (element: any, selected: boolean) => {
    if (!element) return;
    element.style.color = selected ? "" : "gray";
    element.style.opacity = selected ? "1" : "0.6";
  };
  setRadioLook(modeAsk, mode === "ask");
  setRadioLook(modeDefault, mode === "default");
  setRadioLook(sourceFixed, source === "fixed");
  setRadioLook(sourceCollections, source === "collections");
}
