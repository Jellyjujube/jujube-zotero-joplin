# Zotero to Joplin

<img src="assets/icon.svg" width="96" alt="Zotero to Joplin">

Export Zotero items, child notes, and PDF annotations to Joplin. Generated notes keep clickable `zotero://` links back to Zotero.

[中文说明](README-zh.md)

## Features

- One Zotero item → one Joplin note.
- Exports item metadata, optional abstract, child notes, and PDF annotations.
- Annotation types: highlight, underline, text, note, area, ink.
- Image and ink annotations are uploaded as Joplin resources.
- Note and annotation headings link back to Zotero.
- Re-exporting updates the same note and preserves text written outside the generated block.
- Choose an existing Joplin notebook or create a new one; nested paths such as `Zotero/Papers` are supported.

## Requirements

- Zotero 8–10 (tested with Zotero 10.0.8).
- Joplin desktop with the Web Clipper service enabled (tested with Joplin 3.6.15). Joplin must be running when exporting.
- No other Zotero or Joplin plugins are required.

## Installation

1. Download the latest `.xpi` from [Releases](../../releases).
2. In Zotero: **Tools → Add-ons → ⚙ → Install Add-on From File…** and select the `.xpi`.
3. In Joplin: **Settings → Web Clipper**, enable the service, and copy the authorization token.
4. In Zotero: **Settings → Zotero to Joplin**, paste the token, choose a notebook, and click **Test connection**.

## Usage

1. Select one or more Zotero items.
2. Right-click and choose **Export content to Joplin**.
3. Run the export again to update the same note.

## Build

```bash
npm install --include=dev
npm run build
# .scaffold/build/zotero-to-joplin.xpi
```

Unit tests:

```bash
npm run test:unit
```

## License

AGPL-3.0-or-later
