use std::collections::{BTreeSet, HashMap};
use std::sync::Mutex;

use tauri::{
    command, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, Webview,
    WebviewBuilder, WebviewUrl, Window, WindowBuilder, WindowEvent,
};
use url::Url;

use crate::app_config::{AppTile, RegistryState};
use crate::shortcuts;

/// The label of the tile currently shown in the main window, if any. A child
/// `Webview` has no OS-reported visibility of its own the way a top-level
/// `Window` does, so this is tracked explicitly rather than queried.
pub type ActiveTileState = Mutex<Option<String>>;

/// Hosts blocked by `domain_allowed` since launch, per tile, surfaced to the
/// user instead of only a terminal log line. No amount of hardcoded
/// allowlist entries can anticipate every streaming/device service's login
/// or anti-fraud domains — this is the general-purpose escape hatch: when a
/// new site's auth flow gets silently blocked, the user sees exactly which
/// host it was and can allow it from Settings, without needing a code change
/// or an app update. Not persisted — it's a per-session diagnostic aid, not
/// a permanent record, and clears naturally on relaunch.
pub type BlockedDomainsState = Mutex<HashMap<String, BTreeSet<String>>>;

fn record_blocked(app: &AppHandle, tile_id: &str, host: &str) {
    app.state::<BlockedDomainsState>()
        .lock()
        .unwrap()
        .entry(tile_id.to_string())
        .or_default()
        .insert(host.to_string());
}

/// Hosts a tile's webview has tried to navigate to and been blocked from,
/// since launch — for the Settings UI's "recently blocked" list.
#[command]
pub fn list_blocked_domains(app: AppHandle, tile_id: String) -> Vec<String> {
    app.state::<BlockedDomainsState>()
        .lock()
        .unwrap()
        .get(&tile_id)
        .map(|domains| domains.iter().cloned().collect())
        .unwrap_or_default()
}

/// Clears one recorded blocked domain for a tile — called after the user
/// either allows it (it's now in `allowed_domains`, so it'll never be
/// recorded as blocked again) or dismisses it.
#[command]
pub fn dismiss_blocked_domain(app: AppHandle, tile_id: String, domain: String) {
    if let Some(domains) = app
        .state::<BlockedDomainsState>()
        .lock()
        .unwrap()
        .get_mut(&tile_id)
    {
        domains.remove(&domain);
    }
}

/// Identity/SSO hosts allowed across every tile, in addition to each tile's
/// own `allowed_domains`. Login flows for several services (Hulu/Disney+/
/// ESPN's shared Disney identity, YouTube TV's Google login, Tubi's
/// Facebook/Apple sign-in) redirect through one of these. Cable-provider
/// "TV Everywhere" logins redirect through too many variable third-party
/// domains to hardcode here — a user hitting one of those can add the
/// specific domain to that tile's allowed list through Settings.
pub const COMMON_SSO_DOMAINS: &[&str] = &[
    "accounts.google.com",
    "appleid.apple.com",
    "login.live.com",
    "facebook.com",
];

/// Third-party CAPTCHA/bot-challenge widget hosts, allowed across every tile
/// alongside `COMMON_SSO_DOMAINS`. Confirmed necessary via live navigation
/// logging plus a 403 on the resulting authenticate request: Hulu's login
/// embeds an invisible Google reCAPTCHA Enterprise challenge
/// (`www.google.com/recaptcha/enterprise/anchor?...`) in an iframe
/// navigation that `on_navigation` was silently blocking (`google.com` was
/// in neither Hulu's `allowed_domains` nor `COMMON_SSO_DOMAINS`). With the
/// challenge iframe never loading, the login request never gets a valid
/// captcha token and the site rejects it — indistinguishable, from the
/// user's side, from a genuinely wrong password. `www.google.com` is listed
/// (not the bare `google.com` suffix already used for SSO) to avoid opening
/// every Google property to every tile; `gstatic.com` and `recaptcha.net`
/// are reCAPTCHA's asset/challenge-frame host and regional fallback
/// respectively, and are safe to allow by suffix since neither hosts
/// anything sensitive beyond the widget itself.
pub const COMMON_CAPTCHA_DOMAINS: &[&str] = &["www.google.com", "gstatic.com", "recaptcha.net"];

/// A realistic desktop Safari UA string, applied as an override on macOS to
/// every tile webview. WKWebView's bare default UA is missing the trailing
/// `Version/X Safari/Y` tokens real Safari appends — a known fingerprint
/// that bot/fraud-detection systems (Hulu's, Amazon's) can key on to reject
/// logins using genuinely correct credentials. Hardcoded rather than
/// derived at runtime: Conduit doesn't need a UA-version auto-updater for
/// this, and a string a point-release or two behind current is
/// indistinguishable to any check for "is this a real modern desktop
/// Safari" rather than an exact version match. Bump by hand if this ever
/// stops working.
///
/// macOS-only: Windows' WebView2 already sends its own accurate
/// Chromium-based UA (which these sites already accept in real
/// Chrome/Edge) — overriding it to claim macOS Safari on a Windows engine
/// would be a platform/UA mismatch, plausibly a worse fingerprint than the
/// current default.
#[cfg(target_os = "macos")]
const DESKTOP_SAFARI_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
    AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

/// A desktop Chrome-on-Windows UA string, applied on Windows only to tiles
/// whose site is in `CHROME_USER_AGENT_DOMAINS`. WebView2's default UA ends
/// in `Edg/<version>`, and some players pick their DRM system from the
/// browser *brand* rather than by probing EME. ESPN's Disney player
/// (`client-sdk-configs.bamgrid.com/.../chromium/edge/prod.json`) routes Edge
/// to PlayReady. The license exchange succeeds, but playback then fails with
/// "Error Code 28" in both WebView2 and real Edge. The same stream plays in
/// Chrome, where the player picks Widevine. Hiding PlayReady from
/// `requestMediaKeySystemAccess` didn't change the player's choice, while
/// switching the UA to Chrome in Edge's DevTools made it play immediately.
/// That confirms the brand, not EME support, drives the choice. WebView2
/// ships a working Widevine CDM, so claiming Chrome is truthful about the
/// engine.
///
/// Scoped per-site rather than applied to every Windows tile: Netflix and
/// others already play correctly under the default Edge UA (Netflix via
/// PlayReady, which gets it higher resolutions than Widevine L3 would).
/// Same "a version or two behind is fine" reasoning as
/// `DESKTOP_SAFARI_USER_AGENT`; bump by hand if a site starts rejecting it.
const DESKTOP_CHROME_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/// Sites (matched against a tile's `base_url` host, suffix-matched like
/// `domain_allowed`) that get `DESKTOP_CHROME_USER_AGENT` on Windows. Keyed on
/// host rather than tile id so a user-added ESPN tile gets the fix too.
#[cfg_attr(not(windows), allow(dead_code))]
const CHROME_USER_AGENT_DOMAINS: &[&str] = &["espn.com"];

#[cfg_attr(not(windows), allow(dead_code))]
fn wants_chrome_user_agent(base_url: &Url) -> bool {
    let Some(host) = base_url.host_str() else {
        return false;
    };
    CHROME_USER_AGENT_DOMAINS
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// Rewrites `navigator.userAgentData` (UA Client Hints) to match
/// `DESKTOP_CHROME_USER_AGENT`. The UA string override alone was not enough
/// for ESPN: WebView2 still reported `Microsoft Edge` / `Microsoft Edge
/// WebView2` brands, and the player still loaded its Edge config. DevTools'
/// "Chrome - Windows" preset, which did fix it, overrides both the UA string
/// and these brands. The script keeps the engine's real version numbers and
/// platform, swaps the Edge brand for `Google Chrome`, and drops the WebView2
/// brand, so the result looks like the Chrome build the engine matches.
/// Only the JS API is covered; the `Sec-CH-UA` request headers still say
/// Edge, and WebView2 has no API to change them.
const CHROME_CLIENT_HINTS_SCRIPT: &str = r#"(() => {
  const real = navigator.userAgentData;
  if (!real) return;
  const rebrand = (list) =>
    (list || [])
      .filter((b) => !/WebView2/i.test(b.brand))
      .map((b) => (/Microsoft Edge/i.test(b.brand) ? { ...b, brand: 'Google Chrome' } : b));
  const brands = rebrand(real.brands);
  const fake = Object.create(Object.getPrototypeOf(real));
  Object.defineProperties(fake, {
    brands: { value: brands, enumerable: true },
    mobile: { value: real.mobile, enumerable: true },
    platform: { value: real.platform, enumerable: true },
    getHighEntropyValues: {
      value: (hints) =>
        real.getHighEntropyValues(hints).then((v) => {
          const out = { ...v, brands };
          if (v.fullVersionList) out.fullVersionList = rebrand(v.fullVersionList);
          return out;
        }),
    },
    toJSON: { value: () => ({ brands, mobile: real.mobile, platform: real.platform }) },
  });
  Object.defineProperty(Navigator.prototype, 'userAgentData', {
    get: () => fake,
    configurable: true,
  });
  if (window === window.top) {
    console.info('[conduit:ua] userAgentData brands ->', JSON.stringify(brands));
  }
})();"#;

