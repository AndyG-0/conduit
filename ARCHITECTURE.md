# Architecture

Status: **scope is now Windows and macOS only.** Both Pi and general Linux
desktop support were dropped after their DRM spikes (below) surfaced real
architectural costs — see "Linux desktop: architecture decision needed
(resolved)" under Open risks for the reasoning. Active development is a
macOS build-out on top of this project's initial prototype; see
[`TODO.md`](TODO.md) for what's still open.

The two Linux-family spikes that led to that call, kept for the record:

**Raspberry Pi DRM/hardware-decode spike** (results in
[`spikes/pi-drm/README.md`](spikes/pi-drm/README.md)) came back negative —
worse than expected. Not just DRM: WebKitGTK's `<video>` element doesn't
work at all on this specific Pi/OS combination, DRM'd or not, despite the
underlying hardware/GStreamer/V4L2 stack being fully capable. This is a
Pi-specific finding, not a general-Linux one — see "Raspberry Pi" under Open
risks below for exactly what was and wasn't tested.

**The general-Linux (x86_64) DRM spike** (results in
[`spikes/linux-vm-drm/README.md`](spikes/linux-vm-drm/README.md)) was a
softer negative: the WebKitGTK engine itself works fine on desktop Ubuntu,
but Widevine playback still fails (`UI-3001`), confirmed via a control test
to be a CDM-licensing gap, not a broken engine. CEF was investigated as a
fix and ruled out (doesn't ship Widevine either, same licensing gap). The
stack decision below (Tauri, one native embedded webview per app, not
iframes) stands for Windows/macOS.

## What Conduit is

A Windows/macOS fullscreen launcher that presents streaming services as a
TVOS-style grid of "apps." (Linux, including Raspberry Pi OS, was part of the
original premise and is where the project's name and general shape came
from, but is now out of scope — see "Linux desktop: architecture decision
needed (resolved)" under Open risks.) Each app is really a link into an
embedded, sandboxed view of that service's existing web site — Conduit does
not reimplement any service's playback, catalog, or auth. The value it adds
is a unified 10-foot UI, session isolation between services, and
remote/controller navigation, in front of sites that were built for
mouse-and-keyboard.

## Stack decision

**Tauri** (Rust core + OS-native webview), not Electron or CEF.

Rationale, in order of weight:

1. **Footprint on Raspberry Pi.** Electron/CEF bundle their own Chromium,
   which is the single biggest cost on a Pi's limited CPU/RAM — both for the
   shell itself and for video decode (see Open risks below). Tauri has no
   bundled engine; it hosts whatever webview the OS already provides.
2. **DRM comes free on Windows and macOS.** Tauri uses WebView2 (Windows) and
   WKWebView (macOS) — both get their platform's licensed Widevine/PlayReye
   /FairPlay stack for free, the same way Safari and Edge do. A bundled
   Chromium (Electron/CEF) only ships Widevine **L3** (software-only,
   resolution-capped) unless you separately obtain an L1 license from Google,
   which is not practical for an indie project.
3. **Consistency cost is real but acceptable.** Tauri's tradeoff is three
   different rendering engines (WebView2, WKWebView, WebKitGTK) instead of
   one Chromium everywhere. Given the "app" content is just embedded
   third-party sites we don't control anyway, engine differences mostly show
   up as CSS/JS quirks in *our* launcher UI, which is small and can be kept
   conservative (see Frontend below).

See the conversation history / commit log for the fuller Electron vs. Tauri
vs. CEF comparison this decision came from.

## Open risks — read before scaffolding platform-specific code

### Raspberry Pi: DRM + hardware video decode (resolved — hard negative, blocks Pi support specifically)

**Spike complete, results in [`spikes/pi-drm/README.md`](spikes/pi-drm/README.md).**
Tested on a real Pi 4 / Raspberry Pi OS (Debian 13 "Trixie") /
`webkit2gtk-4.1` 2.52.6 — the exact library Tauri links against on Linux.
Two independent, compounding negatives:

**Scope note:** this was tested on Raspberry Pi OS specifically, not
general x86_64 Linux. A mini-PC running Ubuntu/Fedora/etc. ships a
different `webkit2gtk` build and may not hit the same `<video>` element
bug — that's a separate, still-open question (see "Linux (general
x86_64): DRM proof-of-concept, not yet run" below), not something this
result settles either way. Homelab/mini-PC users running Linux are a real
share of this project's likely audience (see "Alternatives considered"
below), so that question is worth answering before writing off Linux
desktop support generally, independent of the Pi-specific call below.

