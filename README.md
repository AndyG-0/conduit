# Conduit

A Windows/macOS fullscreen launcher for streaming services. Think Apple TV's
home screen: a grid of "apps," each one really a sandboxed, isolated view
into that service's own web site, navigable with keyboard, mouse, or a game
controller/remote from across the room.

Conduit doesn't reimplement any streaming service — no scraping, no
credential handling beyond what each site's own login page does inside its
own sandboxed session. It's a shell that makes a pile of unrelated
streaming sites feel like one coherent TV interface.

**Status: active development, macOS-first.** The macOS prototype (single
embedded, DRM'd webview + fullscreen toggle + back-to-grid shortcut) is
done; a full registry-driven app grid, settings UI, keyboard/gamepad
navigation, and autostart are being built out next. Windows support follows
once that's solid — see [`TODO.md`](TODO.md) for the build order.
Linux/Raspberry Pi were part of the original premise but are now out of
scope; see [`ARCHITECTURE.md`](ARCHITECTURE.md) for why.

## Stack

- **Tauri** (Rust core + OS-native webview — WebView2 on Windows, WKWebView
  on macOS) rather than Electron, because Windows/macOS get their platform's
  licensed DRM stack for free. Full rationale is in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Repository layout (target shape — not all present yet)

```
src-tauri/   Rust core: window/lifecycle, app registry, webview
             orchestration, OS kiosk/autostart integration
src/         Launcher UI — the TVOS-style app grid and settings screen
spikes/      Throwaway feasibility code (e.g. the Pi DRM spike), not part
             of the shipped app
ARCHITECTURE.md   Stack decision, component breakdown, open risks
TODO.md           Chronological build order
```

## License

MIT — see [`LICENSE`](LICENSE).