/// Hides WebView2's `window.chrome.webview` from tile pages. Prime Video's
/// web client (`DVWebClient_app`) checks whether `chrome.webview` exists
/// during startup, most likely to detect Amazon's own WebView2-based Windows
/// app. If it does, the client reads `chrome.webview.hostObjects.sync.<...>`
/// inside the player's constructor. Conduit registers no host objects, so
/// that read throws (`Element not found. (0x80070490)`, or a TypeError if
/// only `hostObjects` is hidden). Player setup dies, and the Play button
/// never enables. Real Edge and macOS have no `chrome.webview`, which is why
/// Prime plays there.
///
/// Conduit's own tile scripts still need it. On `https://` pages Tauri's IPC
/// falls back from its custom protocol to wry's
/// `window.ipc.postMessage = s => window.chrome.webview.postMessage(s)`,
/// which reads `chrome.webview` at call time and is always called from
/// Tauri's `sendIpcMessage` (tauri `scripts/ipc-protocol.js`). So the
/// property becomes a getter that returns the real object only when that
/// function is on the call stack, and `undefined` for page code.
///
/// This is a compatibility shim, not a security boundary: a page can get the
/// real object back by naming its own function `sendIpcMessage`. What a page
/// can reach over IPC is decided by the capabilities
/// (`capabilities/tile-remote.json`), not by hiding this.
#[cfg(windows)]
const HIDE_CHROME_WEBVIEW_SCRIPT: &str = r#"(() => {
  const chrome = window.chrome;
  const real = chrome && chrome.webview;
  if (!real) return;
  try {
    Object.defineProperty(chrome, 'webview', {
      configurable: true,
      enumerable: false,
      get() {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 20;
        const stack = new Error().stack || '';
        Error.stackTraceLimit = limit;
        return /\bsendIpcMessage\b/.test(stack) ? real : undefined;
      },
    });
  } catch (e) {
    console.warn('[conduit:webview] could not hide chrome.webview', e);
  }
  if (window === window.top) {
    console.info('[conduit:webview] chrome.webview hidden:', window.chrome.webview === undefined);
  }
})();"#;

/// Site-compatibility init scripts for every webview belonging to a tile
/// (the tile itself, its PiP copy, and its sign-in popups), given that
/// tile's `tile_user_agent`: `HIDE_CHROME_WEBVIEW_SCRIPT` on Windows, plus
/// `CHROME_CLIENT_HINTS_SCRIPT` when the tile claims to be Chrome so the
/// Client Hints agree with the UA string.
fn tile_compat_scripts(user_agent: Option<&str>) -> Vec<&'static str> {
    let mut scripts = Vec::new();
    #[cfg(windows)]
    scripts.push(HIDE_CHROME_WEBVIEW_SCRIPT);
    if user_agent == Some(DESKTOP_CHROME_USER_AGENT) {
        scripts.push(CHROME_CLIENT_HINTS_SCRIPT);
    }
    scripts
}

/// The UA override (if any) for every webview belonging to the tile at
/// `base_url`: the tile itself, its PiP copy, and its sign-in popups.
fn tile_user_agent(base_url: &Url) -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        let _ = base_url;
        Some(DESKTOP_SAFARI_USER_AGENT)
    }
    #[cfg(windows)]
    {
        wants_chrome_user_agent(base_url).then_some(DESKTOP_CHROME_USER_AGENT)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = base_url;
        None
    }
}

/// `allowed_domains` plus the tile's own `base_url` host — the set actually
/// checked at navigation time. Callers never need to (and the settings UI no
/// longer asks users to) list a tile's own domain explicitly: a tile can
/// always navigate within its own site, and `allowed_domains` becomes purely
/// additive, for the rarer case of a tile whose login/playback flow crosses
/// onto a *different* domain the built-in `COMMON_SSO_DOMAINS` list doesn't
/// already cover.
fn effective_allowed_domains(tile: &AppTile, base_url: &Url) -> Vec<String> {
    let mut domains = tile.allowed_domains.clone();
    if let Some(host) = base_url.host_str() {
        domains.push(host.to_string());
    }
    domains
}

/// True if `url`'s host is one of `allowed` (or `COMMON_SSO_DOMAINS`/
/// `COMMON_CAPTCHA_DOMAINS`), or a subdomain of one of them. Suffix-matched,
/// not substring-matched, so `netflix.com.evil.tld` is correctly rejected.
///
/// `about:` URLs (e.g. `about:blank`, `about:srcdoc`) are always allowed:
/// `Url::host_str()` returns `None` for them, so without this carve-out
/// they'd be indistinguishable from a real blocked host below. They carry no
/// host and can't fetch anything on their own, so blocking them has no
/// security value — but login/anti-fraud flows commonly navigate a hidden
/// iframe to `about:blank` first for isolation, and blocking that silently
/// breaks the flow the same way the missing reCAPTCHA host once did for Hulu.
pub fn domain_allowed(url: &Url, allowed: &[String]) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let matches = |domain: &str| host == domain || host.ends_with(&format!(".{domain}"));
    allowed.iter().any(|d| matches(d))
        || COMMON_SSO_DOMAINS.iter().any(|d| matches(d))
        || COMMON_CAPTCHA_DOMAINS.iter().any(|d| matches(d))
}

/// A fresh, process-unique suffix for popup window labels — `tile.id` itself
/// is already taken by the tile's own window/webview, and a second popup
/// triggered before an earlier one closes would otherwise collide on a fixed
/// label.
fn next_popup_label(tile_id: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{tile_id}-popup-{}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// An init script for a tile's own (opener) webview that closes that tile's
/// popup window(s) once one of them `postMessage`s the opener — which is how
/// OAuth relay pages (e.g. Google Identity Services' `gis_transform` popup
/// flow) report completion back to the page that opened them.
///
/// This works around a real gap in the installed `wry` (0.55.1): its
/// `WKUIDelegate` never implements `webViewDidClose:`, so neither a same-
/// origin `self.close()` nor a cross-origin `popup.close()` call made by the
/// popup's own JS ever reaches Tauri/wry — the native popup window is simply
/// never told to close, leaving a blank leftover window behind once the
/// relay page has done its job. Listening for the `postMessage` the relay
/// page already sends (that's the whole point of `window.opener`/
/// `window_features` being wired up) and closing the popup from the opener
/// side via `close_tile_popups` sidesteps that gap entirely, rather than
/// depending on WebKit's (missing) close-delegate plumbing.
///
/// Matches on `event.source` (identity of the window that posted the
/// message) rather than `event.origin` (its hostname): wrapping `window.open`
/// to remember every window it hands back, then checking incoming messages
/// against that set, correctly catches a completion message from *any* popup
/// this page opened regardless of which exact host Google (or another SSO
/// provider) happens to serve the relay page from — no need to hardcode or
/// guess that host up front the way an origin allowlist would.
///
/// The tile page is a remote origin, so this `invoke` only works because
/// `capabilities/tile-remote.json` grants it `close_tile_popups`, which takes
/// no arguments: the tile is whichever webview called it.
fn popup_close_listener_script() -> &'static str {
    r#"(() => {
  const openedWindows = new Set();
  const nativeOpen = window.open;
  window.open = function (...args) {
    const win = nativeOpen.apply(window, args);
    if (win) openedWindows.add(win);
    return win;
  };
  window.addEventListener('message', (event) => {
    if (openedWindows.has(event.source)) {
      window.__TAURI__.core.invoke('close_tile_popups').catch(() => {});
    }
  });
})();"#
}