- **No DRM/EME at all.** `navigator.requestMediaKeySystemAccess` is
  entirely absent, even with `webkit_settings_set_enable_encrypted_media`
  explicitly forced on. Matches prior research: WebKitGTK's only path to
  EME is the Thunder/OpenCDM stack (RDK middleware, opt-in at WebKit build
  time), not present in Debian's mainline package.
- **Non-DRM `<video>` playback is also broken on this build**, independent
  of DRM. The hardware and OS stack are fine on their own — a raw
  GStreamer pipeline (`v4l2h264dec` → zero-copy DMABuf → `waylandsink`)
  correctly hardware-decodes real 1080p30 H.264 at 3-9% CPU with no
  throttling. But WebKitGTK's `<video>` element never leaves
  `readyState == HAVE_NOTHING` for that same content, in both a
  WebKitSettings-tuned custom harness and stock Epiphany, across four
  different serving methods (HTTPS CDN, `file://`, local HTTP with and
  without Range support). This isolates the bug to WebKitGTK's
  `MediaPlayerPrivateGStreamer` glue on this specific version, not to the
  hardware, GStreamer, V4L2, or Wayland — all confirmed working
  independently.

Net effect: **right now, nothing plays in a WebKitGTK-hosted view on this
Pi/OS combination — DRM'd or not.** This is worse than the pre-spike
assumption (DRM fails, plain video works as a fallback path). Kodi's
CDM + V4L2 approach was already ruled out at the research stage as having
no real analog for a WebKitGTK app (it bridges straight to Kodi's own
native player, never through a browser DOM/EME pipeline) — moot now anyway,
since even non-DRM video doesn't reach the DOM layer either.

Fallback options, given this result:

- Ship desktop-first (Windows/macOS full support), Pi as a stretch goal —
  now the most clearly justified option, since even the "non-DRM only on
  Pi" middle path isn't currently usable.
- Chase the WebKitGTK `<video>` bug itself: try a different Debian/Raspberry
  Pi OS release with a different `webkit2gtk` version, or file/search
  upstream for a known regression in 2.52.x media playback. Unknown effort
  — could be a quick fix or a dead end.
- Switch Pi specifically to WPE WebKit (the embedded-focused port with
  actual Pi/DRM prior art — Plasma Bigscreen, RDK) instead of WebKitGTK.
  Tauri doesn't support WPE as a Linux backend today, so this means
  forking/patching Tauri's Linux webview layer — largest effort.

This is a recommendation, not a decision made unilaterally — worth a
conscious call on which of these (or dropping Pi entirely) before any
Pi-specific code gets written.

### Linux (general x86_64): DRM proof-of-concept — resolved, soft negative

**Spike complete, results in
[`spikes/linux-vm-drm/README.md`](spikes/linux-vm-drm/README.md).** Tested
on Ubuntu 24.04.4 LTS x86_64 in a Hyper-V VM. Unlike the Pi, WebKitGTK's
`<video>` element and general page rendering work fine here — a real build
of this repo's Tauri app loads and renders netflix.com correctly in the
embedded webview. The failure is narrower and exactly what was expected
going in: **no Widevine CDM**, so playback fails with Netflix's `UI-3001`
error. A control test (installing real Google Chrome, which bundles a
licensed CDM, on the same VM) played the same content back fine — isolating
the cause to WebKitGTK's CDM licensing gap specifically, not the VM,
Hyper-V, missing GPU passthrough, or Linux video capability generally.

CEF was investigated as a fix and **ruled out**: Rust CEF bindings are
thin/unmaintained (large ongoing engineering cost), and more importantly
open-source CEF builds don't ship Widevine either, for the same licensing
reason — that's why companies like castLabs sell Widevine-enabled CEF/
Electron builds commercially rather than it being a build flag. CEF would
cost real engineering effort and still not solve DRM.

