# Contributing

## Setup

- [pnpm](https://pnpm.io)
- A stable Rust toolchain (`rustup default stable`)
- Tauri's [platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  for the OS you're building on (see "Windows" below)

```sh
pnpm install
pnpm dev:app
```

`pnpm dev:app` runs `scripts/dev.sh`, which wraps `pnpm tauri dev` and tees
its output to `conduit-dev.log` (gitignored) so it can be tailed from
another terminal.

### macOS: avoiding repeated Keychain prompts

`scripts/dev.sh` ad-hoc signs local builds to skip a login-keychain
password prompt during signing. The trade-off: an ad-hoc signature is a
hash of the binary, so it's a new identity every rebuild, and macOS
re-prompts "Conduit wants to use your confidential information" for the
TMDB/Jellyfin keys stored in Keychain (`src-tauri/src/secrets.rs`) on every
build too — "Always Allow" never sticks.

Fix, one-time: create a local self-signed code-signing certificate —
Keychain Access → **Certificate Assistant → Create a Certificate**, set
Identity Type to "Self Signed Root" and Certificate Type to "Code
Signing" — then export its name as `APPLE_SIGNING_IDENTITY` in your shell
profile (`~/.zshrc`, `~/.bashrc`, etc.):

```sh
export APPLE_SIGNING_IDENTITY="Conduit Dev"
```

`scripts/dev.sh` picks up that override automatically. Signing with the
same certificate every build keeps the app's identity stable across
rebuilds, so Keychain remembers "Always Allow" instead of re-prompting.

### Windows

- Visual Studio 2022 Build Tools with the **Desktop development with C++**
  workload (MSVC + a Windows SDK), and the `stable-x86_64-pc-windows-msvc`
  Rust toolchain.
- The WebView2 runtime ships with Windows 10/11, so there's nothing extra
  to install for it.
- Clone to a Windows path (e.g. `C:\dev\conduit`), not a WSL path — cargo
  and `cmd.exe` both misbehave on `\\wsl.localhost\...` UNC paths. From
  WSL, the same checkout is reachable at `/mnt/c/dev/conduit`.
- `pnpm dev:app` needs `bash` on `PATH` (Git for Windows provides it);
  `pnpm tauri dev` works directly otherwise.

## Before opening a PR

Run the full check suite locally — this is exactly what CI
(`.github/workflows/ci.yml`) runs, since `ci.yml` itself just calls this
script:

```sh
./scripts/ci.sh                # add --with-install to also run `pnpm install`
```

There's no automated macOS end-to-end test today — `tauri-driver` (Tauri's
WebDriver harness) doesn't support WKWebView. For anything touching the
grid, settings, navigation, or webview launching, do a manual pass with
`pnpm dev:app`: grid renders, Settings add/edit/remove persists across a
restart, arrow keys move focus sensibly, Enter launches a tile, Cmd+Enter
toggles fullscreen, and the back-to-grid shortcut works from inside a
launched tile. On Windows, use Ctrl in place of Cmd, and Ctrl+Shift+Backspace for
back-to-grid.

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

## Cutting a release

```sh
./scripts/release.sh patch   # or: minor | major
```

Runs the full `scripts/ci.sh` suite, bumps the version everywhere it needs
to stay in sync (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`), updates `CHANGELOG.md`, then
commits/tags/pushes behind two separate confirmation gates (one before the
local commit/tag, one immediately before the push, since pushing the tag
is what triggers `.github/workflows/release.yml`).

## Scope

Windows and macOS only — Linux and Raspberry Pi were evaluated and dropped
(see [`ARCHITECTURE.md`](ARCHITECTURE.md)). [`TODO.md`](TODO.md) is the
source of truth for what's built, what's deferred, and why.
