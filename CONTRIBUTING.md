# Contributing

## Setup

- [pnpm](https://pnpm.io)
- A stable Rust toolchain (`rustup default stable`)
- Tauri's [platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  for the OS you're building on (macOS is the only one currently exercised
  day-to-day; see [`TODO.md`](TODO.md) for Windows status)

```sh
pnpm install
pnpm dev:app
```

`pnpm dev:app` runs `scripts/dev.sh`, which wraps `pnpm tauri dev` and tees
its output to `conduit-dev.log` (gitignored) so it can be tailed from
another terminal.

## Before opening a PR

Run the full check suite locally — this is exactly what CI
(`.github/workflows/ci.yml`) runs:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test

cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

There's no automated macOS end-to-end test today — `tauri-driver` (Tauri's
WebDriver harness) doesn't support WKWebView. For anything touching the
grid, settings, navigation, or webview launching, do a manual pass with
`pnpm dev:app`: grid renders, Settings add/edit/remove persists across a
restart, arrow keys move focus sensibly, Enter launches a tile, Cmd+Enter
toggles fullscreen, and the back-to-grid shortcut works from inside a
launched tile.

## Code conventions

- Rust: standard `rustfmt` formatting, `clippy`-clean with `-D warnings`.
- TypeScript: no frontend framework — the grid and settings view are plain
  DOM manipulation. Keep new UI consistent with that rather than
  introducing a framework for a single feature.
- Pure logic that can be unit tested without the DOM or a running Tauri app
  (e.g. `src/spatial-nav.ts`, domain-confinement checks in
  `src-tauri/src/webview.rs`) should be — see the existing tests for the
  pattern.
- Adding a new seeded streaming service: add it to `default_seed()` in
  `src-tauri/src/app_config.rs`, and if you have a legitimately-licensed
  brand mark for it, add the SVG to `src/assets/logos/`, wire it into
  `src/icons.ts`, and record its source/license in
  [`NOTICE.md`](NOTICE.md). Don't add a logo you can't attribute — the
  monogram fallback exists for exactly this case.

## Scope

Windows and macOS only — Linux and Raspberry Pi were evaluated and dropped
(see [`ARCHITECTURE.md`](ARCHITECTURE.md)). [`TODO.md`](TODO.md) is the
source of truth for what's built, what's deferred, and why.
