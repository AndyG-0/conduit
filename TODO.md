# TODO

Chronological build order for what's still open — items are dropped from
this doc once shipped, not left here marked "done." See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the stack decision and the
Raspberry Pi / general-Linux spike results, and [`README.md`](README.md)
for the current shipped feature set. Items 1, 2, 4, 6, 7, 7a, 9, 12, and 14 from
earlier passes have shipped or closed and are gone from here for that
reason — their content lives in those two docs and in git history, not
duplicated here.

**Scope is Windows and macOS only** — Linux and Pi are dropped, not
deferred (see `ARCHITECTURE.md`). Both platforms build, run, and
ship from the same release workflow. What's open now: finishing Windows
DRM verification (item 8), real-hardware checks for remote/controller
input (items 3/5), Windows autostart/kiosk checks (item 10), and making the
update mechanism real (item 11).

## 3. Remote control support

Wire up remote input (exact remote/protocol TBD based on what's actually
available to test against) to grid navigation and the back-to-menu
shortcut. Still blocked on hardware to test against.

## 5. Controller support — best-effort, untested on hardware

D-pad/left-stick navigation (`src/gamepad.ts`) reuses the same
nearest-neighbor spatial-navigation logic (`findNextFocusTarget`) that
drives keyboard navigation. No physical game controller was available in
the dev environment to test the actual `Gamepad` API wiring against; the
shared nearest-neighbor logic has unit coverage, but the input plumbing
itself needs a real-hardware check before relying on it.

## 8. Windows verification

Repeat the macOS DRM check (see `ARCHITECTURE.md`'s stack decision)
against WebView2. Partially checked: WebView2 exposes both Widevine and
PlayReady (hardware PlayReady SL3000 is not available), and Netflix plays.
ESPN needed a Chrome UA and Client Hints override (`CHROME_USER_AGENT_DOMAINS` in
`src-tauri/src/webview.rs`) because its Disney player routes the Edge
brand to PlayReady and then fails with Error Code 28, even in real Edge.
Still unchecked: the other seeded services.

## 10. Windows autostart / kiosk integration

`tauri-plugin-autostart` is wired in on both platforms, and the Settings
toggle is the same (a registry Run entry on Windows). Still to check on
real hardware: a fresh Windows login actually launches Conduit, and
whether a kiosk-style setup (e.g. Assigned Access, or launching straight
to fullscreen) is worth supporting.

## 11. Update mechanism — scaffold only, not functional

`tauri-plugin-updater` is added and registered in `src-tauri/src/lib.rs`, and
`src-tauri/tauri.conf.json` has a `plugins.updater` block. Both the
`endpoints` URL and the `pubkey` in that block are **placeholders**
(`REPLACE_ME_*`) — no signing key was generated, since fabricating one would
be worse than leaving this undone. The app starts and runs fine with these
placeholders (confirmed via `cargo check`/`cargo test`); nothing currently
calls the updater, since no frontend "check for updates" affordance exists
yet either.

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

## 13. Testing — macOS E2E not currently feasible

Rust and frontend unit tests are in place and run in CI
(`.github/workflows/ci.yml`) — see `CONTRIBUTING.md`. Automated end-to-end
testing (app launches, grid renders, a tile opens its webview) isn't
feasible on macOS today: Tauri's WebDriver harness (`tauri-driver`) only
supports WebView2 (Windows) and WebKitGTK (Linux) — there's no WKWebView
backend. Manual verification (`scripts/dev.sh`) is the fallback until that
changes or an alternative (e.g. driving the app via Accessibility APIs)
gets evaluated. Windows E2E via `tauri-driver` (which does support
WebView2) is feasible now and worth evaluating next.

## 14. First release not yet cut

Cutting the actual first tagged release is still a deliberate manual step
for whenever the maintainer decides it's ready — see `CONTRIBUTING.md` for
the exact steps (`scripts/release.sh`).

## PWA (browser + self-hosted backend)

A second, coexisting surface (`server/`, `web/`, `shared/`) alongside the
native app — see `ARCHITECTURE.md`'s client-server/PWA alternative writeup
for the design rationale and [`DEPLOYMENT.md`](DEPLOYMENT.md) for how to run
it. Kept separate from the numbered list above since it's an independent
build track with its own open items. Workspace scaffolding, the Express
backend (registry/auth/tiles/preferences/favicon-proxy with SSRF guarding),
the frontend rewrite, and the Docker/Caddy deployment are done and verified
(`pnpm -r test` passes across `shared`/`web`/`server`; the Docker image and
compose stack have been built and run end-to-end).

### 15. Screensaver parity — optional, deferred

TMDB/Jellyfin hero-banner parity is done: `server/src/lib/tmdb.ts` and
`server/src/lib/jellyfin-banner.ts` back real implementations of
`GET /api/proxy/trending` and `GET /api/proxy/jellyfin/:tileId`, and
`web/src/trending.ts` / `web/src/jellyfin.ts` port the native app's
`trending.ts`/`jellyfin.ts` to consume them — the hero banner shows real
trending artwork/titles and Jellyfin "recently added" art in the PWA exactly
as it does natively.

`screensaver.ts` (the Apple Aerial video screensaver) is still not ported —
it depends on native-only concepts (fullscreen state, gamepad polling, a
separate native tile webview's activity-relay events) that don't have a PWA
equivalent yet. Out of scope for this work; pick up separately if wanted.

### 16. Real-device verification — not yet done

Everything below needs an actual browser/mobile device on a LAN, which isn't
available in a dev sandbox:
- Caddy's internal-CA cert trust flow and PWA install ("Add to Home Screen")
  on a second LAN device.
- Tile launch → same-tab navigation → browser Back returns to a working
  grid, against at least two real streaming sites (SPA history depth varies
  per site).
- Fullscreen survives a Back-navigation round trip.
- Favicon proxy actually renders in a browser's Network tab (only
  curl/server-side-tested so far).
- A custom tile added through Settings persists across a real container
  restart (persistence logic is unit-tested; an actual restart wasn't).
