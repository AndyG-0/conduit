# Changelog

All notable changes to Conduit are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Windows support (WebView2). Each release now also ships an unsigned
  Windows `.msi` and NSIS `-setup.exe` alongside the macOS `.dmg`/`.app.zip`.
- Windows menubar (File/Edit/View/Window/Help), hidden while full screen.
- Ctrl-based shortcuts on Windows; return-to-grid is Ctrl+Shift+Backspace,
  because Windows reserves Ctrl+Shift+Escape for Task Manager. Help lists
  each platform's own shortcuts.
- Full-screen toggle button in Settings.
- Multi-arch (amd64/arm64) Docker images for the self-hosted PWA, published
  to `ghcr.io/andyg-0/conduit` on each tagged release.

### Changed

- `docker-compose.yml` now pulls the published server image by default
  (`docker compose up -d --build` still builds from source). Caddy's
  host-published ports are configurable via `HTTP_PORT`/`HTTPS_PORT` env
  vars (see `.env.example`), defaulting to 80/443 as before.

- The ESPN tile opens ESPN's watch page (`espn.com/watch/`). Existing
  installs still on the old default are migrated.
- View > Home and the back-to-grid shortcut also close Settings and Help.
- Settings keeps its header and Back button pinned while scrolling, and
  keeps its scroll position after saving.

### Fixed

- ESPN playback on Windows (Chrome UA and Client Hints for ESPN, whose
  player fails under Edge's PlayReady path).
- Prime Video playback on Windows (`chrome.webview` hidden from pages).
- Tile favicons for sites whose base URL is a client-side route (e.g.
  Jellyfin), and SPA servers answering an unknown icon path with HTML.
- A tall grid is no longer cut off at the top in short windows.
- Scripts that Conduit injects into tile pages can reach the app again.
  Tauri rejects commands from remote pages that no capability allows, so
  the screensaver never saw activity inside a tile, and finished sign-in
  popups didn't close. Those pages are now granted exactly those two
  commands and nothing else.

### Security

- Debug logging to a temp file is compiled out of release builds.

## [0.1.1] - 2026-09-27

- MacOS release
- Initial commit: macOS single-tile prototype, scope decided to Windows/macOS
