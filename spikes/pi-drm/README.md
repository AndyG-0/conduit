# Pi DRM + hardware-decode spike — results

**Status: complete. Result: hard negative, on two independent axes.**
Raspberry Pi 4, Raspberry Pi OS (Debian 13 "Trixie"), `webkit2gtk-4.1` 2.52.6
(the exact library Tauri links against on Linux). Tested 2026-09-23.

## TL;DR

1. **Widevine/EME: not supported at all**, even forced on. This was expected
   per the desk research in the plan — confirmed empirically.
2. **Non-DRM H.264 hardware decode: the hardware and OS stack work fine**,
   but **WebKitGTK's `<video>` element is broken on this exact build** — it
   never leaves `readyState == HAVE_NOTHING`, so no video (DRM'd or not)
   currently plays through a WebKitGTK-hosted page on this Pi/OS
   combination. This is a stronger negative than the plan anticipated: it
   was expected that DRM would fail but plain video would work.
3. Given (1) and (2) are both hard blockers **in the exact engine Tauri
   uses**, Phase 4 (building an actual Tauri scaffold to confirm) was
   skipped — it would link the identical `webkit2gtk-4.1` library and
   almost certainly reproduce the same `<video>` lifecycle bug. This is a
   judgment call, not something to take as settled without pushback — see
   "What would change this" below.

## Phase 1 — Widevine/EME probe (`probe.html`)

Served over local HTTP, loaded in a minimal GTK3/WebKit2GTK-4.1 harness
(`eme-harness.c`) with `webkit_settings_set_enable_encrypted_media(TRUE)`
explicitly forced on (OFF by default, and not turned on by Epiphany either).

Result: **`navigator.requestMediaKeySystemAccess` is entirely absent** from
`window.navigator` — not just rejecting Widevine, the API itself doesn't
exist. ClearKey (WebKit's own reference EME implementation, needs no
external CDM) also fails, for the same reason. `MediaSource` support was
present with H264/HEVC codec strings reported supported by
`isTypeSupported`.

This matches the pre-hardware research: WebKitGTK's only path to EME is the
Thunder/OpenCDM stack (an RDK/set-top-box middleware integration, opt-in at
WebKit build time), which Debian's mainline `webkit2gtk` package doesn't
carry. **Netflix login/playback (Phase 3) was skipped** — no EME session
can ever be acquired regardless of account or content, so there's nothing
to gain from testing against a real Netflix title.

## Phase 2 — non-DRM H.264 hardware-decode baseline

Test asset: a well-known public 1080p30 H.264 High-profile test clip
(Blender's *Big Buck Bunny*, 10s, 1920x1080, ~30MB), downloaded locally to
the Pi to remove network variables from the measurement.

### The hardware/OS stack works

Verified two ways:

- **`GST_DEBUG=v4l2*:5`** while loading the clip in the WebKit harness shows
  GStreamer opening `/dev/video10` (`bcm2835-codec-decode`), negotiating
  `v4l2h264dec0` for `1920x1080` H.264 High/5.1, and processing all 300
  frames (10s @ 30fps) through the hardware decoder element.
- **Bypassing WebKit entirely**, a raw pipeline —
  `filesrc ! qtdemux ! h264parse ! v4l2h264dec ! videoconvert ! waylandsink`
  — negotiates caps end-to-end with zero errors, using **zero-copy DMABuf**
  all the way to the Wayland compositor (`video/x-raw(memory:DMABuf),
  format=DMA_DRM`). CPU cost for the harness/decoder process during this
  ran **3-9%** on one core, temp stayed ~52°C, no throttling
  (`vcgencmd get_throttled` = `0x0`). This is a strong, cheap result — the
  Pi 4's hardware decoder has plenty of headroom for 1080p30 H.264.

### But the `<video>` element itself doesn't work

Every attempt to play the same clip through an actual `<video src=...>`
element got stuck at `readyState == 0` (`HAVE_NOTHING`) indefinitely —
`videoWidth`/`videoHeight` stayed `0x0`, no `loadedmetadata` or `canplay`
event ever fired, ending in a `stalled` event. This was 100% reproducible
across every serving method tried:

- Remote HTTPS CDN (original test URL)
- Local `file://` URL
- Local HTTP via Python's `http.server` (no Range support)
- Local HTTP via `busybox httpd` (confirmed proper `206 Partial Content` /
  `Accept-Ranges` support)

...and in **two different WebKitGTK hosts**: the custom C harness (with
every relevant `WebKitSettings` explicitly maxed out — encrypted media,
MediaSource, WebGL, hardware acceleration policy, no user-gesture
requirement) and **stock Epiphany** (the reference WebKitGTK browser),
ruling out a harness-specific misconfiguration.

Meanwhile the GStreamer debug log for these same attempts (via the WebKit
harness) still shows `v4l2h264dec0` being opened and frames being handled —
i.e. **the underlying pipeline WebKit builds is decoding data**, but the
`HTMLMediaElement` state machine (WebCore's `MediaPlayerPrivateGStreamer`)
never reports that back to the DOM. This isolates the bug specifically to
WebKitGTK's media-element glue in this `2.52.6` build on Debian 13, not to
GStreamer, V4L2, the kernel driver, or Wayland output — all of which are
demonstrably fine on their own.

## Why Phase 4 (real Tauri scaffold) was skipped

Confirming DRM playback inside an actual Tauri (WebKitGTK) app — not just a
bare WebKit harness — was the original open question this phase would have
answered. Given Phase 1 and Phase 2 already isolated both failures to the
`webkit2gtk-4.1` library itself — the identical library Tauri links against,
tested via a harness that mirrors Tauri's own webview creation path — a
bare Tauri scaffold's `<video>` element would very likely hit the exact
same `MediaPlayerPrivateGStreamer` bug, since Tauri doesn't patch or replace
WebKitGTK's media pipeline. Building and installing the full Rust/Tauri
toolchain on this 1.8GB-RAM Pi purely to re-observe the same library
behaving the same way didn't seem like a good use of time, but this is a
judgment call — if the empirical difference matters (e.g. Tauri's window
creation path enables something the harness didn't), it's still worth doing
as a follow-up.

## Conclusion for `ARCHITECTURE.md`

Both routes to Pi video playback are currently blocked:

- DRM'd content: blocked by WebKitGTK's total lack of EME/CDM support
  (expected, matches research).
- Non-DRM content (IPTV, HLS, plain files): blocked by an apparent
  WebKitGTK `<video>` element bug on this specific OS/library version,
  **despite the hardware and GStreamer stack being fully capable**.

This is worse than the plan's working assumption (DRM fails, baseline
non-DRM playback works as a fallback). See `ARCHITECTURE.md`'s Open risks
section for the updated recommendation.

## What would change this

- A newer/older `webkit2gtk-4.1` build (this bug may be version-specific;
  worth checking Debian's bug tracker / WebKitGTK release notes for known
  regressions in 2.52.x media playback, or trying a Raspberry Pi OS release
  pinned to an older WebKitGTK).
- WPE WebKit instead of WebKitGTK — the embedded-focused port with actual
  Pi/DRM prior art (Plasma Bigscreen, RDK). Tauri doesn't support WPE as a
  Linux backend today, so this would mean forking/patching Tauri's Linux
  webview layer, a large effort.
- Confirming via an actual Tauri scaffold in case its window/webview setup
  differs meaningfully from this harness (see above — judged low
  probability of a different result, not tested).