/// Relays user activity from inside a tile's own webview back to Rust, so
/// the screensaver's idle timer (`screensaver.ts`) — which only listens on
/// the launcher page's own `window` — doesn't misread someone actively
/// watching a tile in fullscreen as idle. A tile is a genuinely separate
/// native child `Webview` (see `launch_tile`), not part of the launcher's
/// DOM, so its own input events never reach the launcher page any other
/// way. Throttled client-side to one `invoke` per `THROTTLE_MS`, since
/// `mousemove` alone would otherwise flood IPC; the idle timer only needs a
/// "still active" ping well inside its multi-minute timeout, not a live
/// per-event feed. Mirrors exactly the event set `screensaver.ts`'s own
/// `onActivity` listens for on the launcher side.
fn tile_activity_listener_script() -> String {
    r#"(() => {
  const THROTTLE_MS = 5000;
  let last = 0;
  const report = () => {
    const now = Date.now();
    if (now - last < THROTTLE_MS) return;
    last = now;
    window.__TAURI__.core.invoke('report_tile_activity').catch(() => {});
  };
  window.addEventListener('mousemove', report);
  window.addEventListener('mousedown', report);
  window.addEventListener('keydown', report);
})();"#
        .to_string()
}

/// Whether `url` is Google Identity Services' popup-relay completion page
/// (`https://accounts.google.com/gsi/transform`).
///
/// Confirmed from a captured HAR of a live "Continue with Google" flow: after
/// the user picks an account, the popup does a `POST` (`form_post` response
/// mode) landing on this exact path — Google's own documented internal
/// redirect target for this specific popup flow, not something guessed or
/// reverse-engineered from unrelated behavior. The relay bundle it loads
/// there (`transform_layer_library`) hands the credential to the opener via
/// `window.opener.postMessage(JSON.stringify({params: {type: "authResult",
/// ...}}), targetOrigin)` and then calls `window.close()` on itself once that
/// succeeds — confirmed live via [`popup_opener_shim_script`]; an earlier
/// guess that it called `window.opener.gis.provider.relayCredentialResponse`
/// directly was wrong (kept as a defensive fallback in
/// [`handle_captured_credential`] in case some other flow does use it, but
/// it's never actually been observed). A JS-side `invoke()` from this page
/// can't be relied on to reach Rust either way: it fails with a WebKit "Fetch
/// API cannot load ipc://... access control checks" error (also observed
/// worded as "Not allowed to request resource" / "insecure content"), because
/// it executes in the JS realm of this page's real origin
/// (`accounts.google.com`), which Tauri's IPC transport does not trust the
/// way it trusts the tile's own webview. Detecting this navigation natively,
/// from the Rust side, sidesteps that entirely.
#[cfg(target_os = "macos")]
fn is_gsi_transform_relay(url: &Url) -> bool {
    url.host_str() == Some("accounts.google.com") && url.path() == "/gsi/transform"
}

/// Appends a line to the `conduit-debug.log` debug file, the same fixed file `lib.rs`'s
/// `debug_log` command writes to — duplicated here rather than reusing that
/// command directly because this is called from native Rust code, not via an
/// `invoke()` from JS. No-ops in release builds: this exists for diagnosing
/// the popup credential hand-off below, not as a production logging
/// mechanism, so it stays silent (and writes nothing to disk) once shipped.
#[cfg(target_os = "macos")]
fn append_debug_log(msg: &str) {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(crate::debug_log_path())
        {
            let _ = writeln!(f, "[rust-debug] {msg}");
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = msg;
    }
}

/// Replaces any string leaf longer than 20 chars in a `serde_json::Value`
/// tree with a truncated `first6...last6 (len=N)` placeholder, in place.
/// Used before logging a captured Google credential so its *shape* (field
/// names, nesting, roughly how long each token is) is visible for debugging
/// without writing a usable bearer credential to a local file.
#[cfg(target_os = "macos")]
fn truncate_json_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) if s.len() > 20 => {
            let start: String = s.chars().take(6).collect();
            let end: String = s
                .chars()
                .rev()
                .take(6)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            *s = format!("{start}...{end} (len={})", s.len());
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(truncate_json_strings),
        serde_json::Value::Object(map) => map.values_mut().for_each(truncate_json_strings),
        _ => {}
    }
}

/// An init script injected into every popup webview that fakes `window.opener`
/// well enough for Google Identity Services' popup relay
/// (`accounts.google.com/gsi/transform`, see [`is_gsi_transform_relay`]) to
/// hand off a completed sign-in, even though the real `window.opener` this
/// popup gets from wry (0.55.1) is `null` — confirmed via a live diagnostic
/// capture, despite the popup being built with `.window_features(features)`
/// sharing the opener's real `WKWebViewConfiguration`. Root-causing that
/// wiring gap looked like it'd mean digging into wry's WKUIDelegate/objc2
/// internals with no guaranteed fix, so this works around it instead.
///
/// Scoped to `accounts.google.com` (checked at the top, a no-op everywhere
/// else) so it can't change behavior for other SSO popups (Facebook, Apple,
/// Microsoft, etc.) that might have their own, different expectations of a
/// real `window.opener`.
///
/// Confirmed live (via [`popup_diagnostic_logging_script`]) that Google's
/// relay bundle calls `window.opener.postMessage(JSON.stringify({params:
/// {type: "authResult", ...}}), targetOrigin)`, then `window.close()` once
/// that succeeds — not `window.opener.gis.provider.relayCredentialResponse`
/// as originally guessed, though that hook is kept here too as a harmless,
/// unconfirmed fallback in case some other relay path does use it. Per the
/// `HTML` spec's `[Replaceable]` semantics for `window.opener`, assigning to
/// it creates a shadowing own property rather than mutating internal browser
/// state, so faking it doesn't need any private API.
///
/// The captured `postMessage` call (and any `relayCredentialResponse` call)
/// is stashed on `window.__conduit`, a plain same-realm JS object, rather
/// than `invoke()`d straight to Rust — `invoke()` from inside this popup
/// can't reach Rust at all: the popup is built with `WebviewUrl::External`,
/// so it's showing `accounts.google.com` content from its very first
/// navigation, and WebKit blocks `fetch`-based `ipc://` calls from a page
/// whose origin differs from the app's own trusted origin (see
/// [`is_gsi_transform_relay`]'s doc comment). Rust instead reads
/// `window.__conduit` back natively via `Webview::eval_with_callback`
/// (`evaluateJavaScript:completionHandler:` under the hood on macOS), which
/// isn't subject to that restriction since it never goes through `ipc://` at
/// all — see [`handle_captured_credential`] for the Rust-side relay onto the
/// opener tile's own page. Re-injected fresh at the start of every
/// navigation inside the popup (that's what an initialization script does),
/// so whichever page inside `accounts.google.com` actually performs the
/// handoff gets the fake opener too.
///
/// macOS only. On Windows, wry hands WebView2 the popup via `SetNewWindow`,
/// so `window.opener` is real and the relay's `postMessage` reaches the tile
/// directly. There the fake would shadow the real opener and swallow the
/// message, and wry's `WindowCloseRequested` handler destroys the popup as
/// soon as Google calls `window.close()`, before the capture ever runs.
#[cfg(target_os = "macos")]
fn popup_opener_shim_script() -> &'static str {
    r#"(() => {
  if (window.location.hostname !== 'accounts.google.com') return;
  window.__conduit = { credential: null, postMessagePayload: null };
  const fakeOpener = {
    gis: {
      provider: {
        relayCredentialResponse(credential) {
          try { window.__conduit.credential = credential; } catch (e) {}
        },
      },
    },
    postMessage(data, targetOrigin) {
      try { window.__conduit.postMessagePayload = { data, targetOrigin: String(targetOrigin) }; } catch (e) {}
    },
  };
  try {
    window.opener = fakeOpener;
  } catch (e) {
    try {
      Object.defineProperty(window, 'opener', { configurable: true, get: () => fakeOpener });
    } catch (e2) {}
  }
})();"#
}

