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
  is available (see [`NOTICE.md`](NOTICE.md)); anything without one falls
  back to a generated monogram badge.
- **Settings** (in-window, gear tile on the grid): add, edit, and remove
  tiles — name, base URL, allowed domains, icon.
- **Session isolation**: each tile gets its own persisted storage partition
  (`src-tauri/src/app_config.rs`), so logins/cookies don't leak between
  services. Navigation is confined to each tile's own allowed domains plus a
  shared SSO allowlist (`src-tauri/src/webview.rs`).
- **Navigation**: arrow-key spatial focus movement, Enter to launch,
  Cmd+Enter to toggle fullscreen, and a global shortcut back to the grid
  from inside a tile. Gamepad D-pad/left-stick navigation reuses the same
  logic (`src/spatial-nav.ts`) but is untested on real hardware.
- **macOS launch at login** via `tauri-plugin-autostart`, toggled from
  Settings.

## Development

Prereqs: [pnpm](https://pnpm.io), a stable Rust toolchain, and Tauri's
[platform prerequisites](https://v2.tauri.app/start/prerequisites/) for
macOS.

```sh
pnpm install
pnpm dev:app       # runs the Tauri dev server (window + hot reload)
```

Useful scripts:

```sh
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit
pnpm format        # prettier --write
pnpm test          # vitest (frontend unit tests)
pnpm build         # production frontend build

cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml
```

All of the above run in CI on every push (`.github/workflows/ci.yml`). See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for more detail.

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
