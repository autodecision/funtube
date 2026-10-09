# Funtube

A standalone Electron YouTube/Rumble guide with a curated demo library and a classic cable-TV layout: program preview across the top, a compact blue channel grid, and an icon bar for categories and settings. Select a show by clicking, hovering, or using the arrow keys to see its thumbnail, channel, upload date, and original provider description in the top preview section. Clicking pins the preview so hovering another show keeps the selected description; click another show or use the keyboard to change it. Changing categories, sections, or upload pages enables hover previews again. The guide stays visible below. Long descriptions scroll within the preview, and the separate Watch link opens the video in your browser. Columns show recent uploads rather than broadcast times.

## Run

Requires Node.js 24 or newer for development.

```sh
cd ~/Projects/funtube
npm ci
npm start
```

`npm start` builds the renderer and opens the Electron window. `npm run package` produces an unpacked application for the current platform in `release/`; run its `Funtube` executable directly. `npm test` checks the demo library, cached feeds, input validation, and network restrictions.

## Local library

The first launch imports `data/channel-snapshot.json`: 23 demo channels (20 YouTube, 3 Rumble), with saved upload history for each so the guide is useful immediately. The selection focuses on science, technology, wildlife, cooking, art, and outdoor projects. It was checked on October 5, 2026. Channels publish independently and their future uploads may change. There are no continuous music-radio channels in the demo.

Subsequent launches use your own SQLite database under Electron's user-data directory (`~/.config/Funtube/funtube.sqlite` on Linux, or `$XDG_CONFIG_HOME/Funtube`). Channel edits are local and do not modify the bundled demo. Deleting channels does not cause the demo to reappear.

Use **Settings & channels** to add YouTube/Rumble channel URLs or YouTube @handles, edit groups, disable channels, or remove them. Channel edits and feed caches persist across restarts.

**Categories & sections** offers 16 category presets with 64 suggested sections, plus a searchable collection of 102 original SVG icons. The six original categories are available initially; add other presets as needed, or create your own categories and sections with any library icon. Sections belong to a category. Channel forms offer these saved groups, the dock includes custom categories, and section buttons filter a category's guide. Group names and icon choices persist in SQLite. Renaming or moving a section updates its channel assignments; groups containing channels must be emptied before removal. Existing channel labels are imported during migration.

The artwork lives in `shared/icon-library.js`, with stable icon IDs, display names, collections, and 32×32 SVG path data. `shared/group-presets.js` maps presets to that library. Each preset category and section has distinct artwork, and extra icons cover custom interests such as pets, aviation, crafts, security, coffee, and favorites.

Run `npm run icons:export` to generate individual SVG files, a JSON catalog, and a searchable download gallery at `build/icons/index.html`. These generated assets are ignored by Git; the shared library is their source.

YouTube's public Videos pages provide history without a key, with RSS as a fallback. The bundled library includes at least a year of uploads (or the entire available list for newer channels). Use Newer / Older above the grid to browse four videos at a time. Public channel-list dates are approximate and marked as such; API/RSS dates are exact. An optional YouTube Data API key paginates through at least a year of uploads, bounded to 1,000 candidates per refresh, before excluding Shorts. RSS refreshes merge new uploads into saved history rather than replacing it. Rumble public channel pages also paginate through a year of history. Rumble refreshes from public channel pages; an optional Firecrawl API key provides a recent-feed fallback if public pages are blocked. Configure these in the app or provide `YOUTUBE_API_KEY` / `FIRECRAWL_API_KEY` in the launch environment. Site credentials are not copied. Saved keys stay in an owner-only local file and are never returned to the renderer; these files are private plaintext, not an encrypted vault. Blank fields preserve existing keys, and Clear removes locally saved values. An environment key still applies after clearing a saved value.

Feeds refresh when a group opens and its cache is older than 12 hours. If the provider is unavailable, the last successful feed remains visible with a status message. Video descriptions load when you select a show and stay in the local feed cache for later viewing, including offline. YouTube descriptions use saved RSS/API metadata or the public video page; Rumble descriptions use the public video page. Unavailable descriptions show a retry option; no description is invented. Watch opens the provider in your default browser.

## Structure

- `electron/`: main process, narrow preload IPC, local SQLite, feed fetching, URL/security checks.
- `src/`: React/TypeScript guide, preview, and local settings.
- `data/`: public demo channel metadata and saved feeds only.
- `docs/demo-channels.md`: full default lineup and provider links.

The app uses a sandboxed renderer with context isolation and no Node integration. IPC accepts only the bundled main frame. There is no HTTP listener, site login, Tailnet dependency, or remote Funthing backend. Provider requests have an HTTPS/domain allowlist, redirect checks, timeouts, and a 2 MiB response cap. Images use a fixed provider-CDN allowlist and content is rendered as text. Permissions and embedded webviews are disabled.

## Sharing on GitHub

The project contains only the demo library. Personal channel exports, databases, credentials, build outputs, and screenshots belong outside the repository or are ignored by `.gitignore`. Saved feeds contain public video metadata and remote image URLs; no video, audio, or thumbnail files are bundled. Channel names and links identify their creators; this app has no affiliation with them.
