import { describe, expect, it } from "vitest";
import {
  hasPrimaryModifier,
  isWindowsUserAgent,
  keyboardShortcuts,
} from "./platform";

const WEBVIEW2_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";
const WKWEBVIEW_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("isWindowsUserAgent", () => {
  it("detects WebView2 but not WKWebView", () => {
    expect(isWindowsUserAgent(WEBVIEW2_UA)).toBe(true);
    expect(isWindowsUserAgent(WKWEBVIEW_UA)).toBe(false);
  });
});

describe("hasPrimaryModifier", () => {
  it("uses Cmd on macOS and Ctrl on Windows", () => {
    const cmd = { metaKey: true, ctrlKey: false };
    const ctrl = { metaKey: false, ctrlKey: true };
    expect(hasPrimaryModifier(cmd, false)).toBe(true);
    expect(hasPrimaryModifier(ctrl, false)).toBe(false);
    expect(hasPrimaryModifier(ctrl, true)).toBe(true);
    expect(hasPrimaryModifier(cmd, true)).toBe(false);
  });
});

describe("keyboardShortcuts", () => {
  const keysFor = (windows: boolean) =>
    keyboardShortcuts(windows).map(([keys]) => keys);

  it("uses Cmd labels and Cmd+Shift+Escape on macOS", () => {
    const keys = keysFor(false);
    expect(keys).toContain("Cmd+Enter");
    expect(keys).toContain("Cmd+Shift+Escape");
    expect(keys.some((k) => k.includes("Ctrl"))).toBe(false);
  });

  it("uses Ctrl labels and Ctrl+Shift+Backspace on Windows", () => {
    const keys = keysFor(true);
    expect(keys).toContain("Ctrl+Enter");
    expect(keys).toContain("Ctrl+Shift+Backspace");
    expect(keys.some((k) => k.includes("Cmd"))).toBe(false);
  });

  it("lists the same actions on both platforms", () => {
    const actions = (windows: boolean) =>
      keyboardShortcuts(windows).map(([, action]) => action);
    expect(actions(true)).toEqual(actions(false));
  });
});
