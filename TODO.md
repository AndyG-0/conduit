# TODO

Chronological build order, not by-feature or by-effort — items are listed in
the order they need to happen. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for
the stack decision, the Raspberry Pi spike results, and the alternatives
considered if the primary approach hits a wall on some platform.

The Pi DRM spike is done (`spikes/pi-drm/README.md`) — hard negative. The
general-Linux desktop spike (`spikes/linux-vm-drm/README.md`) also surfaced
a real architecture cost (see item 7a). **Scope is now Windows and macOS
only** — Linux and Pi are dropped, not deferred. Active work is the macOS
build-out (item 6 onward below), since macOS is immediately testable;
Windows verification (item 8) follows once that's solid.

## 1. macOS prototype: single-tile launcher, Netflix (blocking)

The smallest possible proof of the whole stack decision. Tauri app, macOS
only for now:

- Scaffold `src-tauri/` + `src/` (`cargo tauri init` or current
  equivalent). Set up baseline quality tooling at the same time, not
  after: `rustfmt` + `clippy` for `src-tauri/`, `eslint`/`prettier` (or
  chosen frontend tooling's equivalents) for `src/`, and a CI workflow
  (`.github/workflows/ci.yml`) that runs both on every push.
- A window that can run either normally windowed or in a fullscreen
  "big-picture" mode (Steam Big Picture-style toggle) — both first-class
  from the start, not fullscreen-kiosk-only.
- One hardcoded tile: Netflix. Activating it opens a Tauri-hosted,
  WKWebView-based embedded webview (not an iframe — see
  `ARCHITECTURE.md`'s "Alternatives considered" for why that distinction
  matters) with its own session/storage partition.
- A way back to the tile grid from inside Netflix, captured as a
  dedicated key/shortcut at the window level (not a per-site browser
  extension — see `ARCHITECTURE.md`).
- This is the empirical test of the primary architecture: does DRM'd
  1080p Netflix actually play inside a Tauri/WKWebView-hosted view. If it
  doesn't, everything downstream — including the alternatives listed in
  `ARCHITECTURE.md` — is back on the table before more gets built on top
  of this.

## 2. Settings app: manage the tile list — done

Add/edit/remove tiles in the registry (id, display name, icon, base URL,
allowed domains) through an in-window settings view (`src/settings-view.ts`),
backed by `list_apps`/`create_app`/`update_app`/`delete_app` commands and a
persisted `registry.json`, replacing item 1's hardcoded single tile.

## 3. Remote control support

Wire up remote input (exact remote/protocol TBD based on what's actually
available to test against) to grid navigation and the back-to-menu
shortcut from item 1. Still blocked on hardware to test against.

## 4. Keyboard support — done

Arrow-key spatial navigation (`src/spatial-nav.ts`'s `findNextFocusTarget`,
unit tested) plus the existing Enter-to-launch and Cmd+Enter fullscreen
toggle.

## 5. Controller support — best-effort, untested on hardware

D-pad/left-stick navigation (`src/gamepad.ts`) reuses `findNextFocusTarget`
from item 4. No physical game controller was available in the dev
environment to test the actual `Gamepad` API wiring against; the shared
nearest-neighbor logic has unit coverage, but the input plumbing itself
needs a real-hardware check before relying on it.

## 6. Expand the app registry, harden session isolation + navigation confinement — done

12 seeded streaming-service tiles (`default_seed()` in
`src-tauri/src/app_config.rs`) with real base URLs and allowed-domain lists,
plus a shared `COMMON_SSO_DOMAINS` allowlist for cross-service identity
providers. Each tile still gets its own `data_directory()`-backed session
partition keyed by `id`, so cookies/storage don't bleed between services.
Domain-confinement suffix-matching and the SSO-domain carve-out have unit
tests; multi-tile sign-in isolation hasn't been manually verified against
real service logins (that needs real accounts, not something to automate).

Real logos: sourced from `simple-icons` (CC0) and `selfhst/icons`
(CC-BY-4.0, attributed in `NOTICE.md`) — see that file for which mark came
from which set. ESPN and Sling TV aren't in either icon set as of
2026-09-24; those two tiles (and any custom service added through Settings)
fall back to a generated monogram badge.

## 7. Linux (general x86_64): DRM proof-of-concept in a VM — done

**Complete, results in `spikes/linux-vm-drm/README.md`.** Ran on a
Hyper-V VM (Ubuntu 24.04.4 LTS x86_64) on the Windows machine. Soft
negative: WebKitGTK itself works fine on desktop Linux (unlike the Pi), but
Widevine playback still fails (`UI-3001`), confirmed by a Chrome control
test to be a CDM-licensing gap rather than a broken engine or VM/GPU
limitation. CEF was investigated as a fix and ruled out (same licensing
gap, plus a large unmaintained-bindings cost). See `ARCHITECTURE.md`'s
"Linux desktop: architecture decision needed" for the resulting three-way
decision (PWA/client-server pivot for all platforms, Windows/macOS-native
only, or split into two separate projects) — item 7a below.

## 7a. Decide Linux strategy — decided: option 2, Windows/macOS native only

Linux desktop and Pi are dropped from scope. The current Tauri
embedded-webview architecture stands as designed for Windows/macOS; no
PWA/client-server pivot and no separate Linux project. Item 3/5's remote and
controller input work targets a Tauri window only — the CDP-vs-Tauri-window
question this decision was blocking is moot. See `ARCHITECTURE.md`'s "Linux
desktop: architecture decision needed (resolved)" for the full option
writeup this call came from.

## 8. Windows verification

Repeat item 1's DRM check against WebView2. Expected to work per
`ARCHITECTURE.md`'s stack rationale, but not yet empirically checked.
Independent of item 7 — can happen in either order.

## 9. Pi re-check — closed, moot (7a dropped Linux/Pi from scope)

Item 7 *did* come back meaningfully different from the Pi result: desktop
Ubuntu's `libwebkit2gtk-4.1-0` 2.52.3 plays `<video>` fine and only lacks
Widevine, while the Pi's 2.52.6 build couldn't get any `<video>` element
past `HAVE_NOTHING`, DRM'd or not. That's a real data point suggesting the
Pi's bug may be Pi/OS-build-specific rather than a general WebKitGTK 2.52.x
regression — worth a comment on Debian's Pi package bug tracker referencing
this if anyone ever revisits Pi support. No further action planned here now
that 7a has settled on Windows/macOS only.

## 10. Per-OS autostart / kiosk integration — macOS done, Windows deferred

macOS: `tauri-plugin-autostart` (LaunchAgent-based) wired in, with a
"Launch at login" toggle in the settings view. Windows (Startup Task/registry
entry) deferred until Windows work starts — the plugin already supports it,
just not exercised or tested here. Platform-specific README sections still
to be written (item 14).

## 11. Update mechanism — scaffold only, not functional

`tauri-plugin-updater` is added and registered in `src-tauri/src/lib.rs`, and
`src-tauri/tauri.conf.json` has a `plugins.updater` block. Both the
`endpoints` URL and the `pubkey` in that block are **placeholders**
(`REPLACE_ME_*`) — no signing key was generated, since fabricating one would
be worse than leaving this undone. The app starts and runs fine with these
placeholders (confirmed via `cargo check`/`cargo test`); the plugin only
reads/validates them when an update check is actually triggered, and no
frontend "check for updates" affordance is wired up, so nothing currently
calls it.

**Manual steps left to make this real:**
1. `pnpm tauri signer generate` to create a real keypair.
2. Put the generated public key in `tauri.conf.json`'s `plugins.updater.pubkey`,
   replacing the placeholder.
3. Store the private key and its password as GitHub Actions secrets
   (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
4. Point `endpoints` at the real repo once one exists (currently a
   `REPLACE_ME` GitHub Releases URL pattern).
5. Set `bundle.createUpdaterArtifacts: true` in `tauri.conf.json` and pass
   the secrets as env vars in `release.yml`'s build step — left off for now
   since it would fail the build without a real key.
6. Add a capability entry (`updater:default`) and a frontend "check for
   updates" UI once the above is real.

## 12. Packaging & release CI — macOS slice done

`.github/workflows/release.yml`: triggered on `v*` tags, builds an
unsigned/ad-hoc-signed macOS `.app`/`.dmg` via `pnpm tauri build` and
uploads them as workflow artifacts. Deliberately does **not** publish a
GitHub Release — that's a separate, explicit decision (item 14). Real
notarization needs an Apple Developer ID this project doesn't have.
Windows build matrix entry still to come once Windows work starts (item 8).

## 13. Testing — unit-level done, E2E blocked on tooling

Rust unit tests (`src-tauri/src/app_config.rs`, `webview.rs`, run via
`tauri::test::mock_app()`) cover the registry CRUD logic and navigation
domain-confinement, including the SSO-allowlist and suffix-confusion cases.
Frontend unit tests (`vitest`, `src/spatial-nav.test.ts`) cover the
grid/focus-navigation geometry. Both run in CI (`.github/workflows/ci.yml`).

**Not done, and currently not feasible:** an automated end-to-end smoke test
(app launches, grid renders, a tile opens its webview) on macOS. Tauri's
WebDriver harness (`tauri-driver`) only supports WebView2 (Windows) and
WebKitGTK (Linux) — there's no WKWebView backend, so a scripted macOS E2E
test isn't available today. Manual verification (`scripts/dev.sh`) is the
fallback until that changes or an alternative (e.g. driving the app via
Accessibility APIs) gets evaluated. Windows E2E via `tauri-driver` should be
feasible once Windows work starts (item 8) and is worth revisiting then.

## 14. Documentation & first release

Flesh out `README.md` past the current early-stage draft (real install
instructions per platform once item 12 exists), add `CONTRIBUTING.md` once
there's an actual dev setup to document, and cut the first tagged release.
