import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isGamepadActive } from "./gamepad";
import type { AerialVideo, Preferences } from "./types";

/** How long the app has to sit idle in fullscreen before the screensaver
 * arms. Not user-configurable (yet) — only the on/off toggle is. */
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const GAMEPAD_POLL_MS = 500;

const overlay = document.querySelector<HTMLElement>("#screensaver")!;
const video = document.querySelector<HTMLVideoElement>("#screensaver-video")!;

let catalog: AerialVideo[] | null = null;
let catalogUnavailable = false;
let idleTimer: number | null = null;
let gamepadPollTimer: number | null = null;
let showing = false;

/** Fetches Apple's Aerial catalog once per session. Any failure (offline,
 * Apple's CDN unreachable, empty response) permanently disables the
 * screensaver for the rest of this session rather than retrying or
 * surfacing an error — it's a nice-to-have, never worth interrupting
 * anything for. */
async function loadCatalog(): Promise<AerialVideo[] | null> {
  if (catalog) return catalog;
  if (catalogUnavailable) return null;

  try {
    const videos = await invoke<AerialVideo[]>("fetch_aerial_catalog");
    if (videos.length === 0) throw new Error("empty catalog");
    catalog = videos;
    return catalog;
  } catch {
    catalogUnavailable = true;
    return null;
  }
}

function resetIdleTimer(): void {
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(
    () => void tryShowScreensaver(),
    IDLE_TIMEOUT_MS,
  );
}

/** Fires when the idle timer elapses. Re-checks the enabled toggle and
 * fullscreen state at fire-time (rather than caching them) since either can
 * change at any point during the idle wait. */
async function tryShowScreensaver(): Promise<void> {
  if (showing || catalogUnavailable) {
    if (!catalogUnavailable) resetIdleTimer();
    return;
  }

  const [preferences, isFullscreen] = await Promise.all([
    invoke<Preferences>("get_preferences"),
    invoke<boolean>("is_fullscreen"),
  ]);
  if (!preferences.screensaver_enabled || !isFullscreen) {
    resetIdleTimer();
    return;
  }

  const videos = await loadCatalog();
  if (!videos) return;

  const pick = videos[Math.floor(Math.random() * videos.length)];
  video.src = pick.url;
  await invoke("enter_screensaver");
  overlay.hidden = false;
  showing = true;
  void video.play().catch(() => {});
  gamepadPollTimer = window.setInterval(() => {
    if (isGamepadActive()) hideScreensaver();
  }, GAMEPAD_POLL_MS);
}

function hideScreensaver(): void {
  if (!showing) return;
  showing = false;

  if (gamepadPollTimer !== null) {
    window.clearInterval(gamepadPollTimer);
    gamepadPollTimer = null;
  }

  overlay.hidden = true;
  video.pause();
  video.removeAttribute("src");
  video.load();
  void invoke("exit_screensaver");
  resetIdleTimer();
}

function onActivity(): void {
  if (showing) {
    hideScreensaver();
  } else {
    resetIdleTimer();
  }
}

/** Wires the idle timer and dismiss listeners. Call once at app startup. */
export function initScreensaver(): void {
  window.addEventListener("mousemove", onActivity);
  window.addEventListener("mousedown", onActivity);
  window.addEventListener("keydown", onActivity);
  void listen("return-to-grid", onActivity);
  // A tile plays in its own separate native webview, not this page's DOM,
  // so activity inside it (e.g. moving the mouse over a video's own player
  // controls) never reaches the listeners above on its own — Rust relays it
  // here instead. See `tile_activity_listener_script` in `webview.rs`.
  void listen("tile-activity", onActivity);
  resetIdleTimer();
}