/// TEMPORARY (debug builds only): a second init script layered on top of
/// [`popup_opener_shim_script`] (via a second `initialization_script` call —
/// WebKit runs same-injection-time user scripts in the order they were
/// added) that captures console output, uncaught errors, and unhandled
/// promise rejections into `window.__conduit.logs` for
/// [`handle_captured_credential`] to dump to the `conduit-debug.log` debug file, and
/// confirms the opener shim actually stuck. Purely diagnostic — the actual
/// fix works without this. Remove once the popup hand-off has been reliable
/// for a while and this stops earning its keep.
#[cfg(all(target_os = "macos", debug_assertions))]
fn popup_diagnostic_logging_script() -> &'static str {
    r#"(() => {
  window.__conduit = window.__conduit || {};
  window.__conduit.logs = [];
  window.__conduit.closeCalled = false;
  const record = (line) => {
    try { window.__conduit.logs.push(line); } catch (e) {}
  };
  const fmt = (args) => args.map((a) => {
    try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  ['log', 'warn', 'error'].forEach((level) => {
    const native = console[level];
    console[level] = function (...args) {
      record('[' + level + '] ' + fmt(args));
      native.apply(console, args);
    };
  });
  const describeErrorLike = (val) => {
    if (val instanceof Error) {
      return (val.name || 'Error') + ': ' + val.message + (val.stack ? '\n' + val.stack : '');
    }
    if (typeof val === 'string') return val;
    try {
      const json = JSON.stringify(val);
      if (json && json !== '{}') return json;
    } catch (e) {}
    try { return String(val); } catch (e) { return '(unstringifiable)'; }
  };
  window.addEventListener('error', (event) => {
    const detail = event.error ? describeErrorLike(event.error) : event.message;
    record('[uncaught-error] ' + detail + ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno);
  });
  window.addEventListener('unhandledrejection', (event) => {
    record('[unhandled-rejection] ' + describeErrorLike(event.reason));
  });
  record('[conduit] diagnostic script loaded at ' + document.location.href);
  console.log('[conduit] window.opener shim stuck: ' + !!(window.opener && typeof window.opener.postMessage === 'function'));
  try {
    const nativeClose = window.close.bind(window);
    window.close = function (...args) {
      window.__conduit.closeCalled = true;
      console.log('[conduit] window.close() called by page script');
      return nativeClose(...args);
    };
  } catch (e) {
    record('[conduit] failed to wrap window.close: ' + String(e));
  }
})();"#
}

/// Parses the JSON string `eval_with_callback` handed back for
/// `window.__conduit` (see [`popup_opener_shim_script`]) and, if the fake
/// opener caught a hand-off, relays it onto the *opener* tile's own webview
/// so Tubi's page actually completes sign-in.
///
/// Two hand-off shapes are relayed, confirmed live:
/// - `postMessagePayload` (the common case): Google's relay bundle called
///   `window.opener.postMessage(data, targetOrigin)`. Re-dispatched on the
///   opener tile as a synthetic `MessageEvent` with `origin` set to
///   `https://accounts.google.com` — what a real cross-window postMessage
///   from the popup would have reported — so whatever `message` listener
///   Tubi's own GSI client library registered on its page (already loaded
///   there for its separate, working inline One Tap/FedCM prompt) sees
///   exactly what it expects, without needing a real `window.opener`.
/// - `credential` (unconfirmed fallback, never actually observed): calls
///   `window.gis.provider.relayCredentialResponse` on the opener's page, in
///   case some other relay path uses that hook instead of `postMessage`.
///
/// In debug builds, also logs the captured console output and a truncated
/// view of any payload to the `conduit-debug.log` debug file (via [`append_debug_log`],
/// a no-op in release).
#[cfg(target_os = "macos")]
fn handle_captured_credential(app: &AppHandle, tile_id: &str, eval_result: &str) {
    let inner_json: serde_json::Value = match serde_json::from_str(eval_result) {
        Ok(v) => v,
        Err(e) => {
            append_debug_log(&format!(
                "[popup:{tile_id}] credential capture: failed to parse eval_with_callback result: {e} (raw: {eval_result})"
            ));
            return;
        }
    };
    let Some(inner_str) = inner_json.as_str() else {
        append_debug_log(&format!(
            "[popup:{tile_id}] credential capture: eval_with_callback result wasn't a JSON string: {inner_json}"
        ));
        return;
    };
    let mut captured: serde_json::Value = match serde_json::from_str(inner_str) {
        Ok(v) => v,
        Err(e) => {
            append_debug_log(&format!(
                "[popup:{tile_id}] credential capture: failed to parse window.__conduit JSON: {e} (raw: {inner_str})"
            ));
            return;
        }
    };

    if let Some(logs) = captured.get("logs") {
        append_debug_log(&format!("[popup:{tile_id}] captured console: {logs}"));
    }

    let credential = captured
        .get_mut("credential")
        .filter(|v| !v.is_null())
        .cloned();
    let post_message_payload = captured
        .get_mut("postMessagePayload")
        .filter(|v| !v.is_null())
        .cloned();

    if credential.is_none() && post_message_payload.is_none() {
        append_debug_log(&format!(
            "[popup:{tile_id}] no credential or postMessage payload captured — the relay flow never reached window.opener, or the window.opener shim didn't stick"
        ));
        return;
    }

    let Some(opener) = app.get_webview(tile_id) else {
        append_debug_log(&format!(
            "[popup:{tile_id}] captured a credential/message but the opener tile webview is gone, can't relay it"
        ));
        return;
    };

    if let Some(credential) = credential {
        let mut truncated = credential.clone();
        truncate_json_strings(&mut truncated);
        append_debug_log(&format!(
            "[popup:{tile_id}] captured credential shape: {truncated}"
        ));
        let relay_script = format!(
            r#"try {{
  if (window.gis && window.gis.provider && window.gis.provider.relayCredentialResponse) {{
    window.gis.provider.relayCredentialResponse({credential});
    console.log('[conduit] relayed captured Google credential to window.gis.provider.relayCredentialResponse');
  }} else {{
    console.warn('[conduit] captured Google credential but window.gis.provider.relayCredentialResponse is not present on this page');
  }}
}} catch (e) {{
  console.error('[conduit] credential relay threw', String(e));
}}"#
        );
        if let Err(e) = opener.eval(&relay_script) {
            append_debug_log(&format!(
                "[popup:{tile_id}] failed to eval relay script on opener tile: {e}"
            ));
        }
    }

    if let Some(payload) = post_message_payload {
        let mut truncated = payload.clone();
        truncate_json_strings(&mut truncated);
        append_debug_log(&format!(
            "[popup:{tile_id}] captured opener.postMessage payload: {truncated}"
        ));
        // Real GSI relay data is always a JSON string (see the doc comment
        // above), so pass it through as the MessageEvent's `data` verbatim
        // rather than round-tripping through serde — this only needs to be
        // valid to embed as a JS string literal, not re-parsed as JSON here.
        let data_str = payload
            .get("data")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let data_literal = serde_json::to_string(data_str).unwrap_or_else(|_| "\"\"".to_string());
        // The real popup's postMessage would report `event.origin` as
        // `https://accounts.google.com` (the popup's own origin) to
        // whatever listener Tubi's GSI client library registered on its
        // page — dispatching a synthetic MessageEvent with that origin
        // reproduces exactly what that listener would have seen from a
        // real cross-window call, without needing a real window.opener.
        let relay_script = format!(
            r#"try {{
  window.dispatchEvent(new MessageEvent('message', {{ data: {data_literal}, origin: 'https://accounts.google.com' }}));
  console.log('[conduit] relayed captured opener.postMessage payload as a synthetic message event');
}} catch (e) {{
  console.error('[conduit] postMessage relay threw', String(e));
}}"#
        );
        if let Err(e) = opener.eval(&relay_script) {
            append_debug_log(&format!(
                "[popup:{tile_id}] failed to eval postMessage relay script on opener tile: {e}"
            ));
        }
    }
}

/// Handles the popup once it reaches [`is_gsi_transform_relay`]: on a
/// deferred thread (matches this codebase's established pattern elsewhere —
/// spawn a thread, hop back onto the main thread rather than doing
/// window/webview work synchronously inside a callback), gives the relay
/// bundle a moment to attempt its `window.opener` hand-off (end-to-end well
/// under 300ms in a captured HAR), then reads back `window.__conduit`
/// (populated by [`popup_opener_shim_script`]) via `eval_with_callback`,
/// hands the result to [`handle_captured_credential`] to relay onto the
/// opener tile, and closes the now-finished popup.
#[cfg(target_os = "macos")]
fn schedule_credential_capture(app: AppHandle, tile_id: String, popup_label: String) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let _ = app.clone().run_on_main_thread(move || {
            let Some(popup) = app.get_webview(&popup_label) else {
                close_popups_for_tile(&app, &tile_id);
                return;
            };
            let capture_app = app.clone();
            let capture_tile_id = tile_id.clone();
            let eval_result =
                popup.eval_with_callback("JSON.stringify(window.__conduit || {})", move |result| {
                    handle_captured_credential(&capture_app, &capture_tile_id, &result);
                    close_popups_for_tile(&capture_app, &capture_tile_id);
                });
            if eval_result.is_err() {
                close_popups_for_tile(&app, &tile_id);
            }
        });
    });
}

