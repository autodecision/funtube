# Funtube

A standalone Electron YouTube/Rumble guide with a curated demo library. The existing blue guide, category/section order, channel numbers, lazy feed loading, hover/keyboard preview, and external video links are preserved.

## Run

Requires Node.js 24 or newer for development.

```sh
cd ~/Projects/funtube
npm ci
npm start
```

`npm start` builds the renderer and opens the Electron window. `npm run package` produces an unpacked application for the current platform in `release/`; run its `Funtube` executable directly. `npm test` checks the demo library, cached feeds, input validation, and network restrictions.

## Local library

The first launch imports `data/channel-snapshot.json`: 23 demo channels (20 YouTube, 3 Rumble), with a small saved feed for each so the guide is useful immediately. The selection focuses on science, technology, wildlife, cooking, art, and outdoor projects. It was checked on October 5, 2026. Channels publish independently and their future uploads may change. There are no continuous music-radio channels in the demo.

Subsequent launches use your own SQLite database under Electron's user-data directory (`~/.config/Funtube/funtube.sqlite` on Linux, or `$XDG_CONFIG_HOME/Funtube`). Channel edits are local and do not modify the bundled demo. Deleting channels does not cause the demo to reappear.

Use **Settings & channels** to add YouTube/Rumble channel URLs or YouTube @handles, edit groups, disable channels, or remove them. Channel edits and feed caches persist across restarts.

YouTube's public RSS works without a key. An optional YouTube Data API key checks more uploads before excluding Shorts. Fresh Rumble feeds require a Firecrawl API key; existing saved Rumble feeds still display without one. Configure these in the app or provide `YOUTUBE_API_KEY` / `FIRECRAWL_API_KEY` in the launch environment. Site credentials are not copied. Saved keys stay in an owner-only local file and are never returned to the renderer; these files are private plaintext, not an encrypted vault. Blank fields preserve existing keys, and Clear removes locally saved values. An environment key still applies after clearing a saved value.

Feeds refresh when a group opens and its cache is older than 12 hours. If the provider is unavailable, the last successful feed remains visible with a status message. Clicking a video opens its provider in your default browser, as it did on the website.

## Structure

- `electron/`: main process, narrow preload IPC, local SQLite, feed fetching, URL/security checks.
- `src/`: React/TypeScript guide, preview, and local settings.
- `data/`: public demo channel metadata and saved feeds only.
- `docs/demo-channels.md`: full default lineup and provider links.

The app uses a sandboxed renderer with context isolation and no Node integration. IPC accepts only the bundled main frame. There is no HTTP listener, site login, Tailnet dependency, or remote Funthing backend. Provider requests have an HTTPS/domain allowlist, redirect checks, timeouts, and a 2 MiB response cap. Images use a fixed provider-CDN allowlist and content is rendered as text. Permissions and embedded webviews are disabled.

## Sharing on GitHub

The project contains only the demo library. Personal channel exports, databases, credentials, build outputs, and screenshots belong outside the repository or are ignored by `.gitignore`. Saved feeds contain public video metadata and remote image URLs; no video, audio, or thumbnail files are bundled. Channel names and links identify their creators; this app has no affiliation with them.
