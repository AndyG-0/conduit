import { invoke } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { renderTileIcon, KNOWN_ICON_SLUGS } from "./icons";
import { renderGrid, focusGrid } from "./main";
import type { AppTile, AppTileInput } from "./types";

const grid = document.querySelector<HTMLElement>("#grid")!;
const panel = document.querySelector<HTMLElement>("#settings")!;

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

function iconOptions(selected: string | null): string {
  const none = `<option value="" ${selected ? "" : "selected"}>None (monogram)</option>`;
  const options = KNOWN_ICON_SLUGS.map(
    (slug) =>
      `<option value="${slug}" ${slug === selected ? "selected" : ""}>${slug}</option>`,
  ).join("");
  return none + options;
}

function readForm(form: HTMLFormElement): AppTileInput {
  const data = new FormData(form);
  const iconSlug = String(data.get("icon_slug") ?? "").trim();
  return {
    name: String(data.get("name") ?? "").trim(),
    base_url: String(data.get("base_url") ?? "").trim(),
    allowed_domains: String(data.get("allowed_domains") ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    icon_slug: iconSlug || null,
  };
}

function tileRow(tile: AppTile): string {
  return `
    <li class="settings-row" data-id="${escapeHtml(tile.id)}">
      <span class="tile-icon settings-row-icon">${renderTileIcon(tile.icon_slug, tile.name)}</span>
      <span class="settings-row-name">${escapeHtml(tile.name)}</span>
      <span class="settings-row-url">${escapeHtml(tile.base_url)}</span>
      <button type="button" class="settings-edit" data-id="${escapeHtml(tile.id)}">Edit</button>
      <button type="button" class="settings-remove" data-id="${escapeHtml(tile.id)}">Remove</button>
    </li>
  `;
}

function formMarkup(tile?: AppTile): string {
  return `
    <form id="tile-form" class="tile-form">
      <h2>${tile ? `Edit ${escapeHtml(tile.name)}` : "Add a service"}</h2>
      <label>Name<input name="name" required value="${tile ? escapeHtml(tile.name) : ""}" /></label>
      <label>Base URL<input name="base_url" type="url" required value="${tile ? escapeHtml(tile.base_url) : ""}" /></label>
      <label>Allowed domains (comma-separated)
        <input name="allowed_domains" required value="${tile ? escapeHtml(tile.allowed_domains.join(", ")) : ""}" />
      </label>
      <label>Icon
        <select name="icon_slug">${iconOptions(tile?.icon_slug ?? null)}</select>
      </label>
      <div class="tile-form-actions">
        <button type="submit">${tile ? "Save" : "Add"}</button>
        <button type="button" id="tile-form-cancel">Cancel</button>
      </div>
      <p class="tile-form-error" id="tile-form-error" hidden></p>
    </form>
  `;
}

async function renderSettings(editingId: string | null = null): Promise<void> {
  const [tiles, autostartEnabled] = await Promise.all([
    invoke<AppTile[]>("list_apps"),
    isAutostartEnabled(),
  ]);
  const editing = editingId ? tiles.find((t) => t.id === editingId) : undefined;

  panel.innerHTML = `
    <div class="settings-header">
      <h1>Settings</h1>
      <button type="button" id="settings-close">Back</button>
    </div>
    <label class="settings-autostart">
      <input type="checkbox" id="autostart-toggle" ${autostartEnabled ? "checked" : ""} />
      Launch at login
    </label>
    <p class="settings-autostart-error" id="autostart-error" hidden></p>
    <ul class="settings-list">${tiles.map(tileRow).join("")}</ul>
    ${formMarkup(editing)}
  `;

  panel
    .querySelector<HTMLButtonElement>("#settings-close")!
    .addEventListener("click", () => {
      closeSettings();
    });

  const autostartError = panel.querySelector<HTMLElement>("#autostart-error")!;
  panel
    .querySelector<HTMLInputElement>("#autostart-toggle")!
    .addEventListener("change", (e) => {
      void (async () => {
        const checkbox = e.target as HTMLInputElement;
        const checked = checkbox.checked;
        autostartError.hidden = true;
        try {
          if (checked) {
            await enableAutostart();
          } else {
            await disableAutostart();
          }
        } catch (err) {
          checkbox.checked = !checked;
          autostartError.textContent = `Couldn't change launch-at-login setting: ${String(err)}`;
          autostartError.hidden = false;
        }
      })();
    });

  panel.querySelectorAll<HTMLButtonElement>(".settings-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      void renderSettings(btn.dataset.id!);
    });
  });

  panel
    .querySelectorAll<HTMLButtonElement>(".settings-remove")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        void (async () => {
          await invoke("delete_app", { id: btn.dataset.id! });
          await renderSettings();
        })();
      });
    });

  const form = panel.querySelector<HTMLFormElement>("#tile-form")!;
  const errorEl = panel.querySelector<HTMLElement>("#tile-form-error")!;

  panel
    .querySelector<HTMLButtonElement>("#tile-form-cancel")!
    .addEventListener("click", () => {
      void renderSettings();
    });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      errorEl.hidden = true;
      const input = readForm(form);
      try {
        if (editing) {
          await invoke("update_app", { id: editing.id, input });
        } else {
          await invoke("create_app", { input });
        }
        await renderSettings();
      } catch (err) {
        errorEl.textContent = String(err);
        errorEl.hidden = false;
      }
    })();
  });

  panel.querySelector<HTMLInputElement>("input[name=name]")?.focus();
}

export function openSettings(): void {
  grid.hidden = true;
  panel.hidden = false;
  void renderSettings();
}

export function closeSettings(): void {
  panel.hidden = true;
  grid.hidden = false;
  void renderGrid().then(focusGrid);
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden) {
    e.preventDefault();
    closeSettings();
  }
});
