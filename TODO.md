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

## 2. Settings app: manage the tile list

Second "app" in the launcher: add/edit/remove tiles in the registry (id,
display name, icon, base URL, session partition) through a UI, replacing
the hand-edited config from item 1.

## 3. Remote control support

Wire up remote input (exact remote/protocol TBD based on what's actually
available to test against) to grid navigation and the back-to-menu
shortcut from item 1.

## 4. Keyboard support

Full keyboard navigation of the tile grid (arrow keys/tab, enter to
launch, the back shortcut) — should mostly exist already from item 1;
formalize/complete it here as a first-class input method.

## 5. Controller support

Game-controller D-pad-style spatial navigation across the grid, same
interactions as keyboard/remote.

## 6. Expand the app registry, harden session isolation + navigation confinement

More than one real streaming service tile. Verify session/storage
partitions stay isolated between services (signing into Netflix doesn't
bleed into Hulu) and that the allowed-domain navigation confinement
actually blocks stray redirects, now that there's more than one app to
test it against.

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

## 10. Per-OS autostart / kiosk integration

LaunchAgent (macOS), Startup Task/registry entry (Windows, deferred until
Windows work starts). Document each in a platform-specific README section,
the way HDHR Open's `apple/README.md` and `android/README.md` document their
own platforms.

## 11. Update mechanism

Wire up Tauri's built-in updater against signed GitHub Releases.

## 12. Packaging & release CI

Build matrix in CI for whichever platforms are in scope, a `release.yml`
workflow modeled on Tilora/HDHR Open's, and actual installers/bundles per
platform (Tauri's bundler targets).

## 13. Testing

Rust unit tests for the app registry, navigation-confinement logic, and
session-partition assignment (the parts that are ours and testable in
isolation — the embedded third-party sites obviously aren't). Frontend
component tests for the grid/focus-navigation logic. At least one
end-to-end smoke test (app launches, grid renders, a tile opens its
webview) per platform in CI if feasible.

## 14. Documentation & first release

Flesh out `README.md` past the current early-stage draft (real install
instructions per platform once item 12 exists), add `CONTRIBUTING.md` once
there's an actual dev setup to document, and cut the first tagged release.
