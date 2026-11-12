import {
  deterministicFolderId,
  deterministicNoteId,
  mergeManagedRegion,
  parseImageResources,
} from "../src/modules/sync";
import { ItemData } from "../src/modules/types";
import {
  normalizeFixedSegments,
  resolveDefaultTarget,
  ROOT_NOTEBOOK,
} from "../src/modules/target";
import {
  generateNoteId,
  makeUserData,
  paperKey,
  parseUserData,
  parseUserDataTags,
} from "../src/modules/noteIdentity";

const data = {
  key: "ABCD1234",
  libraryID: 1,
} as ItemData;

const literature = await deterministicNoteId(data, "literature");
const notes = await deterministicNoteId(data, "notes");
const annotations = await deterministicNoteId(data, "annotations");
const folder = await deterministicFolderId(data);

const randomId = await generateNoteId(data);
const randomId2 = await generateNoteId(data);
if (!/^[0-9a-f]{32}$/.test(randomId)) {
  throw new Error(`Invalid random note id: ${randomId}`);
}
if (randomId === randomId2) {
  throw new Error("random note ids should not collide");
}
if (paperKey(data) !== "1:ABCD1234") {
  throw new Error("note map key mismatch");
}
const userData = makeUserData(data);
if (parseUserData(userData) !== "1:ABCD1234") {
  throw new Error("user_data round-trip failed");
}
if (parseUserData("{}") !== null) {
  throw new Error("foreign user_data should be ignored");
}
const taggedUserData = makeUserData(data, [
  " important ",
  "to-read",
  "important",
  "",
]);
if (parseUserDataTags(taggedUserData).join(",") !== "important,to-read") {
  throw new Error("user_data tag round-trip failed");
}
if (parseUserDataTags("{}").length !== 0) {
  throw new Error("foreign user_data tags should be empty");
}

const pathCases: Array<[string, string]> = [
  ["", "Zotero"],
  ["Papers", "Zotero/Papers"],
  ["Zotero/Papers", "Zotero/Papers"],
  ["/Zotero/Papers", "Zotero/Papers"],
  ["Other/Papers", "Zotero/Other/Papers"],
];
for (const [input, expected] of pathCases) {
  const actual = normalizeFixedSegments(input).join("/");
  if (actual !== expected) {
    throw new Error(`normalizeFixedSegments(${input}) = ${actual}, expected ${expected}`);
  }
}
if (ROOT_NOTEBOOK !== "Zotero") throw new Error("root notebook mismatch");

const fixedTarget = resolveDefaultTarget({
  defaultLocationSource: "fixed",
  notebookName: "",
} as any);
if (fixedTarget.segments.join("/") !== ROOT_NOTEBOOK) {
  throw new Error("empty default notebook should resolve to Zotero root");
}

const markerBody =
  "![Zotero 注释图片](:/0123456789abcdef0123456789abcdef)<!-- zotero-joplin-image:ANN1:abc123 -->";
const parsedImage = parseImageResources(markerBody).get("ANN1");
if (
  !parsedImage ||
  parsedImage.resourceId !== "0123456789abcdef0123456789abcdef" ||
  parsedImage.hash !== "abc123"
) {
  throw new Error("image resource marker parse failed");
}

for (const id of [literature, notes, annotations, folder]) {
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
}
if (new Set([literature, notes, annotations, folder]).size !== 4) {
  throw new Error("IDs should be distinct per kind");
}
const literature2 = await deterministicNoteId(data, "literature");
if (literature !== literature2) throw new Error("deterministic id changed");

const generated = `<!-- zotero-joplin:begin item=ABCD1234 kind=literature -->\nnew\n<!-- zotero-joplin:end -->`;
const existing = `My notes\n\n<!-- zotero-joplin:begin item=ABCD1234 kind=literature -->\nold\n<!-- zotero-joplin:end -->\n\nAfter`;
const merged = mergeManagedRegion(existing, generated);
if (!merged || !merged.includes("My notes") || !merged.includes("After")) {
  throw new Error(`merge lost surrounding text: ${merged}`);
}
if (merged.includes("old") || !merged.includes("new")) {
  throw new Error(`merge did not replace block: ${merged}`);
}
if (mergeManagedRegion("no markers", generated) !== null) {
  throw new Error("missing markers should return null");
}

console.log(
  "sync utils test: OK",
  JSON.stringify({ literature, notes, annotations, folder }),
);
