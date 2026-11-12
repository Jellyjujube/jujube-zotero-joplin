import http from "node:http";
import { JoplinClient } from "../src/modules/joplinClient";
import { PluginSettings } from "../src/modules/types";

const notes = new Map<string, any>();
const folders = new Map<string, any>();
const tags = new Map<string, any>();

let folderCounter = 1;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const send = (status: number, data?: any, text?: string) => {
    res.statusCode = status;
    if (text !== undefined) {
      res.setHeader("Content-Type", "text/plain");
      res.end(text);
    } else {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    }
  };

  if (url.pathname === "/ping") return send(200, undefined, "JoplinClipperServer");
  if (url.pathname === "/search") {
    const type = url.searchParams.get("type");
    const items =
      type === "folder"
        ? [...folders.values()]
        : type === "tag"
          ? [...tags.values()]
          : [];
    return send(200, { items, has_more: false });
  }
  if (url.pathname === "/folders" && req.method === "POST") {
    const folder = {
      id: body.id || `folder${folderCounter++}`,
      title: body.title,
      parent_id: body.parent_id || "",
      user_data: body.user_data || "",
    };
    folders.set(folder.id, folder);
    return send(200, folder);
  }
  if (url.pathname === "/folders" && req.method === "GET") {
    const build = (parentId: string): any[] =>
      [...folders.values()]
        .filter((folder) => (folder.parent_id || "") === parentId)
        .map((folder) => ({
          ...folder,
          children: build(folder.id),
        }));
    const tree = build("");
    if (url.searchParams.get("as_tree") === "1") {
      return send(200, tree);
    }
    return send(200, { items: tree, has_more: false });
  }
  if (url.pathname.startsWith("/folders/")) {
    const id = url.pathname.split("/")[2];
    if (req.method === "GET") {
      const folder = folders.get(id);
      return folder ? send(200, folder) : send(404, { error: "not found" });
    }
    if (req.method === "PUT") {
      const folder = folders.get(id);
      if (!folder) return send(404, { error: "not found" });
      Object.assign(folder, body);
      return send(200, folder);
    }
  }
  if (url.pathname === "/notes" && req.method === "GET") {
    const items = [...notes.values()].map((note) => ({
      id: note.id,
      user_data: note.user_data || "",
      is_conflict: 0,
      deleted_time: 0,
      created_time: 0,
      parent_id: note.parent_id || "",
      title: note.title,
    }));
    return send(200, { items, has_more: false });
  }
  if (url.pathname === "/notes" && req.method === "POST") {
    notes.set(body.id, { ...body });
    return send(200, notes.get(body.id));
  }
  if (/^\/notes\/[^/]+\/tags$/.test(url.pathname) && req.method === "GET") {
    return send(200, {
      items: [{ id: "tag1", title: "important" }],
      has_more: false,
    });
  }
  if (url.pathname.startsWith("/notes/")) {
    const id = url.pathname.split("/")[2];
    if (req.method === "GET") {
      const note = notes.get(id);
      return note ? send(200, note) : send(404, { error: "not found" });
    }
    if (req.method === "PUT") {
      const note = notes.get(id);
      if (!note) return send(404, { error: "not found" });
      Object.assign(note, body);
      return send(200, note);
    }
  }
  if (url.pathname === "/tags" && req.method === "POST") {
    const tag = { id: "tag1", title: body.title };
    tags.set(tag.id, tag);
    return send(200, tag);
  }
  if (url.pathname === "/tags/tag1/notes" && req.method === "POST") {
    return send(200, {});
  }
  if (
    /^\/tags\/[^/]+\/notes\/[^/]+$/.test(url.pathname) &&
    req.method === "DELETE"
  ) {
    return send(200, {});
  }
  if (url.pathname === "/resources" && req.method === "POST") {
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.startsWith("multipart/form-data; boundary=")) {
      return send(400, { error: `bad content type: ${contentType}` });
    }
    if (
      !raw.includes('name="props"') ||
      !raw.includes('name="data"') ||
      !raw.includes("PNG")
    ) {
      return send(400, { error: "bad multipart body" });
    }
    return send(200, {
      id: "resource1",
      title: "test.png",
      mime: "image/png",
    });
  }
  return send(404, { error: "unknown" });
});

await new Promise<void>((resolve) => server.listen(41185, "127.0.0.1", resolve));

