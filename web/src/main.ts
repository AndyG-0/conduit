import {
  attachFaviconFallback,
  isFixedCanvasIcon,
  renderTileIcon,
} from "./icons";
import { openHelp } from "./help-view";
import { openSettings } from "./settings-view";
import { findNextFocusTarget, type Direction } from "./spatial-nav";
import { idAfter, moveIdBefore, swapIds } from "./reorder";
import { startGamepadPolling } from "./gamepad";
import { applyCachedTheme, applyTheme } from "./theme";
import { authApi, preferencesApi, tilesApi, UNAUTHENTICATED_EVENT } from "./api-client";
import { renderAuthView } from "./auth-view";
import {
  fallbackGradient,
  refreshTrendingCatalog,
  trendingFor,
} from "./trending";
import { refreshAllJellyfinBanners } from "./jellyfin";
import type { AppTileView } from "@conduit/shared";

applyCachedTheme();

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const authSection = document.querySelector<HTMLElement>("#auth")!;
const grid = document.querySelector<HTMLElement>("#grid")!;
const settingsPanel = document.querySelector<HTMLElement>("#settings")!;
const helpPanel = document.querySelector<HTMLElement>("#help")!;
const navToast = document.querySelector<HTMLElement>("#nav-toast")!;
const tileBanner = document.querySelector<HTMLElement>("#tile-banner")!;
const tileBannerArt =
  tileBanner.querySelector<HTMLElement>(".tile-banner-art")!;
const tileBannerBackdrop = tileBanner.querySelector<HTMLImageElement>(
  ".tile-banner-backdrop",
)!;
const tileBannerIcon =
  tileBanner.querySelector<HTMLElement>(".tile-banner-icon")!;
const tileBannerName =
  tileBanner.querySelector<HTMLElement>(".tile-banner-name")!;
const tileBannerTrending = tileBanner.querySelector<HTMLElement>(
  ".tile-banner-trending",
)!;

// Set by `renderGrid()`; cached so the focus/hover banner can look a tile's
// name and icon up synchronously instead of re-fetching the tile list.
let currentTiles: AppTileView[] = [];

// Edit-mode state (hold/press a tile to jiggle the grid, drag or grab-and-
// arrow to reorder, delete via each tile's own badge). `orderedTileIds` is
// the live working order while editing — reordering gestures mutate it (via
// the pure helpers in `./reorder`) and `applyTileOrder` reconciles the DOM
// to match; `exitEditMode` is the only place it's persisted to the backend.
let editMode = false;
let grabbedTileId: string | null = null;
let confirmingDeleteId: string | null = null;
let orderedTileIds: string[] = [];

const HOLD_TO_EDIT_MS = 550;
const DRAG_THRESHOLD_PX = 8;

