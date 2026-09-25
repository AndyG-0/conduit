import type { Direction } from "./spatial-nav";

/**
 * D-pad and left-stick navigation for the launcher grid, mirroring the
 * keyboard arrow-key handling in main.ts via the same spatial-nav function.
 *
 * Caveat: this was written and code-reviewed without a physical controller
 * to test against — no gamepad hardware is available in this environment.
 * The Gamepad API's `standard` button/axis mapping (button 0 = face/confirm,
 * buttons 12-15 = D-pad, axes 0/1 = left stick) is well-documented and used
 * as-is, but the actual event wiring here is unverified on real hardware.
 */

const STANDARD_BUTTON = {
  CONFIRM: 0,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

const STICK_DEADZONE = 0.5;
const REPEAT_DELAY_MS = 220;

type MoveFocusFn = (direction: Direction) => void;
type GridFocused = () => boolean;

let rafHandle: number | null = null;
let lastMoveAt = 0;
let lastConfirmPressed = false;

function stickDirection(x: number, y: number): Direction | null {
  if (Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE) return null;
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }
  return y > 0 ? "down" : "up";
}

function poll(moveFocus: MoveFocusFn, isGridFocused: GridFocused) {
  const pads = navigator.getGamepads();
  const pad = pads.find((p) => p !== null);

  if (pad && isGridFocused()) {
    const now = performance.now();
    let direction: Direction | null;

    if (pad.buttons[STANDARD_BUTTON.DPAD_UP]?.pressed) direction = "up";
    else if (pad.buttons[STANDARD_BUTTON.DPAD_DOWN]?.pressed)
      direction = "down";
    else if (pad.buttons[STANDARD_BUTTON.DPAD_LEFT]?.pressed)
      direction = "left";
    else if (pad.buttons[STANDARD_BUTTON.DPAD_RIGHT]?.pressed)
      direction = "right";
    else direction = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0);

    if (direction && now - lastMoveAt > REPEAT_DELAY_MS) {
      moveFocus(direction);
      lastMoveAt = now;
    }

    const confirmPressed =
      pad.buttons[STANDARD_BUTTON.CONFIRM]?.pressed ?? false;
    if (confirmPressed && !lastConfirmPressed) {
      (document.activeElement as HTMLElement | null)?.click();
    }
    lastConfirmPressed = confirmPressed;
  }

  rafHandle = requestAnimationFrame(() => poll(moveFocus, isGridFocused));
}

/** Starts polling for gamepad input. Call once at app startup. */
export function startGamepadPolling(
  moveFocus: MoveFocusFn,
  isGridFocused: GridFocused,
): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => poll(moveFocus, isGridFocused));
}

export function stopGamepadPolling(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}