A path that **is** confirmed viable: instead of an embedded WebKitGTK
webview, have the Linux build spawn the system's real, already-licensed
Chrome/Chromium as a subprocess in `--app=`/`--kiosk` mode (chromeless,
looks embedded) and drive it via the Chrome DevTools Protocol instead of
Tauri's webview APIs. No CDM licensing cost, but it requires Chrome/
Chromium pre-installed on the target machine (can't bundle it the way an
embedded webview is bundled), and session partitioning / navigation
confinement / back-to-menu capture would all need reimplementing against
CDP rather than Tauri's webview APIs — a genuinely different architecture
from the Windows/macOS native-embedded-webview approach.

#### Linux desktop: architecture decision needed (resolved)

**Decided: option 2, Windows/macOS native only.** Linux desktop and Pi are
both dropped from scope. The current Tauri/embedded-webview architecture
stands as designed for Windows/macOS, which is also where active development
continues (see `TODO.md`). The options below are kept as the record of what
was considered and why option 2 won out — mainly that it avoids an
architecture split (option 3) or abandoning the embedded/session-isolated
value proposition (option 1), at the acknowledged cost of the homelab/mini-PC
Linux audience "Alternatives considered" below flags as a real part of this
project's original premise. If Linux support is ever revisited, this section
and the two spike reports it's based on are the starting point.

That last point is the real fork in the road, not just a Linux
implementation detail. Three options were on the table:

