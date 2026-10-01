/**
 * Per-OS differences in the launcher UI — just keyboard modifiers and the
 * shortcut labels built from them. Everything else is the same on both
 * platforms. Detected from the user agent rather than `@tauri-apps/plugin-os`
 * to avoid a whole plugin for one boolean: WebView2's UA always contains
 * "Windows", WKWebView's never does.
 */
export function isWindowsUserAgent(userAgent: string): boolean {
  return userAgent.includes("Windows");
}

export const IS_WINDOWS =
  typeof navigator !== "undefined" && isWindowsUserAgent(navigator.userAgent);

/** Whether `e` holds the platform's primary shortcut modifier — Cmd on
 * macOS, Ctrl on Windows (what Rust-side `CmdOrCtrl` accelerators mean). */
export function hasPrimaryModifier(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  windows: boolean = IS_WINDOWS,
): boolean {
  return windows ? e.ctrlKey : e.metaKey;
}

/** "Cmd" or "Ctrl", for shortcut labels shown in the UI. */
export function primaryModifierLabel(windows: boolean = IS_WINDOWS): string {
  return windows ? "Ctrl" : "Cmd";
}

/**
 * The Help panel's shortcut reference. Must stay in sync with the Rust-side
 * accelerators in `src-tauri/src/menu.rs` and `src-tauri/src/shortcuts.rs`
 * — including back-to-grid, which is `Ctrl+Shift+Backspace` on Windows
 * because Windows reserves Ctrl+Shift+Escape for Task Manager.
 */
export function keyboardShortcuts(
  windows: boolean = IS_WINDOWS,
): [string, string][] {
  const mod = primaryModifierLabel(windows);
  const backToGrid = windows ? "Ctrl+Shift+Backspace" : "Cmd+Shift+Escape";
  return [
    ["Arrow keys", "Move focus around the grid"],
    ["Enter", "Launch the focused tile"],
    ["E", "Enter edit mode on the focused tile (reorder or delete tiles)"],
    ["Arrow keys (editing)", "Move the grabbed tile"],
    ["Enter (editing)", "Grab or release the focused tile"],
    ["Delete / Backspace (editing)", "Remove the focused tile"],
    ["Escape (editing)", "Exit edit mode"],
    [`${mod}+Enter`, "Toggle full screen"],
    [backToGrid, "Return to the grid from a tile"],
    [`${mod}+Shift+R`, "Refresh the active tile"],
    [`${mod}+Shift+P`, "Toggle picture-in-picture for the active tile"],
    [`${mod}+[`, "Go back in the active tile's history"],
    [`${mod}+]`, "Go forward in the active tile's history"],
    [`${mod}+Shift+H`, "Return to the tile grid (View > Home)"],
    [`${mod}+Alt+I`, "Toggle DevTools (debug builds only)"],
    ["?", "Open this help panel"],
    ["Escape", "Close a panel (Settings or Help)"],
  ];
}
