import { PluginSettings } from "./types";

interface RequestOptions {
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  allow404?: boolean;
  responseType?: "json" | "text";
}

interface DecodedDataUri {
  mime: string;
  bytes: Uint8Array;
}

function decodeBase64(input: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }

  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;

  const outLength = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(Math.max(0, outLength));
  let outPos = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (outPos < out.length) out[outPos++] = (n >> 16) & 0xff;
    if (outPos < out.length) out[outPos++] = (n >> 8) & 0xff;
    if (outPos < out.length) out[outPos++] = n & 0xff;
  }

  return out;
}

function utf8Encode(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  const escaped = unescape(encodeURIComponent(text));
  const out = new Uint8Array(escaped.length);
  for (let i = 0; i < escaped.length; i++) {
    out[i] = escaped.charCodeAt(i);
  }
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function decodeDataUri(dataUri: string): DecodedDataUri {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUri);
  if (!match) {
    throw new Error("Invalid image data URI");
  }
  const mime = match[1] || "image/png";
  const isBase64 = !!match[2];
  const payload = match[3];
  return {
    mime,
    bytes: isBase64
      ? decodeBase64(payload)
      : utf8Encode(decodeURIComponent(payload)),
  };
}

function buildMultipartBody(
  boundary: string,
  props: Record<string, unknown>,
  filename: string,
  mime: string,
  bytes: Uint8Array,
): Uint8Array {
  const safeFilename = filename.replace(/["\r\n]/g, "_");
  const head = utf8Encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="props"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(props)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"; filename="${safeFilename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = utf8Encode(`\r\n--${boundary}--\r\n`);
  return concatBytes([head, bytes, tail]);
}

function normalizeBaseUrl(url: string): string {
  let base = String(url || "").trim();
  if (!base) base = "http://127.0.0.1:41184";
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base.replace(/\/+$/, "");
}

export class JoplinClient {
  private baseUrl: string;
  private token: string;

  constructor(settings: PluginSettings) {
    this.baseUrl = normalizeBaseUrl(settings.joplinBaseUrl);
    this.token = String(settings.joplinToken || "").trim();
  }

  private buildUrl(
    path: string,
    query?: RequestOptions["query"],
  ): string {
    const url = new URL(path.replace(/^\/+/, ""), `${this.baseUrl}/`);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; data: any; text: string }> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    const xhr = await Zotero.HTTP.request(method, url, {
      body,
      headers,
      responseType: options.responseType || "json",
      successCodes: false,
      timeout: 30000,
    } as any);

    const status = Number(xhr.status || 0);
    let text = "";
    try {
      text = String(xhr.responseText || "");
    } catch {
      // responseText is not available for responseType="json" in some engines.
    }
    if (status === 404 && options.allow404) {
      return { status, data: null, text };
    }
    if (status < 200 || status >= 300) {
      let detail = text;
      try {
        detail = JSON.parse(text).error || text;
      } catch {
        // Keep raw text.
      }
      throw new Error(
        `Joplin API ${method} ${path} failed (HTTP ${status})${
          detail ? `: ${detail}` : ""
        }`,
      );
    }
    return { status, data: (xhr as any).response ?? null, text };
  }

  async ping(): Promise<void> {
    const result = await this.request("GET", "/ping", {
      responseType: "text",
    });
    if (!result.text.includes("JoplinClipperServer")) {
      throw new Error(
        "目标地址不是 Joplin Web Clipper 服务。请检查地址和端口。",
      );
    }
  }

  async getNote(noteId: string): Promise<any | null> {
    const result = await this.request("GET", `/notes/${noteId}`, {
      query: {
        fields:
          "id,title,body,parent_id,updated_time,deleted_time,is_conflict",
      },
      allow404: true,
    });
    return result.status === 404 ? null : result.data;
  }

  async createNote(note: {
    id: string;
    title: string;
    body: string;
    parent_id?: string;
    user_data?: string;
  }): Promise<any> {
    const result = await this.request("POST", "/notes", {
      body: note,
    });
    return result.data;
  }

  async updateNote(
    noteId: string,
    fields: {
      title?: string;
      body?: string;
      parent_id?: string;
      user_data?: string;
    },
  ): Promise<any> {
    const result = await this.request("PUT", `/notes/${noteId}`, {
      body: fields,
    });
    return result.data;
  }

  /**
   * Fetch all notes (including trash and conflict copies) with just the
   * fields needed to build the Zotero -> Joplin note index.
   */
  async listAllNotesForSync(): Promise<any[]> {
    const notes: any[] = [];
    let page = 1;

    while (true) {
      const result = await this.request("GET", "/notes", {
        query: {
          fields:
            "id,user_data,is_conflict,deleted_time,created_time,parent_id,title",
          include_deleted: 1,
          include_conflicts: 1,
          page,
          limit: 100,
        },
      });
      const items: any[] = Array.isArray(result.data?.items)
        ? result.data.items
        : [];
      notes.push(...items);
      if (!result.data?.has_more) break;
      page++;
      if (page > 1000) break;
    }

    return notes;
  }

  async getFolder(folderId: string): Promise<any | null> {
    const result = await this.request("GET", `/folders/${folderId}`, {
      query: { fields: "id,title,parent_id" },
      allow404: true,
    });
    return result.status === 404 ? null : result.data;
  }

  async createFolder(folder: {
    id?: string;
    title: string;
    parent_id?: string;
  }): Promise<any> {
    const result = await this.request("POST", "/folders", {
      body: folder,
    });
    return result.data;
  }

  async updateFolder(
    folderId: string,
    fields: { title?: string; parent_id?: string },
  ): Promise<any> {
    const result = await this.request("PUT", `/folders/${folderId}`, {
      body: fields,
    });
    return result.data;
  }

  async findFolderByTitle(
    title: string,
    parentId?: string,
  ): Promise<any | null> {
    const trimmed = String(title || "").trim();
    if (!trimmed) return null;

    const result = await this.request("GET", "/search", {
      query: {
        query: trimmed,
        type: "folder",
        fields: "id,title,parent_id",
      },
    });
    const items: any[] = Array.isArray(result.data?.items)
      ? result.data.items
      : [];
    return (
      items.find(
        (item) =>
          item.title === trimmed &&
          (!parentId || item.parent_id === parentId),
      ) || null
    );
  }

  /**
   * List all notebooks with full paths, e.g. "Zotero/Papers".
   */
  async listNotebooks(): Promise<
    Array<{ id: string; title: string; path: string }>
  > {
    const result = await this.request("GET", "/folders");
    const roots: any[] = Array.isArray(result.data?.items)
      ? result.data.items
      : [];

    const out: Array<{ id: string; title: string; path: string }> = [];
    const seen = new Set<string>();

    const add = (node: any, prefix: string) => {
      const id = String(node?.id || "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      const title = String(node?.title || "");
      const path = prefix ? `${prefix}/${title}` : title;
      out.push({ id, title, path });
      if (Array.isArray(node?.children)) {
        for (const child of node.children) {
          add(child, path);
        }
      }
    };

    for (const node of roots) {
      add(node, "");
    }

    // If the API returned a flat list without `children`, build paths from
    // `parent_id`.
    const flat: any[] = [];
    const collectFlat = (nodes: any[]) => {
      for (const node of nodes) {
        flat.push(node);
        if (Array.isArray(node?.children)) collectFlat(node.children);
      }
    };
    collectFlat(roots);
    if (flat.some((node) => node.parent_id)) {
      const byId = new Map<string, any>(
        flat.map((node) => [String(node.id), node]),
      );
      const pathOf = (node: any, stack: Set<string>): string => {
        const id = String(node.id);
        if (stack.has(id)) return String(node.title || "");
        stack.add(id);
        const parent = node.parent_id
          ? byId.get(String(node.parent_id))
          : null;
        return parent
          ? `${pathOf(parent, stack)}/${String(node.title || "")}`
          : String(node.title || "");
      };
      for (const node of flat) {
        const id = String(node.id);
        const path = pathOf(node, new Set());
        const existing = out.find((entry) => entry.id === id);
        if (existing) {
          existing.path = path;
        } else {
          out.push({ id, title: String(node.title || ""), path });
        }
      }
    }

    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Ensure a notebook path exists, creating missing levels.
   * "Zotero/Papers" creates Zotero, then Papers inside it.
   */
  async ensureNotebookPath(
    path: string,
  ): Promise<string | undefined> {
    const segments = String(path || "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (!segments.length) return undefined;

    let parentId: string | undefined;
    for (const title of segments) {
      let folder = await this.findFolderByTitle(title, parentId);
      if (!folder) {
        folder = await this.createFolder({
          title,
          parent_id: parentId,
        });
      }
      if (!folder?.id) {
        throw new Error(`无法创建 Joplin 笔记本：${title}`);
      }
      parentId = String(folder.id);
    }
    return parentId;
  }

  async ensureNotebook(name: string): Promise<string | undefined> {
    return this.ensureNotebookPath(name);
  }

  async ensureItemFolder(
    folderId: string,
    title: string,
    parentId?: string,
  ): Promise<string> {
    const existing = await this.getFolder(folderId);
    if (existing) {
      if (parentId && existing.parent_id !== parentId) {
        await this.updateFolder(folderId, { parent_id: parentId });
      }
      return folderId;
    }

    try {
      await this.createFolder({
        id: folderId,
        title,
        parent_id: parentId,
      });
      return folderId;
    } catch (error) {
      // Fall back to a title lookup / non-deterministic creation if custom
      // folder IDs are not accepted.
      const found = await this.findFolderByTitle(title, parentId);
      if (found) return String(found.id);

      const created = await this.createFolder({
        title,
        parent_id: parentId,
      });
      if (!created?.id) throw error;
      return String(created.id);
    }
  }

  async findTag(title: string): Promise<any | null> {
    const trimmed = String(title || "").trim();
    if (!trimmed) return null;

    const result = await this.request("GET", "/search", {
      query: {
        query: trimmed,
        type: "tag",
        fields: "id,title",
      },
    });
    const items: any[] = Array.isArray(result.data?.items)
      ? result.data.items
      : [];
    return items.find((item) => item.title === trimmed) || null;
  }

  async ensureTag(title: string): Promise<string | undefined> {
    const trimmed = String(title || "").trim();
    if (!trimmed) return undefined;

    const existing = await this.findTag(trimmed);
    if (existing) return existing.id;

    const result = await this.request("POST", "/tags", {
      body: { title: trimmed },
    });
    return result.data?.id;
  }

  async addTagToNote(tagId: string, noteId: string): Promise<void> {
    try {
      await this.request("POST", `/tags/${tagId}/notes`, {
        body: { id: noteId },
      });
    } catch {
      // The tag may already be attached, or the note may be temporarily
      // unavailable. Tagging is non-critical, so don't fail the sync.
    }
  }

  async uploadImage(dataUri: string, title: string): Promise<string> {
    const { mime, bytes } = decodeDataUri(dataUri);
    const boundary = `----ZoteroJoplin${Date.now().toString(
      16,
    )}${Math.random().toString(16).slice(2)}`;
    const body = buildMultipartBody(
      boundary,
      { title },
      title,
      mime,
      bytes,
    );
    const url = this.buildUrl("/resources");

    const xhr = await Zotero.HTTP.request("POST", url, {
      body,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      responseType: "json",
      successCodes: false,
      timeout: 60000,
    } as any);

    const status = Number(xhr.status || 0);
    let data: any = (xhr as any).response;
    let text = "";
    try {
      text = String(xhr.responseText || "");
    } catch {
      // responseText is not available for responseType="json".
    }
    if (!data && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (status < 200 || status >= 300) {
      const detail = data?.error || text || "";
      throw new Error(
        `上传图片失败 (HTTP ${status})${detail ? `: ${detail}` : ""}`,
      );
    }
    if (!data?.id) {
      throw new Error("Joplin did not return a resource id");
    }
    return String(data.id);
  }
}
