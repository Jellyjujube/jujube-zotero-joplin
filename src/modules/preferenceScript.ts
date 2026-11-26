import { config } from "../../package.json";
import { JoplinClient } from "./joplinClient";
import { getSettings } from "./sync";
import { pickNotebook } from "./notebookPicker";
import { ROOT_NOTEBOOK } from "./target";
import { getEffectiveLanguage, getLanguagePreference, t } from "./i18n";
import { AiClient } from "./aiClient";
import { AiCache, createZoteroAiCacheStore } from "./aiCache";
import {
  AI_PROVIDER_PRESETS,
  clampNumber,
  normalizeOrganizeMode,
  normalizeOutputLanguage,
  normalizeProvider,
  parseExtraHeaders,
  resolveAiOutputLanguage,
} from "./aiConfig";
import { getDefaultUserPrompt } from "./aiPrompts";
import { AiModelInfo } from "./aiTypes";
import { AiFeatureId, AiSettings } from "./types";
import { logInfo, logWarn } from "../utils/logger";
import { getPref, setPref } from "../utils/prefs";

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

function setStatus(
  element: HTMLElement | null,
  text: string,
  options: { color?: string; title?: string } = {},
): void {
  if (!element) return;
  element.textContent = text;
  element.setAttribute("title", options.title ?? text);
  element.style.color = options.color ?? "";
}

export async function registerPrefsScripts(window: Window): Promise<void> {
  const doc = window.document;
  bindLanguageControl(doc);
  applyPreferencesLanguage(doc);
  bindTestConnection(doc);
  bindNotebookChooser(doc);
  bindLocationControls(doc);
  updateLocationVisibility(doc);
  bindAiControls(doc);
  updateAiVisibility(doc);
  updatePromptPlaceholders(doc);
}

