import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderTileIcon } from "./icons";
import { openSettings } from "./settings-view";
import { findNextFocusTarget, type Direction } from "./spatial-nav";
import type { AppTile } from "./types";

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const grid = document.querySelector<HTMLElement>("#grid")!;

function tileMarkup(tile: AppTile): string {
  return `
    <span class="tile-icon">${renderTileIcon(tile.icon_slug, tile.name)}</span>
    <span class="tile-name">${escapeHtml(tile.name)}</span>
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

export async function renderGrid(): Promise<void> {
  const tiles = await invoke<AppTile[]>("list_apps");
  grid.innerHTML = "";

  for (const tile of tiles) {
    const button = document.createElement("button");
    button.className = "tile";
    button.dataset.tileId = tile.id;
    button.innerHTML = tileMarkup(tile);
    button.addEventListener("click", () => {
      void invoke("launch_app", { id: tile.id });
    });
    grid.appendChild(button);
  }

  const settingsButton = document.createElement("button");
  settingsButton.className = "tile tile-settings";
  settingsButton.dataset.tileId = "__settings__";
  settingsButton.innerHTML = `
    <span class="tile-icon">${gearIcon()}</span>
    <span class="tile-name">Settings</span>
  `;
  settingsButton.addEventListener("click", () => {
    openSettings();
  });
  grid.appendChild(settingsButton);

  focusGrid();
}

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#1c1c1f" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3" stroke-linecap="round"/></svg>`;
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

window.addEventListener("DOMContentLoaded", () => {
  void renderGrid();

  window.addEventListener("keydown", (e) => {
    if (e.metaKey && e.key === "Enter") {
      e.preventDefault();
      void invoke("toggle_fullscreen");
      return;
    }

    // Native "Enter activates the focused button" behavior isn't reliably
    // delivered through a Tauri WebviewWindow, so trigger it explicitly.
    if (
      e.key === "Enter" &&
      document.activeElement?.classList.contains("tile")
    ) {
      e.preventDefault();
      (document.activeElement as HTMLButtonElement).click();
      return;
    }

    const direction = ARROW_DIRECTIONS[e.key];
    if (direction && document.activeElement?.classList.contains("tile")) {
      e.preventDefault();
      moveFocus(direction);
    }
  });

  void listen("return-to-grid", () => {
    focusGrid();
  });
});