/// Invoked from `tile_activity_listener_script`, running inside a tile's own
/// webview, to report user activity there back to the launcher page —
/// otherwise invisible to it, since a tile is a separate native webview with
/// no DOM relationship to the launcher's own `window`. Just re-emits as an
/// event; `screensaver.ts` treats it as an idle-timer reset, the same way it
/// already treats `return-to-grid`.
#[command]
pub fn report_tile_activity(app: AppHandle) {
    let _ = app.emit("tile-activity", ());
}

/// Invoked from `popup_close_listener_script` inside a tile's page once an
/// SSO popup signals completion back to the opener. Takes no tile id from the
/// page: a tile webview's label *is* its tile id (see `launch_tile`), so a
/// page can only ever close its own popups.
#[command]
pub fn close_tile_popups(webview: tauri::Webview) {
    close_popups_for_tile(webview.app_handle(), webview.label());
}

/// Force-closes any popup window(s) opened for `tile_id` via `handle_new_window`
/// (labeled `"{tile_id}-popup-{n}"`). See `popup_close_listener_script`'s doc
/// comment for why this bypasses wry's own close handling instead of relying
/// on it.
fn close_popups_for_tile(app: &AppHandle, tile_id: &str) {
    let prefix = format!("{tile_id}-popup-");
    for (label, window) in app.webview_windows() {
        if label.starts_with(&prefix) {
            let _ = window.close();
        }
    }
}

/// Handles a tile webview's `window.open()` request (Tauri/wry's
/// `on_new_window`). Without a handler installed at all, wry's WKWebView
/// delegate returns `nil` for every popup request, which is indistinguishable
/// on the JS side from the browser blocking it — exactly what Google Identity
/// Services (GSI) logs as `Failed to open popup window ... Maybe blocked by
/// the browser?` for Tubi's "Continue with Google". That failure happens
/// entirely inside WKWebView/wry, before `on_navigation`/`domain_allowed`
/// ever runs, so a disallowed popup target used to fail silently instead of
/// showing up in the Settings "recently blocked" list the way a blocked
/// navigation does.
///
/// Applies the exact same allowlist (`domain_allowed`) used for in-place
/// navigation: a disallowed target is recorded via `record_blocked` just like
/// `on_navigation` does, closing that gap; an allowed target gets a real
/// popup window, sharing the tile's own data-directory partition and (macOS)
/// user-agent override so it behaves like an extension of the tile's own
/// webview rather than an isolated browser profile. `window_features(features)`
/// wires up the platform-specific "related to the opener" requirement (shared
/// `WKWebViewConfiguration` on macOS, shared WebView2 environment on Windows,
/// `with_related_view` on Linux) that popup-based OAuth flows rely on for
/// `window.opener`/`postMessage` back to the tile and `window.close()` to
/// work once sign-in finishes.
fn handle_new_window(
    app: &AppHandle,
    tile_id: &str,
    allowed_domains: &[String],
    data_dir: &std::path::Path,
    user_agent: Option<&'static str>,
    url: Url,
    features: tauri::webview::NewWindowFeatures,
) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    if !domain_allowed(&url, allowed_domains) {
        if let Some(host) = url.host_str() {
            record_blocked(app, tile_id, host);
        }
        eprintln!("[popup:{tile_id}] {url} -> BLOCKED");
        return tauri::webview::NewWindowResponse::<tauri::Wry>::Deny;
    }
    eprintln!("[popup:{tile_id}] {url} -> allowed");

    let label = next_popup_label(tile_id);
    let popup_tile_id = tile_id.to_string();
    let popup_app = app.clone();
    let popup_allowed_domains = allowed_domains.to_vec();
    #[cfg(target_os = "macos")]
    let popup_label = label.clone();
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url.clone()))
            .title("Conduit")
            .window_features(features)
            .data_directory(data_dir.to_path_buf())
            .on_navigation(move |nav_url| {
                let allowed = domain_allowed(nav_url, &popup_allowed_domains);
                if !allowed {
                    if let Some(host) = nav_url.host_str() {
                        record_blocked(&popup_app, &popup_tile_id, host);
                    }
                }
                // macOS only: see `popup_opener_shim_script` for why Windows
                // doesn't need (and is broken by) the credential capture.
                #[cfg(target_os = "macos")]
                if allowed && is_gsi_transform_relay(nav_url) {
                    schedule_credential_capture(
                        popup_app.clone(),
                        popup_tile_id.clone(),
                        popup_label.clone(),
                    );
                }
                allowed
            });
    #[cfg(target_os = "macos")]
    {
        builder = builder.initialization_script(popup_opener_shim_script());
        #[cfg(debug_assertions)]
        {
            builder = builder.initialization_script(popup_diagnostic_logging_script());
        }
    }
    for script in tile_compat_scripts(user_agent) {
        builder = builder.initialization_script(script);
    }
    if let Some(ua) = user_agent {
        builder = builder.user_agent(ua);
    }

    match builder.build() {
        Ok(window) => {
            #[cfg(debug_assertions)]
            window.open_devtools();
            tauri::webview::NewWindowResponse::Create { window }
        }
        Err(e) => {
            eprintln!("[popup:{tile_id}] failed to create popup window for {url}: {e}");
            tauri::webview::NewWindowResponse::Deny
        }
    }
}

/// The position/size a tile's child webview should have to fill the main
/// window's content area.
fn tile_bounds(main_window: &Window) -> tauri::Result<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    Ok((PhysicalPosition::new(0, 0), main_window.inner_size()?))
}

/// The URL a tile's webview is currently showing, if it has one open
/// anywhere (main window or floating in picture-in-picture). Used to resume
/// on the same page when a webview is destroyed and rebuilt across a PiP
/// transition, rather than resetting to the tile's `base_url`.
fn tile_url(app: &AppHandle, id: &str) -> Option<Url> {
    app.get_webview(id).and_then(|w| w.url().ok())
}

