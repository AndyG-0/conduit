# Linux x86_64 VM DRM spike — results

**Status: complete. Result: soft negative — isolated to a licensing gap, not
a broken engine.** Ubuntu 24.04.4 LTS (x86_64), `libwebkit2gtk-4.1-0`
2.52.3-0ubuntu0.24.04.1 (same 2.52.x series as the Pi spike's 2.52.6), running
in a Hyper-V VM on Windows (external/bridged virtual switch, no GPU
passthrough). Tested 2026-09-24.

## TL;DR

1. **The Tauri/WebKitGTK stack itself works on desktop x86_64.** Built and
   ran a real release build of this repo's `src-tauri` in the VM's GNOME
   session; the embedded webview loaded and rendered netflix.com correctly —
   no `<video>`-element-never-initializes bug like the Pi hit.
2. **Playback fails with Netflix's `UI-3001` error**, consistent with
   missing EME/Widevine, not a general video-engine failure.
3. **Isolated the cause with a control test**: installed real Google Chrome
   (which bundles Google's own licensed Widevine CDM) on the *same* VM,
   pointed it at the same Netflix account, same title — **played back with
   no issue.** This rules out the VM, Hyper-V, lack of GPU passthrough, or
   general Linux video capability as the blocker. It's specifically
   WebKitGTK's lack of a Widevine CDM.
4. This is a materially better result than the Pi spike: general x86_64
   desktop Linux is not blocked by a broken media pipeline, only by the same
   DRM/CDM licensing gap that was already the expected, "boring" failure
   mode going in.

## What was and wasn't tested

Tested: a real packaged build of this repo (`pnpm tauri build`), launched
into the VM's active GNOME/Wayland session, navigating to and interacting
with the actual Netflix site, attempting real playback.

Not tested: an isolated EME/`<video>` probe like the Pi spike's
`probe.html`/`baseline-hls.html` (Phase 1/2). Given the app-level test
already shows the UI, navigation, and page rendering all working normally
with only *playback* failing in the specific way Widevine's absence
predicts, running the isolated probe would likely just confirm the same
thing more granularly — judged low value to do retroactively, but worth
doing if this result needs to be defended more rigorously later.

## Why this isn't fixable by installing packages

No official Widevine CDM exists for WebKitGTK on desktop Linux distros.
Widevine binary distribution is gated by Google to licensed
parties — browsers (Chrome ships it; Firefox ships it) and specific
OEM/embedded partners (e.g. WPE WebKit builds for set-top boxes/smart TVs,
via RDK's Thunder/OpenCDM stack — the same gap identified in the Pi spike).
Mainline desktop WebKitGTK, as shipped by Ubuntu/Fedora/etc., isn't in
either category.

## CEF investigated as a fix — doesn't actually solve this

The natural next question: if WebKitGTK can't do it, embed CEF (Chromium
Embedded Framework) instead, the way Electron does. Two problems, either
one enough to rule it out as a quick fix:

- **Rust CEF bindings are thin and largely unmaintained.** There's no
  Tauri/wry backend for CEF on Linux — adopting it means hand-rolling FFI
  against upstream CEF's C API and carrying that maintenance burden
  indefinitely, including tracking CEF/Chromium version bumps for security
  patches. Large, open-ended engineering cost.
- **Open-source CEF builds don't ship Widevine either**, for the identical
  licensing reason WebKitGTK doesn't. This is exactly why companies like
  castLabs sell prebuilt Widevine-enabled Electron/CEF distributions as a
  commercial product — it's a paid, contractual relationship with Google,
  not a build flag. So CEF alone would cost significant engineering effort
  **and still not play DRM'd content** without a separate licensing deal.

## A path that does work: drive the system's real browser instead of embedding one

Confirmed viable (this is how the control test above was done): launch the
OS's already-installed, already-licensed Chrome as a subprocess in
`--app=<url>` or `--kiosk` mode — no visible browser chrome, looks like an
embedded view — with the Rust shell managing window position/fullscreen and
optionally driving it via the Chrome DevTools Protocol
(`--remote-debugging-port`) instead of Tauri's webview APIs.

- **Pro**: reuses the user's real, already-licensed CDM. No CEF bindings,
  no licensing cost.
- **Con**: requires Chrome/Chromium pre-installed on the target machine
  (can't be bundled into the app binary the way an embedded webview can),
  and it's architecturally "orchestrate an external browser process" rather
  than "one embedded webview Conduit fully owns" — session
  partitioning, navigation confinement, and back-to-menu capture (see
  `ARCHITECTURE.md`'s Rust core section) would all need reimplementing
  against CDP instead of Tauri's webview APIs.

This is functionally the same shape as the "Native launcher + browser
extension" alternative already recorded in `ARCHITECTURE.md`, just without
needing a per-site extension for back-navigation if window-level input
capture (this project's existing plan for that) still works against a
`--kiosk`-mode Chrome window.

## Conclusion for `ARCHITECTURE.md`

Linux desktop (x86_64) is **not** blocked by a broken engine the way the Pi
is. It's blocked by the same DRM/CDM licensing gap as the Pi, but with a
real fix available if the project is willing to change the Linux-specific
architecture from "one embedded WebKitGTK webview" to "drive a real,
externally-installed Chrome" — which is a big enough divergence from the
Windows/macOS approach (native embedded WebView2/WKWebView) that it raises
the question of whether Linux should be the same codebase/project at all.
See `ARCHITECTURE.md`'s Open risks and Alternatives considered sections for
the resulting decision point.
