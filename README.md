# Zotero to Joplin

<img src="assets/icon.svg" width="96" alt="Zotero to Joplin">

Export Zotero items, child notes, and PDF annotations to Joplin. Generated notes keep clickable `zotero://` links back to Zotero.

[中文说明](README-zh.md)

## Features

- One Zotero item → one Joplin note.
- Exports item metadata, optional abstract, child notes, and PDF annotations.
- Annotation types: highlight, underline, text, note, area, ink.
- Annotations are grouped by page; labels are bold links instead of headings.
- Zotero note headings are re-leveled under the note title so the document outline stays consistent.
- Image and ink annotations are uploaded as Joplin resources.
- Note and annotation headings link back to Zotero.
- Re-exporting updates the same note and preserves text written outside the generated block.
- Export destination options: choose each time, use a default notebook, or follow the Zotero collection tree.
- All exports stay under the `Zotero/` notebook; other Joplin notebooks are never touched.

## Export destination

**Choose each export**

A picker opens after clicking export and lists only notebooks under `Zotero/`. It preselects the last used target, then falls back to the `Zotero` root.

**Use a default location**

- **Default notebook**: all items go to this notebook. Leave it empty to use the `Zotero` root.
- **Follow Zotero collections**: use the collection currently open in the Zotero view. If no single collection can be determined (My Library, saved search, mixed selection), use the `Zotero` root.

If a collection is renamed or moved, the corresponding Joplin notebook is updated. If a collection is deleted, the next export moves its notes back to the `Zotero` root. Joplin notebooks are never deleted automatically.

## Requirements

- Zotero 8–10 (tested with Zotero 10.0.8).
- Joplin desktop with the Web Clipper service enabled (tested with Joplin 3.6.15). Joplin must be running when exporting.
- No other Zotero or Joplin plugins are required.

## Installation

1. Download the latest `.xpi` from [Releases](../../releases).
2. In Zotero: **Tools → Add-ons → ⚙ → Install Add-on From File…** and select the `.xpi`.
3. In Joplin: **Settings → Web Clipper**, enable the service, and copy the authorization token.
4. In Zotero: **Settings → Zotero to Joplin**, paste the token, choose an export destination, and click **Test connection**.

## Usage

1. Select one or more Zotero items.
2. Right-click and choose **Export content to Joplin**.
3. If "Choose each export" is enabled, select a target notebook; cancel to abort.
4. Run the export again to update the same note.

## Build

```bash
npm install
npm run build
# .scaffold/build/zotero-to-joplin.xpi
```

Unit tests:

```bash
npm run test:unit
```

## License

AGPL-3.0-or-later
