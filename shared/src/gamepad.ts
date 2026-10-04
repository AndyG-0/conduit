import type { Direction } from "./spatial-nav.js";

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
const HOLD_TO_EDIT_MS = 550;

type MoveFocusFn = (direction: Direction) => void;
type GridFocused = () => boolean;
type ConfirmHeldFn = () => void;

let rafHandle: number | null = null;
let lastMoveAt = 0;
let lastConfirmPressed = false;
let confirmPressedSince: number | null = null;
let confirmHoldFired = false;

function stickDirection(x: number, y: number): Direction | null {
  if (Math.abs(x) < STICK_DEADZONE && Math.abs(y) < STICK_DEADZONE) return null;
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? "right" : "left";
  }
  return y > 0 ? "down" : "up";
}

function poll(
  moveFocus: MoveFocusFn,
  isGridFocused: GridFocused,
  onConfirmHeld?: ConfirmHeldFn,
) {
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

    // Edge- *and* duration-tracked rather than a plain "click on press": a
    // press has to clear the hold threshold to fire `onConfirmHeld` (entering
    // edit mode), and only a press that *doesn't* clear it still clicks —
    // on release, not on press, since we don't know which one it'll be until
    // either the hold fires or the button comes back up.
    const confirmPressed =
      pad.buttons[STANDARD_BUTTON.CONFIRM]?.pressed ?? false;
    if (confirmPressed && !lastConfirmPressed) {
      confirmPressedSince = now;
      confirmHoldFired = false;
    } else if (
      confirmPressed &&
      confirmPressedSince !== null &&
      !confirmHoldFired &&
      now - confirmPressedSince >= HOLD_TO_EDIT_MS
    ) {
      confirmHoldFired = true;
      onConfirmHeld?.();
    } else if (!confirmPressed && lastConfirmPressed) {
      if (!confirmHoldFired) {
        (document.activeElement as HTMLElement | null)?.click();
      }
      confirmPressedSince = null;
      confirmHoldFired = false;
    }
    lastConfirmPressed = confirmPressed;
  }

  rafHandle = requestAnimationFrame(() =>
    poll(moveFocus, isGridFocused, onConfirmHeld),
  );
}

/** Starts polling for gamepad input. Call once at app startup. */
export function startGamepadPolling(
  moveFocus: MoveFocusFn,
  isGridFocused: GridFocused,
  onConfirmHeld?: ConfirmHeldFn,
): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() =>
    poll(moveFocus, isGridFocused, onConfirmHeld),
  );
}

export function stopGamepadPolling(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

/** Whether any connected gamepad currently has a button pressed or a stick
 * pushed past the deadzone. Used by the screensaver's idle timer to treat
 * gamepad input as dismiss/activity even while it's showing (when the grid
 * itself is hidden, so the `moveFocus`-driven poll loop above is gated off). */
export function isGamepadActive(): boolean {
  const pads = navigator.getGamepads();
  const pad = pads.find((p) => p !== null);
  if (!pad) return false;

  if (pad.buttons.some((b) => b.pressed)) return true;
  return stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0) !== null;
}