function tileMarkup(tile: AppTileView): string {
  return `
    <span class="tile-icon">${renderTileIcon(tile.icon_slug, tile.name, tile.base_url)}</span>
    <span class="tile-name">${escapeHtml(tile.name)}</span>
    <span class="tile-delete-badge" role="button" aria-label="Remove ${escapeHtml(tile.name)}">×</span>
    <span class="tile-delete-confirm">
      <span>Remove ${escapeHtml(tile.name)}?</span>
      <span class="tile-delete-confirm-actions">
        <span class="tile-delete-confirm-action tile-delete-confirm-remove" role="button">Remove</span>
        <span class="tile-delete-confirm-action tile-delete-confirm-cancel" role="button">Cancel</span>
      </span>
    </span>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/**
 * Fills in the hero band's backdrop art + trending-titles line: real TMDB/
 * Jellyfin artwork/titles when `trendingFor` has an entry for this tile,
 * otherwise a generated brand-color gradient with no trending text, same as
 * a plain custom tile or the Settings/Help pseudo-tiles get.
 */
function setTileBannerArt(
  banner: ReturnType<typeof trendingFor>,
  name: string,
): void {
  if (banner) {
    tileBannerArt.style.background = "";
    tileBannerBackdrop.src = banner.backdrop_url;
    tileBannerBackdrop.hidden = false;
    tileBannerTrending.textContent = `Trending now: ${banner.titles.join(" · ")}`;
    tileBannerTrending.hidden = banner.titles.length === 0;
  } else {
    tileBannerBackdrop.hidden = true;
    tileBannerBackdrop.removeAttribute("src");
    tileBannerArt.style.background = fallbackGradient(name);
    tileBannerTrending.textContent = "";
    tileBannerTrending.hidden = true;
  }
}

/** Shows the given tile's name/icon/trending artwork in the top hero banner. */
function updateTileBanner(tileEl: HTMLElement): void {
  const id = tileEl.dataset.tileId;
  if (!id) return;

  if (id === "__settings__") {
    tileBannerIcon.innerHTML = gearIcon();
    tileBannerIcon.classList.remove("is-fixed-canvas");
    tileBannerName.textContent = "Settings";
    setTileBannerArt(null, "Settings");
  } else if (id === "__help__") {
    tileBannerIcon.innerHTML = helpIcon();
    tileBannerIcon.classList.remove("is-fixed-canvas");
    tileBannerName.textContent = "Help";
    setTileBannerArt(null, "Help");
  } else {
    const tile = currentTiles.find((t) => t.id === id);
    if (!tile) return;
    tileBannerIcon.innerHTML = renderTileIcon(
      tile.icon_slug,
      tile.name,
      tile.base_url,
    );
    attachFaviconFallback(tileBannerIcon, tile.icon_slug, tile.name, tile.id);
    tileBannerIcon.classList.toggle(
      "is-fixed-canvas",
      isFixedCanvasIcon(tile.icon_slug),
    );
    tileBannerName.textContent = tile.name;
    setTileBannerArt(trendingFor(tile.id), tile.name);
  }

  tileBanner.classList.add("is-visible");
}

export function hideTileBanner(): void {
  tileBanner.classList.remove("is-visible");
}

/** On mouse-out, falls back to whatever tile still holds keyboard focus
 * (rather than hiding outright) so the banner keeps matching the tile a
 * keyboard/gamepad user is actually on. */
function revertTileBannerToFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.classList.contains("tile")) {
    updateTileBanner(active);
  } else {
    hideTileBanner();
  }
}

/** Only wired for pointers that can actually hover (mouse/trackpad) — a
 * touchscreen tap synthesizes a `mouseenter` with no matching `mouseleave`,
 * which would otherwise leave the banner stuck visible (and, pre-`dvh`,
 * misaligned) over the grid until the next focus change. Touch users still
 * get the banner via `updateTileBanner`'s focus-driven callers. */
function attachBannerHoverListeners(button: HTMLButtonElement): void {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  button.addEventListener("mouseenter", () => updateTileBanner(button));
  button.addEventListener("mouseleave", revertTileBannerToFocus);
}

let toastTimeout: ReturnType<typeof setTimeout> | undefined;

/** There's no custom "return to home" mechanism in the PWA — launching a
 * tile is a same-tab navigation away from the grid entirely, and getting
 * back is standard browser Back. This toast is the only place that gets
 * explained, right before it happens. */
function showNavToast(): void {
  navToast.textContent = "Press Back in your browser to return to Conduit";
  navToast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    navToast.hidden = true;
  }, 2500);
}

function launchTile(tile: AppTileView): void {
  showNavToast();
  window.setTimeout(() => {
    location.href = tile.base_url;
  }, 400);
}

export async function renderGrid(): Promise<void> {
  const tiles = await tilesApi.list();
  currentTiles = tiles;
  orderedTileIds = tiles.map((t) => t.id);
  editMode = false;
  grabbedTileId = null;
  confirmingDeleteId = null;
  grid.classList.remove("is-editing");
  grid.innerHTML = "";

  for (const tile of tiles) {
    const button = document.createElement("button");
    button.className =
      "tile" + (isFixedCanvasIcon(tile.icon_slug) ? " is-fixed-canvas" : "");
    button.dataset.tileId = tile.id;
    button.innerHTML = tileMarkup(tile);
    attachFaviconFallback(button, tile.icon_slug, tile.name, tile.id);
    attachBannerHoverListeners(button);
    button.addEventListener("click", () => {
      // A plain click/tap on the tile body while jiggling does nothing —
      // launching the app mid-edit would be surprising, and the tile's job
      // right now is drag-to-reorder. Escape (or the delete badge) is how
      // edit mode actually gets acted on.
      if (editMode) return;
      launchTile(tile);
    });
    attachEditGestures(button, tile);
    attachDeleteHandlers(button, tile);
    grid.appendChild(button);
  }

  const settingsButton = document.createElement("button");
  settingsButton.className = "tile tile-settings";
  settingsButton.dataset.tileId = "__settings__";
  settingsButton.innerHTML = `
    <span class="tile-icon">${gearIcon()}</span>
    <span class="tile-name">Settings</span>
  `;
  attachBannerHoverListeners(settingsButton);
  settingsButton.addEventListener("click", () => {
    if (editMode) return;
    openSettings();
  });
  grid.appendChild(settingsButton);

  const helpButton = document.createElement("button");
  helpButton.className = "tile tile-settings";
  helpButton.dataset.tileId = "__help__";
  helpButton.innerHTML = `
    <span class="tile-icon">${helpIcon()}</span>
    <span class="tile-name">Help</span>
  `;
  attachBannerHoverListeners(helpButton);
  helpButton.addEventListener("click", () => {
    if (editMode) return;
    openHelp();
  });
  grid.appendChild(helpButton);

  focusGrid();
}

/** Applies `orderedTileIds`' order to the live DOM by re-appending each real
 * tile in sequence, then the `__settings__`/`__help__` pseudo-tiles last —
 * simpler and just as cheap at this scale (a launcher grid) as tracking
 * incremental DOM moves per gesture. One `querySelectorAll` up front rather
 * than a `querySelector` per id (each of which is its own linear DOM scan) —
 * matters here because this runs on every drag-driven reorder, not just the
 * occasional keyboard/gamepad swap. */
function applyTileOrder(): void {
  const byId = new Map<string, HTMLElement>();
  for (const el of grid.querySelectorAll<HTMLElement>("[data-tile-id]")) {
    byId.set(el.dataset.tileId!, el);
  }
  for (const id of orderedTileIds) {
    const el = byId.get(id);
    if (el) grid.appendChild(el);
  }
  for (const pseudoId of ["__settings__", "__help__"]) {
    const el = byId.get(pseudoId);
    if (el) grid.appendChild(el);
  }
}

function updateGrabbedHighlight(): void {
  for (const el of grid.querySelectorAll<HTMLElement>(".tile")) {
    el.classList.toggle("is-grabbed", el.dataset.tileId === grabbedTileId);
  }
}

/** Enters edit mode: the whole grid starts jiggling, `id`'s tile becomes
 * "grabbed" (arrow keys/D-pad will move it), and every tile's delete badge
 * becomes visible. No-op if already editing — `E` is only wired up while
 * `!editMode`, so a second press just does nothing rather than re-entering. */
function enterEditMode(id: string): void {
  if (editMode) return;
  editMode = true;
  grabbedTileId = id;
  grid.classList.add("is-editing");
  // Staggers the jiggle phase per tile so they don't all rock in lockstep —
  // a small negative delay starts each animation partway through its cycle.
  for (const el of grid.querySelectorAll<HTMLElement>(
    ".tile:not(.tile-settings)",
  )) {
    el.style.animationDelay = `${(Math.random() * -0.22).toFixed(3)}s`;
  }
  updateGrabbedHighlight();
}

/** Exits edit mode, persisting `orderedTileIds` as the new tile order, then
 * always re-renders from server truth (recovers cleanly if the reorder call
 * ever rejects — e.g. a stale id after a delete that failed to update
 * `orderedTileIds` for some reason). */
async function exitEditMode(): Promise<void> {
  if (!editMode) return;
  const ids = orderedTileIds;
  try {
    await tilesApi.reorder(ids);
  } catch {
    // Best-effort — `renderGrid()` below resyncs from whatever the backend
    // actually has either way.
  }
  await renderGrid();
}

/** Moves the grabbed tile one step in `direction`, swapping it with
 * whichever tile `findNextFocusTarget` says is the nearest neighbor that
 * way — the same geometry `moveFocus` uses, so this "just works" for an
 * arbitrary grid layout without any new nav logic. */
function moveGrabbedTile(direction: Direction): void {
  if (!grabbedTileId) return;
  const candidates = Array.from(
    grid.querySelectorAll<HTMLButtonElement>(".tile:not(.tile-settings)"),
  ).map((el) => ({ id: el.dataset.tileId!, rect: el.getBoundingClientRect() }));

  const targetId = findNextFocusTarget(candidates, grabbedTileId, direction);
  if (!targetId) return;

  orderedTileIds = swapIds(orderedTileIds, grabbedTileId, targetId);
  applyTileOrder();
  grid
    .querySelector<HTMLButtonElement>(`[data-tile-id="${grabbedTileId}"]`)
    ?.focus();
}

function showDeleteConfirm(id: string): void {
  confirmingDeleteId = id;
  grid
    .querySelector(`[data-tile-id="${id}"] .tile-delete-confirm`)
    ?.classList.add("is-confirming");
}

function cancelDeleteConfirm(): void {
  if (!confirmingDeleteId) return;
  grid
    .querySelector(
      `[data-tile-id="${confirmingDeleteId}"] .tile-delete-confirm`,
    )
    ?.classList.remove("is-confirming");
  confirmingDeleteId = null;
}

async function confirmDeleteTile(id: string): Promise<void> {
  await tilesApi.remove(id);
  currentTiles = currentTiles.filter((t) => t.id !== id);
  orderedTileIds = orderedTileIds.filter((tid) => tid !== id);
  if (grabbedTileId === id) grabbedTileId = null;
  if (confirmingDeleteId === id) confirmingDeleteId = null;
  grid.querySelector(`[data-tile-id="${id}"]`)?.remove();
}

function attachDeleteHandlers(
  button: HTMLButtonElement,
  tile: AppTileView,
): void {
  button
    .querySelector<HTMLElement>(".tile-delete-badge")!
    .addEventListener("click", (e) => {
      e.stopPropagation();
      showDeleteConfirm(tile.id);
    });
  button
    .querySelector<HTMLElement>(".tile-delete-confirm-remove")!
    .addEventListener("click", (e) => {
      e.stopPropagation();
      void confirmDeleteTile(tile.id);
    });
  button
    .querySelector<HTMLElement>(".tile-delete-confirm-cancel")!
    .addEventListener("click", (e) => {
      e.stopPropagation();
      cancelDeleteConfirm();
    });
}

interface DragState {
  pointerId: number;
  button: HTMLButtonElement;
  ghost: HTMLElement;
  grabOffsetX: number;
  grabOffsetY: number;
  lastClientX: number;
  lastClientY: number;
  rafPending: boolean;
}

let dragState: DragState | null = null;

function onWindowPointerMove(e: PointerEvent): void {
  if (!dragState || dragState.pointerId !== e.pointerId) return;
  dragState.lastClientX = e.clientX;
  dragState.lastClientY = e.clientY;
  // The ghost tracks the pointer on every event (cheap: no layout reads),
  // but the reorder check below does a hit-test plus a full DOM reappend —
  // coalesced to once per frame so a flurry of trackpad move events (far
  // more per second than the display can paint) can't pile up reorder work
  // faster than the browser can render it.
  dragState.ghost.style.left = `${e.clientX - dragState.grabOffsetX}px`;
  dragState.ghost.style.top = `${e.clientY - dragState.grabOffsetY}px`;

  if (dragState.rafPending) return;
  dragState.rafPending = true;
  requestAnimationFrame(() => {
    if (!dragState) return;
    dragState.rafPending = false;
    reconcileDragTarget(dragState.lastClientX, dragState.lastClientY);
  });
}

function onWindowPointerUp(): void {
  if (dragState) endDrag();
}

/** Starts a floating "ghost" clone that tracks the pointer directly (fixed
 * position, independent of document flow), while the real button becomes
 * invisible-but-still-in-flow so it keeps participating in the reorder as
 * other tiles' DOM positions shift under it. Avoids the classic "dragged
 * tile visually jumps when the DOM reorders under it" problem that a plain
 * `transform: translate(...)` on the real button would have, without
 * needing a full FLIP-style position-compensation scheme. */
function startDrag(button: HTMLButtonElement, e: PointerEvent): void {
  const rect = button.getBoundingClientRect();
  const ghost = button.cloneNode(true) as HTMLElement;
  ghost.classList.add("tile-drag-ghost");
  ghost.classList.remove("is-grabbed");
  ghost.querySelector(".tile-delete-badge")?.remove();
  ghost.querySelector(".tile-delete-confirm")?.remove();
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);

  button.classList.add("is-dragging");
  grid.classList.add("is-dragging-active");

  dragState = {
    pointerId: e.pointerId,
    button,
    ghost,
    grabOffsetX: e.clientX - rect.left,
    grabOffsetY: e.clientY - rect.top,
    lastClientX: e.clientX,
    lastClientY: e.clientY,
    rafPending: false,
  };

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerUp);
  window.addEventListener("mouseup", onWindowPointerUp);
}

function reconcileDragTarget(clientX: number, clientY: number): void {
  if (!dragState) return;
  const draggedId = dragState.button.dataset.tileId!;
  const targetTile = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>(".tile:not(.tile-settings)");
  if (!targetTile) return;
  const targetId = targetTile.dataset.tileId!;
  if (targetId === draggedId) return;

  const targetRect = targetTile.getBoundingClientRect();
  const placeBefore = clientX < targetRect.left + targetRect.width / 2;
  const beforeId = placeBefore ? targetId : idAfter(orderedTileIds, targetId);
  const next = moveIdBefore(orderedTileIds, draggedId, beforeId);
  if (next !== orderedTileIds) {
    orderedTileIds = next;
    applyTileOrder();
  }
}

function endDrag(): void {
  if (!dragState) return;
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointercancel", onWindowPointerUp);
  window.removeEventListener("mouseup", onWindowPointerUp);
  dragState.button.classList.remove("is-dragging");
  grid.classList.remove("is-dragging-active");
  dragState.ghost.remove();
  dragState = null;
}

/** Wires up this tile's long-press-to-edit and (once editing) drag-to-
 * reorder gestures. Only the *start* of a drag (the hold timer and the
 * initial threshold check) is handled per-button; once a drag is actually
 * underway, `startDrag` takes over via window-level listeners (see there
 * for why). */
function attachEditGestures(
  button: HTMLButtonElement,
  tile: AppTileView,
): void {
  let holdTimer: number | null = null;
  let startX = 0;
  let startY = 0;
  let armedPointerId: number | null = null;

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || confirmingDeleteId || dragState) return;
    startX = e.clientX;
    startY = e.clientY;
    armedPointerId = e.pointerId;
    if (!editMode) {
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        enterEditMode(tile.id);
      }, HOLD_TO_EDIT_MS);
    }
  });

  button.addEventListener("pointermove", (e) => {
    if (armedPointerId !== e.pointerId || dragState) return;
    const moved =
      Math.hypot(e.clientX - startX, e.clientY - startY) >= DRAG_THRESHOLD_PX;
    if (!moved) return;

    clearHoldTimer();
    // Clear this before branching, not just in the "not a drag" case: once
    // a drag starts, the button gets `pointer-events: none` (`.is-dragging`)
    // for its duration, but that's undone the instant `endDrag()` runs. If
    // `armedPointerId` were still set at that point, the next stray
    // `pointermove` the button receives — and there's always at least one,
    // since it's already past `DRAG_THRESHOLD_PX` from the original
    // `pointerdown` — would immediately call `startDrag` again with no new
    // press, making the drop look like it needs a second click.
    armedPointerId = null;
    if (editMode) {
      startDrag(button, e);
    }
  });

  const release = (e: PointerEvent) => {
    if (armedPointerId !== e.pointerId) return;
    clearHoldTimer();
    armedPointerId = null;
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
}

// Delegated rather than per-button: covers keyboard *and* gamepad focus
// changes for free, since `moveFocus`/`focusGrid` below just call `.focus()`
// on a tile button either way. Attached once — `#grid` itself is never
// replaced, only its children, across `renderGrid()` calls.
grid.addEventListener("focusin", (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (tile) updateTileBanner(tile);
});

// Pressing down on the grid background (anywhere that isn't one of the
// jiggling tiles) is the discoverable "how do I get out of this" escape
// hatch for mouse/trackpad users, who have no reason to know about the
// `Escape` key binding. This listens for `pointerdown`, not `click` —
// releasing a drag still fires a synthetic `click` on whatever ends up
// under the pointer, which often isn't a tile (grid gaps, tile borders),
// and a `click` listener here was misreading that as "clicked outside" and
// exiting edit mode right as a drag finished. A `pointerdown` outside a
// tile can only be a fresh, deliberate press — a drag's own pointerdown
// always starts on a tile button, never on the background.
grid.addEventListener("pointerdown", (e) => {
  if (!editMode || dragState) return;
  if (!(e.target as HTMLElement).closest(".tile")) {
    void exitEditMode();
  }
});

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3" stroke-linecap="round"/></svg>`;
}

