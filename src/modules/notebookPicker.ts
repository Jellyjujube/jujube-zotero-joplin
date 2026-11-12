import { JoplinClient } from "./joplinClient";
import { ROOT_NOTEBOOK, normalizeFixedSegments } from "./target";
import { PluginSettings } from "./types";

export interface NotebookSelection {
  folderId: string;
  path: string;
}

interface PickNotebookOptions {
  settings: PluginSettings;
  title?: string;
  initialFolderId?: string;
  initialPath?: string;
  showEffectivePath?: boolean;
}

interface NotebookEntry {
  id: string;
  title: string;
  path: string;
  parentId: string;
}

/**
 * Show a modal notebook picker restricted to the Zotero root subtree.
 * Returns null if the user cancels or closes the window.
 */
export async function pickNotebook(
  options: PickNotebookOptions,
): Promise<NotebookSelection | null> {
  const client = new JoplinClient(options.settings);
  await client.ping();
  const listing = await client.listNotebooksUnderRoot(ROOT_NOTEBOOK);
  const notebooks: NotebookEntry[] = listing.items.length
    ? listing.items
    : [
        {
          id: listing.rootId,
          title: ROOT_NOTEBOOK,
          path: ROOT_NOTEBOOK,
          parentId: "",
        },
      ];

  let initialPath = String(options.initialPath || "");
  if (initialPath) {
    initialPath = normalizeFixedSegments(initialPath).join("/");
  }

  const entryById = options.initialFolderId
    ? notebooks.find((entry) => entry.id === options.initialFolderId)
    : undefined;
  const entryByPath = initialPath
    ? notebooks.find((entry) => entry.path === initialPath)
    : undefined;
  const preserveTypedPath = !entryById && !entryByPath && Boolean(initialPath);

  const initial =
    entryById ||
    entryByPath ||
    notebooks.find((entry) => entry.path === ROOT_NOTEBOOK) ||
    notebooks[0];

  return new Promise<NotebookSelection | null>((resolve) => {
    let done = false;
    const finish = (result: NotebookSelection | null) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const suffix = Date.now().toString(36);
    const listId = `zotero-joplin-pick-list-${suffix}`;
    const newId = `zotero-joplin-pick-new-${suffix}`;
    const effectiveId = `zotero-joplin-pick-effective-${suffix}`;

    let dialog: any;
    let selectedId = initial?.id || "";
    const initialPathValue = preserveTypedPath
      ? initialPath
      : initial?.path || ROOT_NOTEBOOK;
    let newPathValue = initialPathValue;
    let lastAction: "tree" | "input" = preserveTypedPath ? "input" : "tree";
    const showEffectivePath = Boolean(options.showEffectivePath);

    const updateEffectivePath = () => {
      if (!showEffectivePath) return;
      const doc = dialog?.window?.document;
      const element = doc?.getElementById(effectiveId);
      if (!element) return;
      const selected = notebooks.find((entry) => entry.id === selectedId);
      const typed = String(newPathValue || "").trim();
      const effective =
        lastAction === "input" && typed
          ? normalizeFixedSegments(typed).join("/")
          : selected?.path || ROOT_NOTEBOOK;
      element.textContent = `即将导入到：${effective}`;
    };

    const root =
      notebooks.find((entry) => entry.path === ROOT_NOTEBOOK) ||
      notebooks[0];

    const byParent = new Map<string, NotebookEntry[]>();
    for (const entry of notebooks) {
      if (entry === root) continue;
      const list = byParent.get(entry.parentId) || [];
      list.push(entry);
      byParent.set(entry.parentId, list);
    }

    const treeRows: Array<{ entry: NotebookEntry; label: string }> = [];
    const seen = new Set<string>();

    if (root) {
      treeRows.push({
        entry: root,
        label: ROOT_NOTEBOOK,
      });
      seen.add(root.id);
    }

    const walk = (parentId: string, prefix: string) => {
      const children = (byParent.get(parentId) || []).filter(
        (entry) => !seen.has(entry.id),
      );
      children.forEach((child, index) => {
        const last = index === children.length - 1;
        const branch = last ? "└─ " : "├─ ";
        treeRows.push({
          entry: child,
          label: `${prefix}${branch}${child.title}`,
        });
        seen.add(child.id);
        walk(child.id, `${prefix}${last ? "   " : "│  "}`);
      });
    };

    if (root) walk(root.id, "");

    // Defensive: show anything whose parent wasn't in the listing.
    for (const entry of notebooks) {
      if (seen.has(entry.id)) continue;
      treeRows.push({ entry, label: entry.title });
      seen.add(entry.id);
    }

    const rows = treeRows.map(({ entry, label }) => ({
      entry,
      element: {
        tag: "div",
        namespace: "html",
        attributes: { "data-id": entry.id },
        styles: {
          padding: "8px 10px",
          margin: "1px 0",
          cursor: "pointer",
          borderRadius: "4px",
          backgroundColor:
            entry.id === selectedId
              ? "rgba(0, 120, 215, 0.45)"
              : "transparent",
          whiteSpace: "pre",
          overflow: "hidden",
          fontFamily: "monospace",
          fontSize: "13px",
          lineHeight: "1.4",
        },
        properties: {
          textContent: label,
          title: entry.path,
        },
        listeners: [
          {
            type: "click",
            listener: () => {
              selectedId = entry.id;
              lastAction = "tree";
              newPathValue = entry.path;

              const doc = dialog?.window?.document;
              const input = doc?.getElementById(
                newId,
              ) as HTMLInputElement | null;
              if (input) input.value = entry.path;

              const container = doc?.getElementById(listId);
              container?.querySelectorAll("[data-id]").forEach((node: any) => {
                node.style.backgroundColor =
                  node.getAttribute("data-id") === selectedId
                    ? "rgba(0, 120, 215, 0.45)"
                    : "transparent";
              });
              updateEffectivePath();
            },
          },
          {
            type: "mouseenter",
            listener: (ev: Event) => {
              const target = ev.target as HTMLElement;
              if (target.getAttribute("data-id") !== selectedId) {
                target.style.backgroundColor = "rgba(128, 128, 128, 0.18)";
              }
            },
          },
          {
            type: "mouseleave",
            listener: (ev: Event) => {
              const target = ev.target as HTMLElement;
              if (target.getAttribute("data-id") !== selectedId) {
                target.style.backgroundColor = "transparent";
              }
            },
          },
        ],
      },
    }));

    const contentChildren: any[] = [
          {
            tag: "label",
            namespace: "html",
            properties: {
              textContent: "目标笔记本",
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
              overflowX: "auto",
              border: "1px solid rgba(128, 128, 128, 0.45)",
              borderRadius: "6px",
              padding: "4px",
              backgroundColor: "rgba(255, 255, 255, 0.04)",
            },
            children: rows.map((row) => row.element),
          },
          {
            tag: "label",
            namespace: "html",
            properties: {
              textContent: "目标路径",
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
            attributes: {
              type: "text",
              placeholder: "Zotero",
              value: initialPathValue,
            },
            properties: { value: initialPathValue },
            styles: { width: "36em", padding: "6px" },
            listeners: [
              {
                type: "input",
                listener: (ev: Event) => {
                  newPathValue = String(
                    (ev.target as HTMLInputElement).value || "",
                  );
                  lastAction = "input";
                  updateEffectivePath();
                },
              },
            ],
          },
    ];

    if (showEffectivePath) {
      contentChildren.push({
        tag: "label",
        namespace: "html",
        id: effectiveId,
        properties: {
          textContent: `即将导入到：${initialPathValue}`,
        },
        styles: {
          color: "gray",
          marginTop: "10px",
          display: "block",
          lineHeight: "1.4",
          overflowWrap: "anywhere",
          wordBreak: "break-all",
        },
      });
    }

    dialog = new ztoolkit.Dialog(1, 1).addCell(0, 0, {
      tag: "vbox",
      styles: { padding: "14px" },
      children: contentChildren,
    });

    dialog
      .addButton("确定", "ok", {
        callback: () => {
          try {
            const doc = dialog?.window?.document;
            const input = doc?.getElementById(
              newId,
            ) as HTMLInputElement | null;
            const typedPath = String(
              input?.value || newPathValue || "",
            ).trim();

            if (lastAction === "input" && typedPath) {
              const segments = normalizeFixedSegments(typedPath);
              const path = segments.join("/");
              const existing = notebooks.find(
                (entry) => entry.path === path,
              );
              finish({ folderId: existing?.id || "", path });
              return;
            }

            const selected =
              notebooks.find((entry) => entry.id === selectedId) ||
              notebooks.find((entry) => entry.path === ROOT_NOTEBOOK) ||
              notebooks[0];
            if (selected) {
              finish({ folderId: selected.id, path: selected.path });
            } else {
              finish(null);
            }
          } catch (error) {
            Zotero.debug(
              `[Zotero to Joplin] Notebook picker failed: ${error}`,
            );
            finish(null);
          }
        },
      })
      .addButton("取消", "cancel", {
        callback: () => finish(null),
      })
      .setDialogData({
        unloadCallback: () => finish(null),
      })
      .open(options.title || "选择导出位置", {
        width: 640,
        height: showEffectivePath ? 500 : 460,
        centerscreen: true,
        resizable: true,
      });
  });
}
