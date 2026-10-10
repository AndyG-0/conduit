import {
  attachFaviconFallback,
  isFixedCanvasIcon,
  renderTileIcon,
  KNOWN_ICON_SLUGS,
} from "./icons";
import { renderGrid, focusGrid, hideTileBanner } from "./main";
import { preferencesApi, tilesApi } from "./api-client";
import { refreshTrendingCatalog } from "./trending";
import { refreshJellyfinBanner } from "./jellyfin";
import {
  applyTheme,
  escapeHtml,
  type AppTileInput,
  type AppTileView,
  type ThemeSetting,
} from "@conduit/shared";

const grid = document.querySelector<HTMLElement>("#grid")!;
const panel = document.querySelector<HTMLElement>("#settings")!;

function iconOptions(selected: string | null): string {
  const none = `<option value="" ${selected ? "" : "selected"}>Auto (favicon)</option>`;
  const options = KNOWN_ICON_SLUGS.map(
    (slug) =>
      `<option value="${slug}" ${slug === selected ? "selected" : ""}>${slug}</option>`,
  ).join("");
  return none + options;
}

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function themeOptions(selected: ThemeSetting): string {
  return THEME_OPTIONS.map(
    ({ value, label }) =>
      `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`,
  ).join("");
}

/**
 * The Jellyfin API key field only makes sense for a self-hosted Jellyfin
 * server, not the seeded streaming-service tiles — gated on the tile's name
 * rather than showing it everywhere or trying to probe the URL to detect a
 * real Jellyfin server. A tile named something else entirely (e.g. "Media
 * Server") won't get the field; that's a documented limitation, not a bug.
 */
function isJellyfinName(name: string): boolean {
  return /jellyfin/i.test(name.trim());
}

function readForm(form: HTMLFormElement): AppTileInput {
  const data = new FormData(form);
  const iconSlug = String(data.get("icon_slug") ?? "").trim();
  return {
    name: String(data.get("name") ?? "").trim(),
    base_url: String(data.get("base_url") ?? "").trim(),
    icon_slug: iconSlug || null,
  };
}

/** Blank means "leave unchanged" (the field never redisplays a saved key,
 * so there's nothing to distinguish from a deliberate clear) — same
 * convention as the global TMDB key field. Saved via its own
 * `setJellyfinKey` call, decoupled from `readForm`/create/update, since the
 * key never lives on the `AppTileInput` the tile-CRUD endpoints accept. */
function readJellyfinApiKey(form: HTMLFormElement): string {
  const data = new FormData(form);
  return String(data.get("jellyfin_api_key") ?? "").trim();
}

function tileRow(tile: AppTileView): string {
  const fixedCanvas = isFixedCanvasIcon(tile.icon_slug)
    ? " is-fixed-canvas"
    : "";
  return `
    <li class="settings-row" data-id="${escapeHtml(tile.id)}">
      <span class="tile-icon settings-row-icon${fixedCanvas}">${renderTileIcon(tile.icon_slug, tile.name, tile.base_url)}</span>
      <span class="settings-row-name">${escapeHtml(tile.name)}</span>
      <span class="settings-row-url">${escapeHtml(tile.base_url)}</span>
      <button type="button" class="settings-edit" data-id="${escapeHtml(tile.id)}">Edit</button>
      <button type="button" class="settings-remove" data-id="${escapeHtml(tile.id)}">Remove</button>
    </li>
  `;
}

function formMarkup(tile?: AppTileView): string {
  return `
    <form id="tile-form" class="tile-form">
      <h2>${tile ? `Edit ${escapeHtml(tile.name)}` : "Add a service"}</h2>
      <label>Name<input name="name" required value="${tile ? escapeHtml(tile.name) : ""}" /></label>
      <label>Base URL<input name="base_url" type="url" required value="${tile ? escapeHtml(tile.base_url) : ""}" /></label>
      <label>Icon override (optional)
        <select name="icon_slug">${iconOptions(tile?.icon_slug ?? null)}</select>
      </label>
      <div id="jellyfin-field-wrap" ${!tile || !isJellyfinName(tile.name) ? "hidden" : ""}>
        <label>Jellyfin API key (optional — enables the trending banner for a self-hosted Jellyfin tile)
          <input
            name="jellyfin_api_key"
            type="password"
            autocomplete="off"
            placeholder="${
              tile?.jellyfin_api_key_set
                ? "Key saved — enter a new key to replace it"
                : "Optional"
            }"
          />
        </label>
      </div>
      <div class="tile-form-actions">
        <button type="submit">${tile ? "Save" : "Add"}</button>
        <button type="button" id="tile-form-cancel">Cancel</button>
      </div>
      <p class="tile-form-error" id="tile-form-error" hidden></p>
    </form>
  `;
}