function bindLanguageControl(doc: Document): void {
  const control = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-language`,
  ) as any;
  if (!control) return;
  if (control.getAttribute?.("data-bound") === "1") return;
  control.setAttribute?.("data-bound", "1");
  control.value = getLanguagePreference();

  const refresh = () => {
    const value = String(control.value || "auto");
    (setPref as any)("language", value);
    applyPreferencesLanguage(doc);
  };
  control.addEventListener("command", refresh);
  control.addEventListener("change", refresh);
}

function applyPreferencesLanguage(doc: Document): void {
  const language = getEffectiveLanguage();
  doc.querySelectorAll("[data-i18n]").forEach((element: Element) => {
    const key = element.getAttribute("data-i18n") as any;
    if (key) element.textContent = t(language, key);
  });
  doc.querySelectorAll("[data-i18n-label]").forEach((element: Element) => {
    const key = element.getAttribute("data-i18n-label") as any;
    if (key) element.setAttribute("label", t(language, key));
  });
  const connectionStatus = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-connectionStatus`,
  );
  setStatus(connectionStatus as HTMLElement | null, "");
  const notebookStatus = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-notebookStatus`,
  );
  setStatus(notebookStatus as HTMLElement | null, "");
  const aiConnectionStatus = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-aiConnectionStatus`,
  );
  setStatus(aiConnectionStatus as HTMLElement | null, "");
  const aiCacheStatus = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-aiCacheStatus`,
  );
  setStatus(aiCacheStatus as HTMLElement | null, "");
  const aiModelStatus = doc.getElementById(
    `zotero-prefpane-${config.addonRef}-aiModelStatus`,
  );
  setStatus(aiModelStatus as HTMLElement | null, "");
  updatePromptPlaceholders(doc);
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
    const language = getEffectiveLanguage();
    setStatus(status, t(language, "status.connecting"));
    button.disabled = true;

    try {
      const client = new JoplinClient(settings);
      await client.ping();
      setStatus(status, t(language, "status.connected"), { color: "green" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(status, t(language, "status.connectionFailedShort"), {
        color: "red",
        title: `${t(language, "status.connectionFailed")}${message}`,
      });
      void logWarn(`Joplin connection failed: ${message}`);
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
    const language = getEffectiveLanguage();
    setStatus(status, "");
    button.disabled = true;

    try {
      const result = await pickNotebook({
        settings,
        title: t(language, "picker.defaultTitle"),
        initialPath: input.value,
      });

      if (result) {
        const storedPath = result.path === ROOT_NOTEBOOK ? "" : result.path;
        setPref("notebookName", storedPath);
        input.value = storedPath;
        setStatus(status, "");
      } else {
        setStatus(status, "");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(status, t(language, "status.readFailedShort"), {
        color: "red",
        title: `${t(language, "status.readFailed")}${message}`,
      });
      void logWarn(`Notebook picker failed: ${message}`);
    } finally {
      updateLocationVisibility(doc);
    }
  });
}

function bindLocationControls(doc: Document): void {
  const modeControls: Array<[string, "ask" | "default"]> = [
    [`zotero-prefpane-${config.addonRef}-modeAsk`, "ask"],
    [`zotero-prefpane-${config.addonRef}-modeDefault`, "default"],
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
    Zotero.Prefs.get(`${config.prefsPrefix}.exportLocationMode`, true) ||
      "default",
  );
  const source = String(
    Zotero.Prefs.get(`${config.prefsPrefix}.defaultLocationSource`, true) ||
      "fixed",
  );

  const setChecked = (id: string, checked: boolean) => {
    const element = doc.getElementById(id) as any;
    if (element) element.checked = checked;
  };

  setChecked(`zotero-prefpane-${config.addonRef}-modeAsk`, mode === "ask");
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
    Zotero.Prefs.get(`${config.prefsPrefix}.exportLocationMode`, true) ||
      "default",
  );
  const source = String(
    Zotero.Prefs.get(`${config.prefsPrefix}.defaultLocationSource`, true) ||
      "fixed",
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

const aiId = (name: string) => `zotero-prefpane-${config.addonRef}-${name}`;

function bindAiNumberPref(
  doc: Document,
  id: string,
  prefKey: string,
  min: number,
  max: number,
  fallback: number,
): void {
  const element = doc.getElementById(aiId(id)) as HTMLInputElement | null;
  if (!element) return;
  if (element.dataset.bound === "1") return;
  element.dataset.bound = "1";
  const value = clampNumber((getPref as any)(prefKey), fallback, min, max);
  element.value = String(value);
  const refresh = () => {
    const next = clampNumber(element.value, fallback, min, max);
    (setPref as any)(prefKey, next);
    element.value = String(next);
  };
  element.addEventListener("change", refresh);
}

function bindAiTextPref(
  doc: Document,
  id: string,
  prefKey: string,
  fallback = "",
): HTMLTextAreaElement | null {
  const element = doc.getElementById(aiId(id)) as HTMLTextAreaElement | null;
  if (!element) return null;
  if (element.dataset.bound === "1") return element;
  element.dataset.bound = "1";
  element.value = String((getPref as any)(prefKey) ?? fallback);
  const refresh = () => {
    (setPref as any)(prefKey, element.value);
  };
  element.addEventListener("input", refresh);
  element.addEventListener("change", refresh);
  return element;
}

function promptLanguage(): ReturnType<typeof resolveAiOutputLanguage> {
  return resolveAiOutputLanguage(getSettings().ai, getEffectiveLanguage());
}

function defaultPromptFor(feature: AiFeatureId): string {
  return getDefaultUserPrompt(feature, promptLanguage());
}

function bindAiPromptTextarea(
  doc: Document,
  id: string,
  prefKey: string,
  feature: AiFeatureId,
): HTMLTextAreaElement | null {
  const textarea = doc.getElementById(aiId(id)) as HTMLTextAreaElement | null;
  if (!textarea) return null;
  if (textarea.dataset.bound === "1") return textarea;
  textarea.dataset.bound = "1";
  const saved = String((getPref as any)(prefKey) || "").trim();
  textarea.value = saved || defaultPromptFor(feature);
  const refresh = () => {
    (setPref as any)(prefKey, textarea.value);
  };
  textarea.addEventListener("input", refresh);
  textarea.addEventListener("change", () => {
    refresh();
    if (!textarea.value.trim()) {
      (setPref as any)(prefKey, "");
      textarea.value = defaultPromptFor(feature);
    }
  });
  return textarea;
}

function bindAiPromptReset(
  doc: Document,
  buttonId: string,
  textareaId: string,
  prefKey: string,
  feature: AiFeatureId,
): void {
  const button = doc.getElementById(aiId(buttonId)) as HTMLButtonElement | null;
  const textarea = doc.getElementById(
    aiId(textareaId),
  ) as HTMLTextAreaElement | null;
  if (!button || !textarea) return;
  if (button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", () => {
    (setPref as any)(prefKey, "");
    textarea.value = defaultPromptFor(feature);
    textarea.setAttribute("placeholder", defaultPromptFor(feature));
  });
}

function bindAiProvider(doc: Document): void {
  const control = doc.getElementById(aiId("aiProvider")) as any;
  if (!control) return;
  if (control.getAttribute?.("data-bound") === "1") return;
  control.setAttribute?.("data-bound", "1");
  control.value = normalizeProvider(getPref("aiProvider"));
  const refresh = () => {
    const provider = normalizeProvider(control.value);
    (setPref as any)("aiProvider", provider);
    const preset = AI_PROVIDER_PRESETS[provider];
    const base = doc.getElementById(
      aiId("aiApiBaseUrl"),
    ) as HTMLInputElement | null;
    const model = doc.getElementById(aiId("aiModelSelect")) as any;
    if (provider !== "custom") {
      if (base) {
        base.value = preset.baseUrl;
        (setPref as any)("aiApiBaseUrl", base.value);
      }
      if (model) {
        model.value = preset.modelPlaceholder;
        if (model.inputField) model.inputField.value = preset.modelPlaceholder;
        (setPref as any)("aiModel", model.value);
      }
    }
    updateAiVisibility(doc);
  };
  control.addEventListener("command", refresh);
  control.addEventListener("change", refresh);
}

function bindAiOutputLanguage(doc: Document): void {
  const control = doc.getElementById(aiId("aiOutputLanguage")) as any;
  if (!control) return;
  if (control.getAttribute?.("data-bound") === "1") return;
  control.setAttribute?.("data-bound", "1");
  control.value = normalizeOutputLanguage(getPref("aiOutputLanguage"));
  const refresh = () => {
    const value = normalizeOutputLanguage(control.value);
    (setPref as any)("aiOutputLanguage", value);
    updatePromptPlaceholders(doc);
  };
  control.addEventListener("command", refresh);
  control.addEventListener("change", refresh);
}

function readAiFromInputs(doc: Document): AiSettings {
  const settings = getSettings();
  const ai: AiSettings = { ...settings.ai };
  const input = (name: string) =>
    doc.getElementById(aiId(name)) as HTMLInputElement | null;
  const text = (name: string) =>
    (doc.getElementById(aiId(name)) as HTMLTextAreaElement | null)?.value;

  const controlValue = (name: string) =>
    (doc.getElementById(aiId(name)) as any)?.value;
  const provider = controlValue("aiProvider");
  if (provider) ai.provider = normalizeProvider(provider);
  const baseUrl = input("aiApiBaseUrl")?.value;
  if (baseUrl !== undefined) ai.baseUrl = baseUrl.trim();
  const apiKey = input("aiApiKey")?.value;
  if (apiKey !== undefined) ai.apiKey = apiKey.trim();
  const modelControl = doc.getElementById(aiId("aiModelSelect")) as any;
  const model = modelControl?.inputField?.value ?? modelControl?.value;
  if (model !== undefined) ai.model = String(model || "").trim();
  ai.temperature = clampNumber(
    input("aiTemperature")?.value,
    ai.temperature,
    0,
    2,
  );
  ai.maxTokens = Math.floor(
    clampNumber(input("aiMaxTokens")?.value, ai.maxTokens, 64, 32768),
  );
  const headers = text("aiExtraHeaders");
  if (headers !== undefined) ai.extraHeaders = headers;
  ai.timeoutMs = Math.floor(
    clampNumber(input("aiRequestTimeoutMs")?.value, ai.timeoutMs, 5000, 600000),
  );
  ai.maxRetries = Math.floor(
    clampNumber(input("aiMaxRetries")?.value, ai.maxRetries, 0, 5),
  );
  ai.chunkSizeChars = Math.floor(
    clampNumber(
      input("aiChunkSizeChars")?.value,
      ai.chunkSizeChars,
      2000,
      60000,
    ),
  );
  ai.maxPdfChars = Math.floor(
    clampNumber(input("aiMaxPdfChars")?.value, ai.maxPdfChars, 10000, 2000000),
  );
  ai.maxNotesChars = Math.floor(
    clampNumber(
      input("aiMaxNotesChars")?.value,
      ai.maxNotesChars,
      10000,
      1000000,
    ),
  );
  ai.annotationContextChars = Math.floor(
    clampNumber(
      input("aiAnnotationContextChars")?.value,
      ai.annotationContextChars,
      100,
      3000,
    ),
  );
  const outputLanguage = controlValue("aiOutputLanguage");
  if (outputLanguage)
    ai.outputLanguage = normalizeOutputLanguage(outputLanguage);
  const modeGroup = doc.getElementById(aiId("aiOrganizeModeGroup")) as any;
  if (modeGroup?.value)
    ai.organizeMode = normalizeOrganizeMode(modeGroup.value);
  return ai;
}

function updatePromptPlaceholders(doc: Document): void {
  const ai = getSettings().ai;
  const language = resolveAiOutputLanguage(ai, getEffectiveLanguage());
  const prompts: Array<
    [string, "pdf-summary" | "notes-summary" | "notes-organize"]
  > = [
    ["aiPdfSummaryPrompt", "pdf-summary"],
    ["aiNotesSummaryPrompt", "notes-summary"],
    ["aiOrganizePrompt", "notes-organize"],
  ];
  for (const [id, feature] of prompts) {
    const textarea = doc.getElementById(aiId(id)) as HTMLTextAreaElement | null;
    if (!textarea) continue;
    const defaultPrompt = getDefaultUserPrompt(feature, language);
    textarea.setAttribute("placeholder", defaultPrompt);
    const prefKey = id;
    if (!String((getPref as any)(prefKey) || "").trim()) {
      textarea.value = defaultPrompt;
    }
  }
}

function syncAiControls(doc: Document): void {
  const setValue = (id: string, value: unknown) => {
    const element = doc.getElementById(aiId(id)) as any;
    if (element)
      element.value =
        value === undefined || value === null ? "" : String(value);
  };
  const setChecked = (id: string, checked: boolean) => {
    const element = doc.getElementById(aiId(id)) as any;
    if (element) element.checked = checked;
  };

  setChecked("aiEnabled", Boolean(getPref("aiEnabled")));
  setValue("aiProvider", normalizeProvider(getPref("aiProvider")));
  setValue("aiApiBaseUrl", getPref("aiApiBaseUrl") || "");
  setValue("aiApiKey", getPref("aiApiKey") || "");
  const modelValue = String(getPref("aiModel") || "");
  setValue("aiModelSelect", modelValue);
  const modelControl = doc.getElementById(aiId("aiModelSelect")) as any;
  if (modelControl?.inputField) {
    modelControl.inputField.value = modelValue;
  }
  setValue("aiTemperature", getPref("aiTemperature"));
  setValue("aiMaxTokens", getPref("aiMaxTokens"));
  setValue("aiExtraHeaders", getPref("aiExtraHeaders") || "{}");
  setValue("aiRequestTimeoutMs", getPref("aiRequestTimeoutMs"));
  setValue("aiMaxRetries", getPref("aiMaxRetries"));
  setChecked("aiPdfSummaryEnabled", Boolean(getPref("aiPdfSummaryEnabled")));
  setChecked(
    "aiNotesSummaryEnabled",
    Boolean(getPref("aiNotesSummaryEnabled")),
  );
  setChecked("aiOrganizeEnabled", Boolean(getPref("aiOrganizeEnabled")));
  const modeGroup = doc.getElementById(aiId("aiOrganizeModeGroup")) as any;
  if (modeGroup) {
    modeGroup.value = normalizeOrganizeMode(getPref("aiOrganizeMode"));
  }
  setValue(
    "aiOutputLanguage",
    normalizeOutputLanguage(getPref("aiOutputLanguage")),
  );
  setChecked("aiCacheEnabled", Boolean(getPref("aiCacheEnabled")));
  setChecked(
    "aiAnnotationContextEnabled",
    Boolean(getPref("aiAnnotationContextEnabled")),
  );
  setValue("aiAnnotationContextChars", getPref("aiAnnotationContextChars"));
  setValue("aiChunkSizeChars", getPref("aiChunkSizeChars"));
  setValue("aiMaxPdfChars", getPref("aiMaxPdfChars"));
  setValue("aiMaxNotesChars", getPref("aiMaxNotesChars"));
  updatePromptPlaceholders(doc);
}

function updateAiVisibility(doc: Document): void {
  const body = doc.getElementById(aiId("aiBody")) as any;
  if (!body) return;
  const enabled = Boolean(getPref("aiEnabled"));
  body.style.opacity = enabled ? "1" : "0.55";
  const controls = body.querySelectorAll(
    "input, textarea, button, menulist, checkbox, radio",
  );
  controls.forEach((element: any) => {
    element.disabled = !enabled;
  });
  if (!enabled) return;

  const setDisabled = (id: string, disabled: boolean) => {
    const element = doc.getElementById(aiId(id)) as any;
    if (element) element.disabled = disabled;
  };
  const pdf = Boolean(getPref("aiPdfSummaryEnabled"));
  const notes = Boolean(getPref("aiNotesSummaryEnabled"));
  const organize = Boolean(getPref("aiOrganizeEnabled"));
  setDisabled("aiPdfSummaryPrompt", !pdf);
  setDisabled("aiPdfSummaryPromptReset", !pdf);
  setDisabled("aiNotesSummaryPrompt", !notes);
  setDisabled("aiNotesSummaryPromptReset", !notes);
  setDisabled("aiOrganizePrompt", !organize);
  setDisabled("aiOrganizePromptReset", !organize);
  const modeGroup = doc.getElementById(aiId("aiOrganizeModeGroup")) as any;
  if (modeGroup) modeGroup.disabled = !organize;
  setDisabled("aiOrganizeKeep", !organize);
  setDisabled("aiOrganizeOnly", !organize);
  const notesFeatures = notes || organize;
  setDisabled("aiAnnotationContextEnabled", !notesFeatures);
  setDisabled(
    "aiAnnotationContextChars",
    !notesFeatures || !getPref("aiAnnotationContextEnabled"),
  );
}

function bindAiTestConnection(doc: Document): void {
  const button = doc.getElementById(
    aiId("aiTestConnection"),
  ) as HTMLButtonElement | null;
  const status = doc.getElementById(
    aiId("aiConnectionStatus"),
  ) as HTMLElement | null;
  if (!button || !status) return;
  if (button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", async () => {
    const language = getEffectiveLanguage();
    const ai = readAiFromInputs(doc);
    const parsedHeaders = parseExtraHeaders(ai.extraHeaders);
    if (parsedHeaders.error) {
      setStatus(status, t(language, "ai.invalidHeaders"), { color: "red" });
      return;
    }
    setStatus(status, t(language, "status.connecting"));
    button.disabled = true;
    try {
      const client = new AiClient({
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey,
        model: ai.model,
        temperature: ai.temperature,
        maxTokens: Math.min(ai.maxTokens, 64),
        extraHeaders: parsedHeaders.headers,
        timeoutMs: Math.min(ai.timeoutMs, 30000),
        maxRetries: 0,
      });
      const result = await client.testConnection();
      setStatus(
        status,
        `${t(language, "ai.connected")}${
          result.model ? ` (${result.model})` : ""
        }`,
        { color: "green" },
      );
      void refreshAiModels(doc, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(status, t(language, "status.connectionFailedShort"), {
        color: "red",
        title: `${t(language, "ai.connectionFailed")}${message}`,
      });
      void logWarn(`AI connection failed: ${message}`);
    } finally {
      updateAiVisibility(doc);
    }
  });
}

function bindAiClearCache(doc: Document): void {
  const button = doc.getElementById(
    aiId("aiClearCache"),
  ) as HTMLButtonElement | null;
  const status = doc.getElementById(
    aiId("aiCacheStatus"),
  ) as HTMLElement | null;
  if (!button || !status) return;
  if (button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", async () => {
    const language = getEffectiveLanguage();
    button.disabled = true;
    try {
      const cache = new AiCache(createZoteroAiCacheStore());
      await cache.clear();
      setStatus(status, t(language, "ai.cacheCleared"), { color: "green" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(status, t(language, "ai.cacheClearFailedShort"), {
        color: "red",
        title: `${t(language, "ai.cacheClearFailed")}${message}`,
      });
      void logWarn(`AI cache clear failed: ${message}`);
    } finally {
      updateAiVisibility(doc);
    }
  });
}

function bindAiControls(doc: Document): void {
  const master = doc.getElementById(aiId("aiEnabled")) as any;
  if (master) {
    if (master.getAttribute?.("data-bound") !== "1") {
      master.setAttribute?.("data-bound", "1");
      master.checked = Boolean(getPref("aiEnabled"));
      const refresh = () => {
        (setPref as any)("aiEnabled", Boolean(master.checked));
        syncAiControls(doc);
        updateAiVisibility(doc);
      };
      master.addEventListener("command", refresh);
      master.addEventListener("change", refresh);
    }
  }

  for (const id of [
    "aiPdfSummaryEnabled",
    "aiNotesSummaryEnabled",
    "aiOrganizeEnabled",
    "aiAnnotationContextEnabled",
  ]) {
    const control = doc.getElementById(aiId(id)) as any;
    if (!control) continue;
    if (control.getAttribute?.("data-bound") === "1") continue;
    control.setAttribute?.("data-bound", "1");
    const refresh = () => setTimeout(() => updateAiVisibility(doc), 0);
    control.addEventListener("command", refresh);
    control.addEventListener("change", refresh);
  }

  bindAiProvider(doc);
  bindAiOutputLanguage(doc);
  bindAiNumberPref(doc, "aiTemperature", "aiTemperature", 0, 2, 0.2);
  bindAiNumberPref(doc, "aiMaxTokens", "aiMaxTokens", 64, 32768, 8192);
  bindAiNumberPref(
    doc,
    "aiRequestTimeoutMs",
    "aiRequestTimeoutMs",
    5000,
    600000,
    120000,
  );
  bindAiNumberPref(doc, "aiMaxRetries", "aiMaxRetries", 0, 5, 2);
  bindAiNumberPref(
    doc,
    "aiChunkSizeChars",
    "aiChunkSizeChars",
    2000,
    60000,
    16000,
  );
  bindAiNumberPref(
    doc,
    "aiMaxPdfChars",
    "aiMaxPdfChars",
    10000,
    2000000,
    320000,
  );
  bindAiNumberPref(
    doc,
    "aiMaxNotesChars",
    "aiMaxNotesChars",
    10000,
    1000000,
    200000,
  );
  bindAiNumberPref(
    doc,
    "aiAnnotationContextChars",
    "aiAnnotationContextChars",
    100,
    3000,
    500,
  );
  bindAiTextPref(doc, "aiExtraHeaders", "aiExtraHeaders", "{}");
  bindAiPromptTextarea(
    doc,
    "aiPdfSummaryPrompt",
    "aiPdfSummaryPrompt",
    "pdf-summary",
  );
  bindAiPromptTextarea(
    doc,
    "aiNotesSummaryPrompt",
    "aiNotesSummaryPrompt",
    "notes-summary",
  );
  bindAiPromptTextarea(
    doc,
    "aiOrganizePrompt",
    "aiOrganizePrompt",
    "notes-organize",
  );
  bindAiPromptReset(
    doc,
    "aiPdfSummaryPromptReset",
    "aiPdfSummaryPrompt",
    "aiPdfSummaryPrompt",
    "pdf-summary",
  );
  bindAiPromptReset(
    doc,
    "aiNotesSummaryPromptReset",
    "aiNotesSummaryPrompt",
    "aiNotesSummaryPrompt",
    "notes-summary",
  );
  bindAiPromptReset(
    doc,
    "aiOrganizePromptReset",
    "aiOrganizePrompt",
    "aiOrganizePrompt",
    "notes-organize",
  );
  bindAiTestConnection(doc);
  bindAiClearCache(doc);
  bindAiModelFetch(doc);
  syncAiControls(doc);
}

let aiModelCache: AiModelInfo[] = [];

function applyModelRecommendation(doc: Document, model: AiModelInfo): void {
  const language = getEffectiveLanguage();
  const status = doc.getElementById(
    aiId("aiModelStatus"),
  ) as HTMLElement | null;
  const maxTokensInput = doc.getElementById(
    aiId("aiMaxTokens"),
  ) as HTMLInputElement | null;
  const chunkInput = doc.getElementById(
    aiId("aiChunkSizeChars"),
  ) as HTMLInputElement | null;
  const current = readAiFromInputs(doc);
  let maxTokens = current.maxTokens;
  let tokensApplied = false;
  if (model.maxOutputTokens) {
    maxTokens = Math.floor(
      clampNumber(model.maxOutputTokens, current.maxTokens, 64, 16384),
    );
    if (maxTokensInput) maxTokensInput.value = String(maxTokens);
    (setPref as any)("aiMaxTokens", maxTokens);
    tokensApplied = true;
  }
  if (!model.contextLength) {
    setStatus(
      status,
      tokensApplied
        ? t(language, "ai.modelTokensOnlyShort", { tokens: maxTokens })
        : t(language, "ai.modelNoContextShort"),
    );
    return;
  }
  const chunk = Math.floor(
    clampNumber(
      (model.contextLength - maxTokens) * 0.6,
      current.chunkSizeChars,
      2000,
      60000,
    ),
  );
  if (chunkInput) chunkInput.value = String(chunk);
  (setPref as any)("aiChunkSizeChars", chunk);
  if (status) {
    setStatus(
      status,
      t(language, "ai.modelAppliedShort", {
        chunk,
        tokens: maxTokens,
      }),
    );
  }
  void logInfo(
    `AI model ${model.id}: context=${model.contextLength} max_output=${model.maxOutputTokens ?? "-"} -> chunk=${chunk} max_tokens=${maxTokens}`,
  );
}

async function refreshAiModels(doc: Document, silent = false): Promise<void> {
  const button = doc.getElementById(
    aiId("aiFetchModels"),
  ) as HTMLButtonElement | null;
  const status = doc.getElementById(
    aiId("aiModelStatus"),
  ) as HTMLElement | null;
  const select = doc.getElementById(aiId("aiModelSelect")) as any;
  if (!button || !status || !select) return;
  const language = getEffectiveLanguage();
  const ai = readAiFromInputs(doc);
  const parsedHeaders = parseExtraHeaders(ai.extraHeaders);
  if (parsedHeaders.error) {
    setStatus(status, t(language, "ai.invalidHeaders"), { color: "red" });
    return;
  }
  if (!silent) {
    setStatus(status, t(language, "ai.fetchingModels"));
    button.disabled = true;
  }
  try {
    const client = new AiClient({
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
      model: ai.model,
      temperature: ai.temperature,
      maxTokens: Math.min(ai.maxTokens, 64),
      extraHeaders: parsedHeaders.headers,
      timeoutMs: Math.min(ai.timeoutMs, 30000),
      maxRetries: 0,
    });
    const models = await client.listModels();
    aiModelCache = models;
    const current = String(
      select.inputField?.value ?? ai.model ?? select.value ?? "",
    ).trim();
    const popup = select.querySelector("menupopup") as any;
    if (popup) {
      while (popup.firstChild) popup.removeChild(popup.firstChild);
      const manual = (doc as any).createXULElement("menuitem");
      manual.setAttribute("label", t(language, "ai.modelManual"));
      manual.setAttribute("value", "");
      popup.appendChild(manual);
      for (const model of models) {
        const item = (doc as any).createXULElement("menuitem");
        const context = model.contextLength
          ? ` · ${Math.round(model.contextLength / 1000)}k`
          : "";
        item.setAttribute("label", `${model.id}${context}`);
        item.setAttribute("value", model.id);
        popup.appendChild(item);
      }
    }
    select.value = current;
    if (select.inputField) select.inputField.value = current;
    const selectedModel = aiModelCache.find(
      (entry) =>
        entry.id === current && (entry.contextLength || entry.maxOutputTokens),
    );
    if (selectedModel) {
      applyModelRecommendation(doc, selectedModel);
    } else {
      setStatus(
        status,
        models.length
          ? t(language, "ai.modelsFetched", { count: models.length })
          : t(language, "ai.noModels"),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!silent) {
      setStatus(status, t(language, "ai.modelsFetchFailedShort"), {
        color: "red",
        title: `${t(language, "ai.modelsFetchFailed")}${message}`,
      });
    }
    void logWarn(`AI model list failed: ${message}`);
  } finally {
    updateAiVisibility(doc);
  }
}

function bindAiModelFetch(doc: Document): void {
  const button = doc.getElementById(
    aiId("aiFetchModels"),
  ) as HTMLButtonElement | null;
  const select = doc.getElementById(aiId("aiModelSelect")) as any;
  if (!button || !select) return;
  if (button.dataset.bound !== "1") {
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      void refreshAiModels(doc, false);
    });
  }
  if (select.getAttribute?.("data-bound") !== "1") {
    select.setAttribute?.("data-bound", "1");
    const applySelectedModel = () => {
      const value = String(
        select.inputField?.value ?? select.value ?? "",
      ).trim();
      if (!value) return;
      (setPref as any)("aiModel", value);
      const model = aiModelCache.find((entry) => entry.id === value);
      if (model) applyModelRecommendation(doc, model);
    };
    select.addEventListener("command", applySelectedModel);
    select.addEventListener("change", applySelectedModel);
    select.addEventListener("input", applySelectedModel);
  }
}