/// Embeds (or re-shows) a tile as a child webview filling the main window.
/// The webview is created once and kept alive (hidden, not destroyed) across
/// grid/tile switches so playback/session state survives; `add_child`'s
/// `auto_resize` keeps it filling the main window on later resizes without
/// any manual geometry sync.
///
/// `resume_url` is used instead of the tile's `base_url` when a fresh
/// webview has to be built (rather than reusing an already-open one) — the
/// PiP-exit paths pass the page the tile was actually showing so leaving PiP
/// doesn't reset it back to the tile's home page. Pass `None` for a genuine
/// first launch.
fn launch_tile(
    main_window: &Window,
    app: &AppHandle,
    tile: &AppTile,
    resume_url: Option<Url>,
) -> tauri::Result<()> {
    let (position, size) = tile_bounds(main_window)?;

    let previous = app.state::<ActiveTileState>().lock().unwrap().clone();
    if let Some(previous_id) = previous {
        if previous_id != tile.id {
            if let Some(previous_webview) = app.get_webview(&previous_id) {
                previous_webview.hide()?;
            }
        }
    }

    let mut resume_url = resume_url;
    if let Some(existing) = app.get_webview(&tile.id) {
        if existing.window().label() == "pip" {
            // The tile is currently floating in picture-in-picture. Geometry
            // setters don't reparent a webview between windows (that's the
            // exact class of bug documented on `enter_pip_fallback`), so repositioning
            // it in place here would just corrupt its frame rather than move
            // it. Destroy it and the now-empty "pip" window instead, then
            // fall through to create a fresh instance in the main window
            // below, same as if it had never existed. Capture its current
            // page first so the fresh instance resumes there instead of
            // resetting to base_url.
            resume_url = resume_url.or_else(|| tile_url(app, &tile.id));
            close_tile_window(app, &tile.id);
            close_pip_if_empty(app);
        }
    }

    let webview = if let Some(webview) = app.get_webview(&tile.id) {
        webview.set_auto_resize(true)?;
        webview.set_position(position)?;
        webview.set_size(size)?;
        webview.show()?;
        webview
    } else {
        let base_url: Url = tile
            .base_url
            .parse()
            .unwrap_or_else(|e| panic!("tile {} has an invalid base_url: {e}", tile.id));
        let url = resume_url.unwrap_or_else(|| base_url.clone());
        let data_dir = app.path().app_data_dir()?.join("partitions").join(&tile.id);
        let allowed_domains = effective_allowed_domains(tile, &base_url);
        let user_agent = tile_user_agent(&base_url);

        // TEMPORARY diagnostic logging for the Hulu/Amazon login-rejection
        // investigation — prints every navigation decision for a tile's
        // webview to stderr (visible in `pnpm tauri dev`'s terminal) so a
        // silently-blocked redirect (e.g. a captcha/challenge domain outside
        // `allowed_domains`) can be told apart from a rejection the site
        // itself is issuing. Remove once the root cause is confirmed.
        let log_tile_id = tile.id.clone();
        let nav_app = app.clone();
        let popup_tile_id = tile.id.clone();
        let popup_app = app.clone();
        let popup_allowed_domains = allowed_domains.clone();
        let popup_data_dir = data_dir.clone();
        let mut webview_builder = WebviewBuilder::new(&tile.id, WebviewUrl::External(url))
            .data_directory(data_dir)
            .on_navigation(move |url| {
                let allowed = domain_allowed(url, &allowed_domains);
                eprintln!(
                    "[nav:{log_tile_id}] {url} -> {}",
                    if allowed { "allowed" } else { "BLOCKED" }
                );
                if !allowed {
                    if let Some(host) = url.host_str() {
                        record_blocked(&nav_app, &log_tile_id, host);
                    }
                }
                allowed
            })
            .on_new_window(move |url, features| {
                handle_new_window(
                    &popup_app,
                    &popup_tile_id,
                    &popup_allowed_domains,
                    &popup_data_dir,
                    user_agent,
                    url,
                    features,
                )
            })
            .initialization_script(popup_close_listener_script())
            .initialization_script(tile_activity_listener_script());
        for script in tile_compat_scripts(user_agent) {
            webview_builder = webview_builder.initialization_script(script);
        }
        if let Some(ua) = user_agent {
            webview_builder = webview_builder.user_agent(ua);
            eprintln!("[webview:{}] created with UA override: {ua}", tile.id);
        }
        main_window.add_child(webview_builder.auto_resize(), position, size)?
    };

    webview.set_focus()?;
    *app.state::<ActiveTileState>().lock().unwrap() = Some(tile.id.clone());
    Ok(())
}

/// Opens (or re-shows) the named tile, embedded in the main window, looked
/// up from the app registry. `async` because creating a tile's child webview
/// for the first time deadlocks on Windows if run synchronously on the
/// invoke handler's thread (wry issue #583).
#[command]
pub async fn launch_app(
    window: Window,
    app: AppHandle,
    registry: State<'_, RegistryState>,
    id: String,
) -> Result<(), String> {
    let tile = registry
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| format!("no tile with id {id}"))?;
    launch_tile(&window, &app, &tile, None).map_err(|e| e.to_string())?;
    shortcuts::register(&app)
}

/// The currently-active tile's webview, if any (tracked via `ActiveTileState`
/// rather than queried, since a child `Webview` has no OS-reported
/// visibility of its own).
pub fn visible_tile_webview(app: &AppHandle) -> Option<Webview> {
    let label = app.state::<ActiveTileState>().lock().unwrap().clone()?;
    app.get_webview(&label)
}