async function renderSettings(editingId: string | null = null): Promise<void> {
  const [tiles, preferences] = await Promise.all([
    tilesApi.list(),
    preferencesApi.get(),
  ]);
  const editing = editingId ? tiles.find((t) => t.id === editingId) : undefined;

  panel.innerHTML = `
    <div class="settings-header">
      <h1>Settings</h1>
      <button type="button" id="settings-close">Back</button>
    </div>
    <label class="settings-autostart">
      <input type="checkbox" id="screensaver-toggle" ${preferences.screensaver_enabled ? "checked" : ""} />
      Aerial-style screensaver when idle
    </label>
    <p class="settings-autostart-error" id="screensaver-error" hidden></p>
    <label class="settings-autostart">
      Theme
      <select id="theme-select">${themeOptions(preferences.theme)}</select>
    </label>
    <p class="settings-autostart-error" id="theme-error" hidden></p>
    <label class="settings-autostart">
      TMDB API key (for the trending tile banner)
      <input
        type="password"
        id="tmdb-key-input"
        autocomplete="off"
        placeholder="${
          preferences.tmdb_api_key_set
            ? "API key saved — enter a new key to replace it"
            : "Optional — free key from themoviedb.org"
        }"
      />
    </label>
    <div class="settings-tmdb-key-row">
      <span class="settings-key-status" id="tmdb-key-status" hidden></span>
    </div>
    <p class="settings-autostart-error" id="tmdb-key-error" hidden></p>
    <ul class="settings-list">${tiles.map(tileRow).join("")}</ul>
    ${formMarkup(editing)}
  `;

  panel.querySelectorAll<HTMLLIElement>(".settings-row").forEach((row) => {
    const tile = tiles.find((t) => t.id === row.dataset.id);
    if (tile) attachFaviconFallback(row, tile.icon_slug, tile.name, tile.id);
  });

  panel
    .querySelector<HTMLButtonElement>("#settings-close")!
    .addEventListener("click", () => {
      closeSettings();
    });

  const screensaverError =
    panel.querySelector<HTMLElement>("#screensaver-error")!;
  panel
    .querySelector<HTMLInputElement>("#screensaver-toggle")!
    .addEventListener("change", (e) => {
      void (async () => {
        const checkbox = e.target as HTMLInputElement;
        const checked = checkbox.checked;
        screensaverError.hidden = true;
        try {
          await preferencesApi.setScreensaverEnabled(checked);
        } catch (err) {
          checkbox.checked = !checked;
          screensaverError.textContent = `Couldn't change screensaver setting: ${String(err)}`;
          screensaverError.hidden = false;
        }
      })();
    });

  const themeError = panel.querySelector<HTMLElement>("#theme-error")!;
  panel
    .querySelector<HTMLSelectElement>("#theme-select")!
    .addEventListener("change", (e) => {
      void (async () => {
        const select = e.target as HTMLSelectElement;
        const previous = preferences.theme;
        const next = select.value as ThemeSetting;
        themeError.hidden = true;
        applyTheme(next);
        try {
          await preferencesApi.setTheme(next);
          preferences.theme = next;
        } catch (err) {
          select.value = previous;
          applyTheme(previous);
          themeError.textContent = `Couldn't change theme setting: ${String(err)}`;
          themeError.hidden = false;
        }
      })();
    });

  const tmdbKeyInput =
    panel.querySelector<HTMLInputElement>("#tmdb-key-input")!;
  const tmdbKeyError = panel.querySelector<HTMLElement>("#tmdb-key-error")!;
  const tmdbKeyStatus = panel.querySelector<HTMLElement>("#tmdb-key-status")!;

  let tmdbKeyStatusTimeout: ReturnType<typeof setTimeout> | undefined;
  function showTmdbKeyStatus(text: string): void {
    tmdbKeyStatus.textContent = text;
    tmdbKeyStatus.hidden = false;
    clearTimeout(tmdbKeyStatusTimeout);
    tmdbKeyStatusTimeout = setTimeout(() => {
      tmdbKeyStatus.hidden = true;
    }, 2000);
  }

  tmdbKeyInput.addEventListener("change", (e) => {
    void (async () => {
      const input = e.target as HTMLInputElement;
      const apiKey = input.value.trim();
      // Blanking the field is a no-op, not a clear — a stray focus/blur
      // can't silently wipe a saved key.
      if (!apiKey) return;
      tmdbKeyError.hidden = true;
      try {
        await preferencesApi.setTmdbApiKey(apiKey);
        void refreshTrendingCatalog(() => {});
        // Never keep displaying the saved key in the field, plaintext or
        // otherwise — clear it back to a placeholder once it's persisted.
        input.value = "";
        input.placeholder = "API key saved — enter a new key to replace it";
        showTmdbKeyStatus("Saved");
      } catch (err) {
        tmdbKeyError.textContent = `Couldn't save TMDB API key: ${String(err)}`;
        tmdbKeyError.hidden = false;
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
          await tilesApi.remove(btn.dataset.id!);
          await renderSettings();
        })();
      });
    });

  const form = panel.querySelector<HTMLFormElement>("#tile-form")!;
  const errorEl = panel.querySelector<HTMLElement>("#tile-form-error")!;

  const nameInput = panel.querySelector<HTMLInputElement>("input[name=name]")!;
  const jellyfinFieldWrap = panel.querySelector<HTMLElement>(
    "#jellyfin-field-wrap",
  )!;
  nameInput.addEventListener("input", () => {
    jellyfinFieldWrap.hidden = !isJellyfinName(nameInput.value);
  });

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
      const jellyfinApiKey = readJellyfinApiKey(form);
      try {
        let saved = editing
          ? await tilesApi.update(editing.id, input)
          : await tilesApi.create(input);
        // Decoupled from create/update: the tile-CRUD calls never see the
        // raw key, so a non-blank field gets its own save call once the
        // tile (and its id, for a new tile) exists.
        if (jellyfinApiKey) {
          await tilesApi.setJellyfinKey(saved.id, jellyfinApiKey);
          saved = { ...saved, jellyfin_api_key_set: true };
        }
        // Re-fetch the just-saved tile's banner immediately rather than
        // waiting for the next reload, so adding/editing a Jellyfin key
        // takes effect right away.
        void refreshJellyfinBanner(saved, () => {});
        await renderSettings();
      } catch (err) {
        errorEl.textContent = String(err);
        errorEl.hidden = false;
      }
    })();
  });

  panel
    .querySelector<HTMLInputElement>("input[name=name]")
    ?.focus({ preventScroll: true });
}

export function openSettings(): void {
  grid.hidden = true;
  panel.hidden = false;
  hideTileBanner();
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