(globalThis as any).Zotero = {
  HTTP: {
    request: async (method: string, url: string, options: any) => {
      const response = await fetch(url, {
        method,
        headers: options?.headers,
        body: options?.body,
      });
      const text = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      return { status: response.status, response: data, responseText: text };
    },
  },
};

const settings: PluginSettings = {
  joplinBaseUrl: "http://127.0.0.1:41185",
  joplinToken: "test-token",
  notebookName: "Zotero",
  exportLocationMode: "default",
  defaultLocationSource: "fixed",
  includeImages: true,
  includeAbstract: false,
  includeTags: true,
};

const client = new JoplinClient(settings);
await client.ping();
const notebookId = await client.ensureNotebook("Zotero");
if (notebookId !== "folder1") throw new Error("notebook id mismatch");

const nestedId = await client.ensureNotebookPath("Zotero/Papers");
if (!nestedId) throw new Error("nested notebook not created");
const notebooks = await client.listNotebooks();
if (!notebooks.some((entry) => entry.path === "Zotero/Papers")) {
  throw new Error("nested notebook path missing");
}

const collectionFolderId = await client.ensureCollectionFolder(
  notebookId,
  1,
  "COL1",
  "My Collection",
);
const renamedCollectionFolderId = await client.ensureCollectionFolder(
  notebookId,
  1,
  "COL1",
  "Renamed Collection",
);
if (collectionFolderId !== renamedCollectionFolderId) {
  throw new Error("collection folder should be reused after rename");
}
const collectionFolder = await client.getFolder(collectionFolderId);
if (!collectionFolder || collectionFolder.title !== "Renamed Collection") {
  throw new Error("collection folder rename failed");
}

const slashFolderId = await client.ensureFolderChain([
  "Zotero",
  "A/B Collection",
]);
const slashFolder = await client.getFolder(slashFolderId);
if (!slashFolder || slashFolder.title !== "A/B Collection") {
  throw new Error("folder title containing slash was split");
}
const underRoot = await client.listNotebooksUnderRoot("Zotero");
if (!underRoot.items.some((entry) => entry.id === collectionFolderId)) {
  throw new Error("collection folder missing from root listing");
}

const itemFolderId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ensuredFolder = await client.ensureItemFolder(
  itemFolderId,
  "Paper Folder",
  notebookId,
);
if (ensuredFolder !== itemFolderId) throw new Error("item folder id mismatch");
const itemFolder = await client.getFolder(itemFolderId);
if (!itemFolder || itemFolder.parent_id !== notebookId) {
  throw new Error("item folder parent mismatch");
}

const created = await client.createNote({
  id: "0123456789abcdef0123456789abcdef",
  title: "Title",
  body: "Body",
  parent_id: notebookId,
});
if (created.id !== "0123456789abcdef0123456789abcdef") throw new Error("create failed");

const fetched = await client.getNote(created.id);
if (!fetched || fetched.title !== "Title") throw new Error("get failed");

await client.updateNote(created.id, { body: "Body 2" });

const noteTags = await client.listNoteTags(created.id);
if (!noteTags.some((tag) => tag.id === "tag1" && tag.title === "important")) {
  throw new Error("note tag listing failed");
}
await client.removeTagFromNote("tag1", created.id);
const updated = await client.getNote(created.id);
if (updated.body !== "Body 2") throw new Error("update failed");

const userData = JSON.stringify({
  "zotero-joplin": { libraryID: 1, key: "TESTKEY1" },
});
await client.updateNote(created.id, { user_data: userData });
const allNotes = await client.listAllNotesForSync();
const indexed = allNotes.find((note) => note.id === created.id);
if (!indexed || !String(indexed.user_data).includes("TESTKEY1")) {
  throw new Error("user_data index failed");
}

const tagId = await client.ensureTag("important");
if (tagId !== "tag1") throw new Error("tag failed");
await client.addTagToNote(tagId, created.id);

const missing = await client.getNote("ffffffffffffffffffffffffffffffff");
if (missing !== null) throw new Error("missing note should be null");

const png1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const resourceId = await client.uploadImage(
  `data:image/png;base64,${png1x1}`,
  "test.png",
);
if (resourceId !== "resource1") throw new Error("resource upload failed");

console.log("JoplinClient mock test: OK");
server.close();