function helpIcon(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9" /><path d="M9.2 9.5a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.1 1-1.1 1.9v.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/></svg>`;
}

export function focusGrid() {
  document.querySelector<HTMLButtonElement>("#grid .tile")?.focus();
}

export function moveFocus(direction: Direction): void {
  const current = document.activeElement as HTMLElement | null;
  const currentId = current?.dataset.tileId;
  if (!currentId) return;

  const candidates = Array.from(
    grid.querySelectorAll<HTMLButtonElement>(".tile"),
  ).map((el) => ({ id: el.dataset.tileId!, rect: el.getBoundingClientRect() }));

  const nextId = findNextFocusTarget(candidates, currentId, direction);
  if (!nextId) return;

  grid.querySelector<HTMLButtonElement>(`[data-tile-id="${nextId}"]`)?.focus();
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen().catch(() => {
      // Fullscreen requires a user gesture and can be denied by the
      // browser/OS — nothing useful to do beyond letting it silently fail.
    });
  }
}

function startApp(): void {
  grid.hidden = false;
  void renderGrid().then(() =>
    refreshAllJellyfinBanners(currentTiles, () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.classList.contains("tile")) {
        updateTileBanner(active);
      }
    }),
  );
  void preferencesApi.get().then((preferences) => {
    applyTheme(preferences.theme);
  });
  // `document.hasFocus()` keeps this window's polling from also driving
  // focus while the browser tab isn't actually frontmost.
  startGamepadPolling(
    (direction) => {
      if (editMode && grabbedTileId) {
        moveGrabbedTile(direction);
      } else if (!editMode) {
        moveFocus(direction);
      }
    },
    () =>
      document.hasFocus() &&
      (!grid.hidden || !settingsPanel.hidden || !helpPanel.hidden),
    () => {
      if (editMode) return;
      const tileId = document.activeElement?.classList.contains("tile")
        ? (document.activeElement as HTMLElement).dataset.tileId
        : undefined;
      if (tileId) enterEditMode(tileId);
    },
  );

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    if (e.key === "?" && !grid.hidden) {
      e.preventDefault();
      openHelp();
      return;
    }

    const focusedTileId = document.activeElement?.classList.contains("tile")
      ? (document.activeElement as HTMLElement).dataset.tileId
      : undefined;

    if (e.key.toLowerCase() === "e" && !editMode && focusedTileId) {
      e.preventDefault();
      enterEditMode(focusedTileId);
      return;
    }

    if (e.key === "Escape") {
      if (confirmingDeleteId) {
        e.preventDefault();
        cancelDeleteConfirm();
      } else if (editMode) {
        e.preventDefault();
        void exitEditMode();
      }
      return;
    }

    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      editMode &&
      focusedTileId
    ) {
      e.preventDefault();
      showDeleteConfirm(focusedTileId);
      return;
    }

    if (
      e.key === "Enter" &&
      document.activeElement?.classList.contains("tile")
    ) {
      e.preventDefault();
      if (editMode && confirmingDeleteId) {
        void confirmDeleteTile(confirmingDeleteId);
      } else if (editMode && focusedTileId) {
        grabbedTileId = grabbedTileId === focusedTileId ? null : focusedTileId;
        updateGrabbedHighlight();
      } else if (!editMode) {
        (document.activeElement as HTMLButtonElement).click();
      }
      return;
    }

    const direction = ARROW_DIRECTIONS[e.key];
    if (direction && document.activeElement?.classList.contains("tile")) {
      e.preventDefault();
      if (editMode && grabbedTileId) {
        moveGrabbedTile(direction);
      } else if (!editMode) {
        moveFocus(direction);
      }
    }
  });

  // Fire-and-forget: fetched once per session, cached in `trending.ts`. If
  // it lands after the user's already hovering/focused a tile, refresh that
  // tile's banner so it doesn't wait for the next hover/focus change.
  void refreshTrendingCatalog(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.classList.contains("tile")) {
      updateTileBanner(active);
    }
  });
}

function showAuthGate(needsSetup: boolean): void {
  grid.hidden = true;
  settingsPanel.hidden = true;
  helpPanel.hidden = true;
  authSection.hidden = false;
  renderAuthView(authSection, needsSetup, () => {
    authSection.hidden = true;
    startApp();
  });
}

window.addEventListener(UNAUTHENTICATED_EVENT, () => {
  showAuthGate(false);
});

window.addEventListener("DOMContentLoaded", () => {
  void authApi.status().then((status) => {
    if (status.authenticated) {
      startApp();
    } else {
      showAuthGate(status.needsSetup);
    }
  });
});