1. **Pivot everything to a client-server/PWA model** (see "Alternatives
   considered" below) — one architecture for all platforms, DRM fully
   offloaded to whatever browser the user already has working. Loses the
   embedded/session-isolated single-shell value proposition per streaming
   service unless paired with something for guaranteed back-to-menu
   navigation — either the browser-extension pattern already recorded
   below, or window-level keyboard/remote/controller shortcut capture (this
   project's existing plan for the primary approach) aimed at the browser
   window instead of an embedded webview. Exact mechanism not yet decided
   either way.
2. **Windows/macOS native only** — keep the current Tauri/embedded-webview
   architecture exactly as designed, drop Linux desktop support (Pi is
   already a stretch goal per the section above). Simplest, no architecture
   split, but abandons the homelab/mini-PC Linux audience "Alternatives
   considered" below flags as a real part of this project's premise.
3. **Both, as two separate projects, not one codebase with platform
   branches** — native Tauri app for Windows/macOS (this repo, as
   currently designed), and a separate PWA/spawned-browser project for
   Linux (which, being a served web app, isn't actually Linux-specific —
   "really any OS" per the option-1 shape). The architectural gap between
   "one embedded native webview Conduit fully owns" and "served web app /
   externally-driven browser" is now wide enough that combining them in a
   single codebase doesn't look justified — they'd share little beyond the
   general product idea.

This was a recommendation-gathering writeup; the decision itself is recorded
at the top of this section.

### Windows/macOS: expected to work, not yet verified

Lower risk given native DRM support, but Netflix-tier 1080p/4K playback
inside a WebView2/WKWebView-hosted native embedded webview has its own
quirks (EME permission prompts, fullscreen-video handoff). The macOS half
of this is what this project's initial prototype already confirmed
(Netflix DRM playback via Tauri/WKWebView, see the stack decision above).
On Windows, Netflix plays and WebView2 exposes both Widevine and PlayReady.
One real quirk has come up: WebView2 identifies as Edge, and some players
choose their DRM by browser brand. ESPN's Disney player sends Edge to
PlayReady and then fails (Error Code 28, in real Edge too), so the ESPN
tile gets a Chrome UA and Client Hints on Windows (see `DESKTOP_CHROME_USER_AGENT` in
`src-tauri/src/webview.rs`). Expect other Edge-specific player failures to
have the same fix. The remaining Windows checks are tracked in `TODO.md`.

## Alternatives considered

The primary path (Tauri, one native embedded webview per app, no iframes)
is what this project's macOS build-out has already confirmed and still
stands for Windows/macOS. For Linux specifically, the general-x86_64 DRM spike above
has already turned "revisit if the primary path hits a wall" into a live,
three-way decision (see "Linux desktop: architecture decision needed"
above) — the alternatives below are no longer purely hypothetical for that
platform:

- **Client-server / PWA**, offloading DRM entirely onto the user's own
  browser. Conduit would become a served web app (or a thin native shell
  around one) that's really a curated link/bookmark grid — clicking a tile
  opens the real streaming site in the user's default browser or a new
  tab, rather than an embedded, session-isolated view Conduit controls.
  Pro: sidesteps every DRM/webview-engine question in this doc entirely,
  since playback happens in whatever browser the user already has DRM
  working in. Con: loses the actual value proposition — input handling,
  session isolation between services, and guaranteed back-to-menu
  navigation from inside a service — that's the reason this project
  exists instead of a bookmarks folder. Risks becoming "just a glorified
  link page."
- **Native launcher + browser extension**, the pattern HTLauncher uses: a
  native app shells out to the OS's real browser (Edge/Chrome) in a
  chromeless/app-mode window per service, paired with a bundled browser
  extension that intercepts a "back" key and injects per-site navigation
  logic (e.g. knowing Netflix's DOM/URL structure well enough to step
  through it and detect when to return to the launcher). Pro: gets a real,
  full browser's native DRM stack for free, no embedded-webview engine
  quirks. Con: the extension is inherently per-site and fragile — hand-
  written and maintained against each streaming service's DOM/URL
  structure individually, breaks silently on site redesigns, and doesn't
  scale past a handful of services the way generic window-level input
  capture does (see "Input & navigation" below, which gets the same
  back-navigation result without depending on any site's cooperation).
- **Hybrid**: keep the primary approach's window-level input capture, but
  fall back to launching the OS browser (with the extension) specifically
  for services whose DRM doesn't work in the embedded webview on a given
  platform. Not needed unless the primary approach works for some
  platforms/services and not others — a real possibility given the Pi
  result — in which case this becomes a per-platform or per-service escape
  hatch rather than the whole architecture.

None of these are ruled out permanently. The primary approach is being
prototyped first because it's the only one that delivers the full "single
controlled shell, guaranteed way back" value proposition without
depending on cooperation from each target site individually — but it also
carries the most open technical risk (Open risks above), so these are the
fallback set if that risk doesn't resolve cleanly on a given platform.

## Component breakdown

```
src-tauri/     Rust core: window/lifecycle management, app registry, webview
               orchestration, OS-level kiosk/autostart integration
src/           Launcher UI (grid of apps, settings) — the only UI that's
               "ours"; everything else is an embedded third-party site
spikes/        Throwaway feasibility code (DRM/hardware-decode spike, etc.)
               — not part of the shipped app, gitignored build output
```

### Rust core (`src-tauri/`)

- Owns the app registry: a config file (id, display name, icon, base
  URL(s)/allowed-domain list, session partition name) — this is the
  "channel lineup." Editable through the Settings UI once that exists.
- Creates one Tauri webview per launched app, each with its **own storage
  partition** (cookies/localStorage) so signing into Netflix doesn't bleed
  into Hulu's session.
- Enforces **navigation confinement** per webview: intercepts navigation
  events and only allows the app's allowed-domain list (plus common
  auth/SSO redirect hosts) — blocks stray redirects (ads, phishing) from
  escaping the sandboxed view.
- Manages window lifecycle: both a normal windowed mode and a fullscreen
  mode (a Steam Big Picture-style toggle) are first-class from the start,
  not a fullscreen-kiosk-only design with windowed as a debug fallback —
  windowed mode matters most early (fastest to develop/test against),
  fullscreen is the actual target 10-foot experience.

### Launcher UI (`src/`)

The TVOS-style tile grid, focus/navigation state, and the settings screen.
Everything else on screen is a third-party site we don't control, so this
surface should stay small and use conservative, broadly-supported web
features rather than engine-specific APIs, given it has to render correctly
across both WebView2 and WKWebView.

### Input & navigation

The launcher grid needs full keyboard, mouse, and game-controller/remote
(D-pad-style) spatial navigation — a real 10-foot UI, not a mouse-only page
that happens to be fullscreen. Inside an embedded app, default to passing
raw input through as-is, since we don't control that site's UI; D-pad-only
navigation of an arbitrary streaming site's own web player is a stretch
goal, not a launch requirement.

### Kiosk / autostart (per-OS)

- **macOS:** LaunchAgent (`tauri-plugin-autostart`).
- **Windows:** Startup folder or Task Scheduler entry (not yet built —
  Windows work is deferred until after the macOS build-out per `TODO.md`).

### Updates & packaging

Tauri's built-in updater, signed releases published via GitHub Releases,
built for a platform matrix (Windows x64, macOS universal) in CI.
