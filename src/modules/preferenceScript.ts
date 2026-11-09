import { config } from "../../package.json";
import { JoplinClient } from "./joplinClient";
import { getSettings } from "./sync";
import { setPref } from "../utils/prefs";

interface NotebookEntry {
  id: string;
  title: string;
  path: string;
}

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
  bindNotebookChooser(window, doc);
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

function bindNotebookChooser(window: Window, doc: Document): void {
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
    status.textContent = "正在读取 Joplin 笔记本...";
    status.style.color = "";
    button.disabled = true;

    try {
      const client = new JoplinClient(settings);
      await client.ping();
      const notebooks = await client.listNotebooks();
      status.textContent = "";
      openNotebookDialog(window, client, notebooks, input, status);
    } catch (error) {
      status.textContent = `读取失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      status.style.color = "red";
    } finally {
      button.disabled = false;
    }
  });
}

function openNotebookDialog(
  _window: Window,
  client: JoplinClient,
  notebooks: NotebookEntry[],
  input: HTMLInputElement,
  status: HTMLElement,
): void {
  const suffix = Date.now().toString(36);
  const listId = `zotero-joplin-notebook-list-${suffix}`;
  const newId = `zotero-joplin-notebook-new-${suffix}`;

  const paths = notebooks.map((notebook) => notebook.path);
  if (input.value && !paths.includes(input.value)) {
    paths.unshift(input.value);
  }

  let selectedPath = input.value || "";
  let newPathValue = "";

  const rows = [
    { path: "", label: "（顶层，不放入任何笔记本）" },
    ...paths.map((path) => ({ path, label: path })),
  ];

  const rowElements = rows.map((row) => ({
    tag: "div",
    namespace: "html",
    attributes: { "data-path": row.path },
    styles: {
      padding: "8px 10px",
      margin: "1px 0",
      cursor: "pointer",
      borderRadius: "4px",
      backgroundColor:
        row.path === selectedPath
          ? "rgba(0, 120, 215, 0.45)"
          : "transparent",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      fontSize: "13px",
      lineHeight: "1.4",
    },
    properties: { textContent: row.label, title: row.label },
    listeners: [
      {
        type: "click",
        listener: () => {
          selectedPath = row.path;
          const doc = dialog.window?.document;
          const container = doc?.getElementById(listId);
          container?.querySelectorAll("[data-path]").forEach((node: any) => {
            node.style.backgroundColor =
              node.getAttribute("data-path") === selectedPath
                ? "rgba(0, 120, 215, 0.45)"
                : "transparent";
          });
        },
      },
      {
        type: "mouseenter",
        listener: (ev: Event) => {
          const target = ev.target as HTMLElement;
          if (target.getAttribute("data-path") !== selectedPath) {
            target.style.backgroundColor = "rgba(128, 128, 128, 0.18)";
          }
        },
      },
      {
        type: "mouseleave",
        listener: (ev: Event) => {
          const target = ev.target as HTMLElement;
          if (target.getAttribute("data-path") !== selectedPath) {
            target.style.backgroundColor = "transparent";
          }
        },
      },
    ],
  }));

  let dialog: any;
  dialog = new ztoolkit.Dialog(1, 1)
    .addCell(0, 0, {
      tag: "vbox",
      styles: { padding: "14px" },
      children: [
        {
          tag: "label",
          namespace: "html",
          properties: {
            textContent: "选择已有笔记本（点击一行选中）",
          },
          styles: {
            fontWeight: "bold",
            marginBottom: "8px",
            display: "block",
          },
        },
        {
          tag: "div",
          namespace: "html",
          id: listId,
          styles: {
            height: "18em",
            overflowY: "auto",
            border: "1px solid rgba(128, 128, 128, 0.45)",
            borderRadius: "6px",
            padding: "4px",
            backgroundColor: "rgba(255, 255, 255, 0.04)",
          },
          children: rowElements,
        },
        {
          tag: "label",
          namespace: "html",
          properties: {
            textContent:
              "或输入新笔记本名称（可用 / 分隔多级，留空则使用上面的选择）",
          },
          styles: {
            marginTop: "14px",
            marginBottom: "6px",
            display: "block",
          },
        },
        {
          tag: "input",
          namespace: "html",
          id: newId,
          attributes: { type: "text", placeholder: "例如：Zotero/test" },
          styles: { width: "36em", padding: "6px" },
          listeners: [
            {
              type: "input",
              listener: (ev: Event) => {
                newPathValue = String(
                  (ev.target as HTMLInputElement).value || "",
                );
              },
            },
          ],
        },
      ],
    })
    .addButton("确定", "ok", {
      callback: async () => {
        const doc = dialog.window?.document;
        const newInput = doc?.getElementById(newId) as HTMLInputElement | null;
        const newPath = String(
          newInput?.value || newPathValue || "",
        ).trim();
        const chosen = newPath || selectedPath;

        setPref("notebookName", chosen);
        input.value = chosen;
        input.dispatchEvent(new Event("change", { bubbles: true }));

        if (!chosen) {
          status.textContent = "已设置为顶层";
          status.style.color = "green";
          return;
        }

        if (newPath) {
          status.textContent = `正在创建笔记本：${newPath}...`;
          status.style.color = "";
          try {
            await client.ensureNotebookPath(newPath);
            status.textContent = `已创建 / 选择：${newPath}`;
            status.style.color = "green";
          } catch (error) {
            status.textContent = `创建失败：${
              error instanceof Error ? error.message : String(error)
            }`;
            status.style.color = "red";
          }
        } else {
          status.textContent = `已选择：${selectedPath}`;
          status.style.color = "green";
        }
      },
    })
    .addButton("取消", "cancel")
    .open("选择 Joplin 笔记本", {
      width: 640,
      height: 460,
      centerscreen: true,
      resizable: true,
    });
}
