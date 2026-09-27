# Conduit

A Windows/macOS fullscreen launcher for streaming services. Think Apple TV's
home screen: a grid of "apps," each one really a sandboxed, isolated view
into that service's own web site, navigable with keyboard, mouse, or a game
controller from across the room.

Conduit doesn't reimplement any streaming service — no scraping, no
credential handling beyond what each site's own login page does inside its
own sandboxed session. It's a shell that makes a pile of unrelated
streaming sites feel like one coherent TV interface.

**Status: macOS build-out done, Windows verification next.** A
registry-driven app grid (12 seeded services + custom tiles via Settings),
keyboard and best-effort gamepad spatial navigation, per-tile session
isolation with domain-confinement, and macOS launch-at-login are all
working. See [`TODO.md`](TODO.md) for exactly what's done vs. deferred,
including known gaps (no physical gamepad was available to test against;
automated macOS E2E isn't feasible with current Tauri tooling). Linux and
Raspberry Pi were part of the original premise but are now out of scope —
see [`ARCHITECTURE.md`](ARCHITECTURE.md) for why.

## Stack

- **Tauri** (Rust core + OS-native webview — WebView2 on Windows, WKWebView
  on macOS) rather than Electron, because Windows/macOS get their platform's
  licensed DRM stack for free. Full rationale is in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **TypeScript + Vite** for the launcher UI (no frontend framework — the grid
  and settings view are plain DOM).

## Features

- **App grid**: 12 seeded streaming-service tiles (Netflix, Hulu, Disney+,
  Paramount+, Peacock, Tubi, ESPN, YouTube TV, Sling TV, HBO Max, Prime
  Video, Apple TV+) with real brand logos where a legitimately-licensed mark
  is available (see [`NOTICE.md`](NOTICE.md)); tiles without one fall back to
  that site's own favicon, then a generated monogram badge if the favicon
  fails to load.
- **Settings** (in-window, gear tile on the grid): add, edit, and remove
  tiles — name, base URL, an optional list of additional allowed domains,
  and an optional icon override that forces one of the vendored brand logos
  instead of the favicon.
- **Session isolation**: each tile gets its own persisted storage partition
  (`src-tauri/src/app_config.rs`), so logins/cookies don't leak between
  services. Navigation is confined to each tile's own domain (derived
  automatically from its base URL) plus a shared SSO allowlist and any
  additional domains configured for that tile (`src-tauri/src/webview.rs`).
- **Navigation**: arrow-key spatial focus movement, Enter to launch,
  Cmd+Enter to toggle fullscreen, and a global shortcut back to the grid
  from inside a tile. Gamepad D-pad/left-stick navigation reuses the same
  logic (`src/spatial-nav.ts`) but is untested on real hardware.
- **Window chrome**: a tile plays embedded in the same window as the grid,
  in both windowed and fullscreen mode — there's a single titlebar, always
  present and draggable in windowed mode, not a separate window per tile.
  A global shortcut and a "Refresh" menu-bar item reload a stuck tile.
  Picture-in-picture (`Cmd+Shift+P`, or View > Picture in Picture) pops the
  active tile out into a small always-on-top corner window that floats
  over other apps, independent of Conduit's own window.
- **Help** (in-window, `?` tile on the grid): a keyboard-shortcuts reference
  and a short overview of how tiles and icons work.
- **macOS launch at login** via `tauri-plugin-autostart`, toggled from
  Settings.

## Keyboard shortcuts

| Shortcut            | Action                                        |
| -------------------- | ---------------------------------------------- |
| Arrow keys           | Move focus around the grid                     |
| Enter                | Launch the focused tile                        |
| Cmd+Enter            | Toggle full screen                             |
| Cmd+Shift+Escape     | Return to the grid from a tile                 |
| Cmd+Shift+R          | Refresh the active tile                        |
| Cmd+Shift+P          | Toggle picture-in-picture for the active tile  |
| Cmd+[                | Go back in the active tile's history           |
| Cmd+]                | Go forward in the active tile's history        |
| Cmd+Shift+H          | Return to the tile grid (View > Home)          |
| ?                    | Open the Help panel                            |
| Escape               | Close a panel (Settings or Help)               |

## Development

```sh
pnpm install
pnpm dev:app       # runs the Tauri dev server (window + hot reload)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for prerequisites, the full check
suite, and code conventions.

## Releasing

Tagged releases are built and published automatically
(`.github/workflows/release.yml`): a `v*` tag push builds an ad-hoc-signed
macOS `.app`/`.dmg` and publishes them as a GitHub Release, with the
matching [`CHANGELOG.md`](CHANGELOG.md) section as the release notes.
Releases are ad-hoc signed, not notarized (no Apple Developer ID yet), so
macOS Gatekeeper blocks the app on first launch — the release notes explain
the right-click → **Open** workaround. See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for how a release is cut.

## Repository layout

```
src-tauri/   Rust core: window/lifecycle, app registry (registry.json),
             webview orchestration + domain confinement, OS
             autostart/kiosk integration
src/         Launcher UI — app grid, settings view, spatial nav, gamepad
             input, brand icon rendering
spikes/      Throwaway feasibility code (e.g. the Pi/Linux DRM spikes), not
             part of the shipped app
ARCHITECTURE.md   Stack decision, component breakdown, open risks
TODO.md           Chronological build order and current status
NOTICE.md         Third-party asset attribution (brand icons)
```

## License

MIT — see [`LICENSE`](LICENSE).