/// Reloads whichever tile is currently active. No-op if none is. The
/// primary trigger is the global refresh shortcut
/// (`shortcuts::REFRESH_SHORTCUT`) and the "Refresh" menu item, since tiles
/// run no Conduit JS to call this as a command from inside themselves;
/// exposed as a command too for a possible future UI button.
#[command]
pub fn refresh_active_tile(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = visible_tile_webview(&app) {
        webview.reload().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Navigates the active tile's webview one step back in its own in-page
/// history. Tauri's `Webview` has no native `back()`/`forward()` (confirmed
/// against the installed tauri crate), so this evaluates the same
/// `history.back()`/`history.forward()` a browser's own back button would
/// run, in-page — the same eval-injection approach `NATIVE_PIP_TOGGLE_SCRIPT`
/// already uses elsewhere in this file. No-op if no tile is active.
#[command]
pub fn navigate_active_tile_back(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = visible_tile_webview(&app) {
        webview.eval("history.back()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// See `navigate_active_tile_back`; the forward-history equivalent.
#[command]
pub fn navigate_active_tile_forward(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = visible_tile_webview(&app) {
        webview
            .eval("history.forward()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Navigates the active tile's webview back to its registry `base_url`
/// (the "Site Home" menu item — distinct from "Home", which returns to the
/// tile grid via `return_to_grid`) — unlike `refresh_active_tile`, which
/// reloads whatever page is currently showing, this discards it in favor of
/// the tile's own home page.
#[command]
pub fn navigate_active_tile_home(app: AppHandle) -> Result<(), String> {
    let Some(tile) = active_tile(&app) else {
        return Ok(());
    };
    let Some(webview) = visible_tile_webview(&app) else {
        return Ok(());
    };
    let url: Url = tile
        .base_url
        .parse()
        .map_err(|e| format!("tile {} has an invalid base_url: {e}", tile.id))?;
    webview.navigate(url).map_err(|e| e.to_string())
}

/// Closes the "pip" window if it has no child webview left (e.g. right after
/// `close_tile_window` destroyed the one tile it was showing), so a tile
/// deletion or a grid re-selection never leaves an empty, undismissable
/// popup behind. Not used from "pip"'s own `CloseRequested` handler — the
/// window is already mid-close there, and closing it again from inside its
/// own close callback would just re-request the same close.
pub(crate) fn close_pip_if_empty(app: &AppHandle) {
    if let Some(pip_window) = app.get_window("pip") {
        if pip_window.webviews().is_empty() {
            let _ = pip_window.close();
        }
    }
}

/// Injected into the picture-in-picture webview so the otherwise-chromeless
/// popup can still be dragged and closed. Tiles are third-party pages
/// (Netflix, Hulu, ...) with no drag region or close affordance of their
/// own, and a `decorations(false)` window has no native titlebar to provide
/// either — on every platform, not just Windows/Linux, since macOS drops its
/// traffic-light close button too. Runs on every navigation (including the
/// initial load), before the page's own scripts, via `withGlobalTauri`'s
/// `window.__TAURI__`.
const PIP_DRAG_STRIP_SCRIPT: &str = r#"(() => {
  const strip = document.createElement('div');
  strip.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:24px;z-index:2147483647;' +
    'background:rgba(0,0,0,0.35);cursor:move;display:flex;' +
    'justify-content:flex-end;align-items:center;';
  strip.addEventListener('mousedown', (e) => {
    if (e.target !== strip || e.button !== 0) return;
    window.__TAURI__.window.getCurrentWindow().startDragging();
  });

  const closeButton = document.createElement('div');
  closeButton.textContent = '✕';
  closeButton.style.cssText =
    'width:24px;height:24px;display:flex;align-items:center;' +
    'justify-content:center;color:#fff;font:13px sans-serif;cursor:pointer;';
  closeButton.addEventListener('click', () => {
    window.__TAURI__.core.invoke('toggle_pip_command');
  });
  strip.appendChild(closeButton);

  const attach = () => document.body && document.body.appendChild(strip);
  if (document.body) {
    attach();
  } else {
    document.addEventListener('DOMContentLoaded', attach);
  }
})();"#;

/// The size/corner-margin of the picture-in-picture popup.
const PIP_WIDTH: u32 = 480;
const PIP_HEIGHT: u32 = 270;
const PIP_MARGIN: i32 = 24;

/// Toggles the browser's own native Picture-in-Picture for whichever
/// `<video>` element is currently playing in the tile's webview — no window
/// or webview is created or destroyed, so playback is never interrupted and
/// the in-page URL never changes. This is the primary PiP path, evaluated
/// directly in the tile's own webview via `Webview::eval`; see
/// `enter_pip_fallback` for what happens when it can't be used.
///
/// Picks the first playing video, falling back to the largest on-screen one
/// (covers players that keep a `<video>` element around paused/hidden for
/// pre-roll ads or the next episode). Reports failure back to
/// `report_native_pip_unavailable` — via `invoke`, since a rejected promise
/// can't be observed from `eval`'s synchronous return value — when there's
/// no video, the browser doesn't support PiP for it, or the request is
/// rejected outright, which happens most often because
/// `requestPictureInPicture` requires a genuine user gesture and this is
/// triggered by a global shortcut or menu item instead of a click inside the
/// page.
const NATIVE_PIP_TOGGLE_SCRIPT: &str = r#"(() => {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
    return;
  }
  const videos = Array.from(document.querySelectorAll('video'));
  const video =
    videos.find((v) => !v.paused && !v.ended && v.readyState > 2) ||
    videos.sort(
      (a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight,
    )[0];
  if (!video || !document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== 'function') {
    window.__TAURI__.core.invoke('report_native_pip_unavailable');
    return;
  }
  video.requestPictureInPicture().catch(() => {
    window.__TAURI__.core.invoke('report_native_pip_unavailable');
  });
})();"#;

/// The tile currently active in the main window, if any, looked up from the
/// app registry via `ActiveTileState`.
fn active_tile(app: &AppHandle) -> Option<AppTile> {
    let label = app.state::<ActiveTileState>().lock().unwrap().clone()?;
    app.state::<RegistryState>()
        .lock()
        .unwrap()
        .get(&label)
        .cloned()
}

/// Fallback for when native Picture-in-Picture (`NATIVE_PIP_TOGGLE_SCRIPT`)
/// isn't available for the active tile's video: destroys its main-window-
/// hosted webview (so there's never two live instances of the same
/// streaming page double-decoding/playing audio at once) and creates a
/// small, undecorated, resizable, always-on-top "pip" window with a *fresh*
/// webview of its own, navigated back to whatever page the tile was showing
/// (same data-directory partition, so login/session persists, but in-page
/// playback position doesn't — a deliberate, accepted trade-off, unlike the
/// native path above which never interrupts playback at all).
///
/// Building a fresh webview here, rather than reparenting the existing one,
/// sidesteps a previously-hit wry/wkwebview limitation: reparenting an
/// *existing* child `Webview` into a new bare `Window` left its content
/// never compositing on screen, even though its frame was set correctly.
/// A window that's never had an existing webview moved into it doesn't hit
/// that path at all.
///
/// Deliberately never toggles `set_decorations` on the *main* window (which
/// is how the previous single-window PiP implementation worked) — testing
/// found `set_decorations(true)` doesn't cleanly restore this app's window
/// chrome on macOS. Building a brand-new window with `decorations(false)`
/// from creation, and simply destroying it on exit rather than restoring
/// its chrome, avoids that bug entirely.
fn enter_pip_fallback(app: &AppHandle, tile: &AppTile) -> tauri::Result<()> {
    let resume_url = tile_url(app, &tile.id);
    close_tile_window(app, &tile.id);
    *app.state::<ActiveTileState>().lock().unwrap() = None;

    let Some(main_window) = app.get_window("main") else {
        return Ok(());
    };

    let pip_window = WindowBuilder::new(app, "pip")
        .decorations(false)
        .resizable(true)
        .always_on_top(true)
        .visible(false)
        .build()?;

    // `WindowBuilder::position`/`inner_size` take *logical* pixels, but the
    // corner-pinning math below is in *physical* pixels (matching
    // `Monitor::work_area`) — set geometry after `build()` via the physical
    // setters instead of feeding physical numbers into the builder, which
    // would silently be wrong by the display's scale factor.
    let pip_size = PhysicalSize::new(PIP_WIDTH, PIP_HEIGHT);
    pip_window.set_size(pip_size)?;
    if let Some(monitor) = main_window.current_monitor()? {
        let work_area = monitor.work_area();
        let x = work_area.position.x + work_area.size.width as i32 - PIP_WIDTH as i32 - PIP_MARGIN;
        let y =
            work_area.position.y + work_area.size.height as i32 - PIP_HEIGHT as i32 - PIP_MARGIN;
        pip_window.set_position(PhysicalPosition::new(x, y))?;
    }
    pip_window.show()?;

    let base_url: Url = tile
        .base_url
        .parse()
        .unwrap_or_else(|e| panic!("tile {} has an invalid base_url: {e}", tile.id));
    let url = resume_url.unwrap_or_else(|| base_url.clone());
    let data_dir = app.path().app_data_dir()?.join("partitions").join(&tile.id);
    let allowed_domains = effective_allowed_domains(tile, &base_url);
    let user_agent = tile_user_agent(&base_url);

    let pip_tile_id = tile.id.clone();
    let nav_app = app.clone();
    let popup_tile_id = tile.id.clone();
    let popup_app = app.clone();
    let popup_allowed_domains = allowed_domains.clone();
    let popup_data_dir = data_dir.clone();
    let mut webview_builder = WebviewBuilder::new(&tile.id, WebviewUrl::External(url))
        .data_directory(data_dir)
        .on_navigation(move |url| {
            let allowed = domain_allowed(url, &allowed_domains);
            if !allowed {
                if let Some(host) = url.host_str() {
                    record_blocked(&nav_app, &pip_tile_id, host);
                }
            }
            allowed
        })
        .on_new_window(move |url, features| {
            handle_new_window(
                &popup_app,
                &popup_tile_id,
                &popup_allowed_domains,
                &popup_data_dir,
                user_agent,
                url,
                features,
            )
        });
    for script in tile_compat_scripts(user_agent) {
        webview_builder = webview_builder.initialization_script(script);
    }
    if let Some(ua) = user_agent {
        webview_builder = webview_builder.user_agent(ua);
    }
    let webview = pip_window.add_child(
        webview_builder
            .initialization_script(PIP_DRAG_STRIP_SCRIPT)
            .initialization_script(popup_close_listener_script()),
        PhysicalPosition::new(0, 0),
        pip_size,
    )?;
    webview.set_focus()?;

    // The single source of truth for "PiP is exiting, clean up after it":
    // every trigger that closes the "pip" window (the toggle shortcut, the
    // View menu item, the drag-strip's own close button, or any other way
    // it might end up closed) funnels through this one handler rather than
    // duplicating cleanup at each call site. Also keeps the pip webview
    // filling the window as it's dragged bigger/smaller: wry's rate-based
    // `auto_resize` computes its resize ratio from the pip window's size at
    // webview-creation time, which is prone to the same "geometry change
    // doesn't visibly take effect" class of timing issue already documented
    // on `toggle_fullscreen_impl` in window.rs, so this resizes the webview
    // directly and deterministically instead of relying on it.
    let tile_id = tile.id.clone();
    let app_handle = app.clone();
    pip_window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            if let Some(webview) = app_handle.get_webview(&tile_id) {
                let _ = webview.set_size(*size);
            }
        }
        WindowEvent::CloseRequested { .. } => {
            let resume_url = tile_url(&app_handle, &tile_id);
            let app_handle = app_handle.clone();
            let tile_id = tile_id.clone();
            // Deferred onto a fresh thread + main-thread tick, matching this
            // codebase's established pattern (see `BACK_TO_GRID_SHORTCUT`'s
            // handler in shortcuts.rs) for anything that creates a window/
            // webview outside of a plain async command, since doing so
            // synchronously and nested inside another callback is the exact
            // class of issue that's caused deadlocks elsewhere in this app.
            std::thread::spawn(move || {
                let _ = app_handle.clone().run_on_main_thread(move || {
                    close_tile_window(&app_handle, &tile_id);
                    let Some(main_window) = app_handle.get_window("main") else {
                        return;
                    };
                    let tile = app_handle
                        .state::<RegistryState>()
                        .lock()
                        .unwrap()
                        .get(&tile_id)
                        .cloned();
                    if let Some(tile) = tile {
                        let _ = launch_tile(&main_window, &app_handle, &tile, resume_url);
                    }
                });
            });
        }
        _ => {}
    });

    Ok(())
}

/// Toggles picture-in-picture for whichever tile is currently active in the
/// main window. If the fallback floating window (`enter_pip_fallback`) is
/// open, closes it (returning that tile to the main window); otherwise
/// evaluates `NATIVE_PIP_TOGGLE_SCRIPT` in the active tile's own webview,
/// which enters or exits the browser's native Picture-in-Picture as
/// appropriate — the tile's webview is never touched here directly, so this
/// is safe to call from any thread. No-op if no tile is active and the
/// fallback window isn't open.
pub fn toggle_pip(app: &AppHandle) -> tauri::Result<()> {
    if let Some(pip_window) = app.get_window("pip") {
        return pip_window.close();
    }
    let Some(webview) = visible_tile_webview(app) else {
        return Ok(());
    };
    webview.eval(NATIVE_PIP_TOGGLE_SCRIPT)
}

/// JS-callable wrapper around `toggle_pip`, invoked by the picture-in-
/// picture drag-strip's own close button (the only close affordance on an
/// undecorated fallback PiP window) and available for any future in-app UI
/// button. `async` for consistency with `report_native_pip_unavailable` and
/// `launch_app`, though the direct paths through `toggle_pip` itself don't
/// strictly need it.
#[command]
pub async fn toggle_pip_command(app: AppHandle) -> Result<(), String> {
    toggle_pip(&app).map_err(|e| e.to_string())
}

/// Invoked from `NATIVE_PIP_TOGGLE_SCRIPT` when the active tile's webview
/// can't hand off to the browser's native Picture-in-Picture (no video,
/// unsupported, or the request was rejected — most commonly for lacking a
/// user gesture). Falls back to `enter_pip_fallback` for whichever tile is
/// still active. `async` because that creates a window and a webview, which
/// deadlocks on Windows if done synchronously on the invoke handler's thread
/// (wry issue #583 — same reason `launch_app` is async).
#[command]
pub async fn report_native_pip_unavailable(app: AppHandle) -> Result<(), String> {
    let Some(tile) = active_tile(&app) else {
        return Ok(());
    };
    enter_pip_fallback(&app, &tile).map_err(|e| e.to_string())
}

/// Closes (destroys) a tile's webview if it's currently loaded, wherever it
/// currently lives (the main window or floating in picture-in-picture). Used
/// when a tile is deleted from the registry, unlike `return_to_grid_impl`
/// which only hides a webview so playback/session state survives.
pub fn close_tile_window(app: &AppHandle, id: &str) {
    if let Some(webview) = app.get_webview(id) {
        let _ = webview.close();
    }
}

/// Immediately resizes the currently-active tile's webview (if any) to fill
/// the main window. `auto_resize` already keeps this in sync on ordinary
/// resizes, but macOS's fullscreen transition animation delays the
/// `Resized` event it relies on, so `window::toggle_fullscreen` calls this
/// directly for an immediate result. No-op while picture-in-picture is
/// active, since then no tile is embedded in the main window at all.
pub fn sync_active_tile_bounds(app: &AppHandle) -> tauri::Result<()> {
    let Some(webview) = visible_tile_webview(app) else {
        return Ok(());
    };
    let Some(main_window) = app.get_window("main") else {
        return Ok(());
    };
    let (position, size) = tile_bounds(&main_window)?;
    webview.set_position(position)?;
    webview.set_size(size)?;
    Ok(())
}

/// Hides whichever tile is currently active (without destroying it, so
/// playback position and session state survive) and returns input focus to
/// the launcher grid.
pub fn return_to_grid_impl(app: &AppHandle) -> tauri::Result<()> {
    let Some(label) = app.state::<ActiveTileState>().lock().unwrap().take() else {
        return Ok(());
    };

    if let Some(main_window) = app.get_window("main") {
        main_window.set_focus()?;
    }

    if let Some(webview) = app.get_webview(&label) {
        webview.set_auto_resize(true)?;
        webview.hide()?;
    }

    Ok(())
}

/// JS-callable entry point for returning to the grid. The primary path is
/// the global back-to-grid shortcut (`shortcuts::register`'s handler), which
/// calls `return_to_grid_impl` directly; this command exists for any
/// programmatic/JS-triggered return.
#[command]
pub fn return_to_grid(app: AppHandle) -> Result<(), String> {
    return_to_grid_impl(&app).map_err(|e| e.to_string())?;
    shortcuts::unregister(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domains(list: &[&str]) -> Vec<String> {
        list.iter().map(|d| d.to_string()).collect()
    }

    #[test]
    fn allows_exact_and_subdomain_matches() {
        let allowed = domains(&["netflix.com"]);
        assert!(domain_allowed(
            &Url::parse("https://netflix.com/").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://www.netflix.com/").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://api.netflix.com/x").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn rejects_suffix_confusion_and_unrelated_domains() {
        let allowed = domains(&["netflix.com"]);
        assert!(!domain_allowed(
            &Url::parse("https://netflix.com.evil.tld/").unwrap(),
            &allowed
        ));
        assert!(!domain_allowed(
            &Url::parse("https://hulu.com/").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn allows_common_sso_domains_regardless_of_tile() {
        let allowed = domains(&["netflix.com"]);
        assert!(domain_allowed(
            &Url::parse("https://accounts.google.com/signin").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://appleid.apple.com/auth").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn allows_common_captcha_domains_regardless_of_tile() {
        let allowed = domains(&["netflix.com"]);
        assert!(domain_allowed(
            &Url::parse("https://www.google.com/recaptcha/enterprise/anchor").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://www.gstatic.com/recaptcha/releases/foo.js").unwrap(),
            &allowed
        ));
        assert!(domain_allowed(
            &Url::parse("https://recaptcha.net/recaptcha/api2/anchor").unwrap(),
            &allowed
        ));
        assert!(!domain_allowed(
            &Url::parse("https://google.com/search").unwrap(),
            &allowed
        ));
    }

    #[test]
    fn a_tiles_own_domains_do_not_leak_to_another_tile() {
        let hulu_allowed = domains(&["hulu.com", "disney.com"]);
        assert!(!domain_allowed(
            &Url::parse("https://www.netflix.com/").unwrap(),
            &hulu_allowed
        ));
    }

    fn tile_with(base_url: &str, allowed_domains: &[&str]) -> AppTile {
        AppTile {
            id: "test".into(),
            name: "Test".into(),
            base_url: base_url.into(),
            allowed_domains: domains(allowed_domains),
            icon_slug: None,
        }
    }

    #[test]
    fn client_hints_script_only_accompanies_the_chrome_user_agent() {
        let has_hints = |ua| tile_compat_scripts(ua).contains(&CHROME_CLIENT_HINTS_SCRIPT);
        assert!(has_hints(Some(DESKTOP_CHROME_USER_AGENT)));
        assert!(!has_hints(Some("Mozilla/5.0 (Macintosh)")));
        assert!(!has_hints(None));
    }

    /// `capabilities/tile-remote.json` has to match every URL a tile page
    /// can be on, or its injected scripts' `invoke`s are silently rejected.
    #[test]
    fn tile_remote_capability_matches_tile_urls() {
        use tauri::utils::acl::capability::Capability;
        let capability: Capability =
            serde_json::from_str(include_str!("../capabilities/tile-remote.json")).unwrap();
        let urls = capability
            .remote
            .expect("tile-remote needs a remote block")
            .urls;
        let matches = |u: &str| {
            let url = Url::parse(u).unwrap();
            urls.iter().any(|p| {
                p.parse::<tauri::utils::acl::RemoteUrlPattern>()
                    .unwrap()
                    .test(&url)
            })
        };
        assert!(matches("https://www.netflix.com/browse"));
        assert!(matches("https://espn.com/watch/?q=1#x"));
        assert!(matches("http://192.168.50.50:8096/web/#/home"));
        assert!(matches("https://jellyfin.local:8920/"));
        assert!(!matches("tauri://localhost/"));
    }

    #[test]
    fn chrome_user_agent_applies_to_espn_hosts_only() {
        let wants = |u: &str| wants_chrome_user_agent(&Url::parse(u).unwrap());
        assert!(wants("https://www.espn.com/"));
        assert!(wants("https://espn.com/watch/"));
        assert!(!wants("https://www.netflix.com/"));
        assert!(!wants("https://espn.com.evil.tld/"));
        assert!(!wants("https://notespn.com/"));
    }

    #[test]
    fn effective_allowed_domains_includes_base_url_host_automatically() {
        let tile = tile_with("http://192.168.50.50:3000/", &[]);
        let base_url = Url::parse(&tile.base_url).unwrap();
        let effective = effective_allowed_domains(&tile, &base_url);
        assert!(domain_allowed(&base_url, &effective));
    }

    #[test]
    fn effective_allowed_domains_still_includes_manual_extras() {
        let tile = tile_with("https://www.hulu.com/", &["disney.com"]);
        let base_url = Url::parse(&tile.base_url).unwrap();
        let effective = effective_allowed_domains(&tile, &base_url);
        assert!(domain_allowed(
            &Url::parse("https://www.disney.com/login").unwrap(),
            &effective
        ));
    }
}
