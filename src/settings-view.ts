import { invoke } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  attachFaviconFallback,
  isFixedCanvasIcon,
  renderTileIcon,
  KNOWN_ICON_SLUGS,
} from "./icons";
import { renderGrid, focusGrid, hideTileBanner } from "./main";
import { applyTheme, escapeHtml } from "@conduit/shared";
import { primaryModifierLabel } from "./platform";
import { refreshTrendingCatalog } from "./trending";
import { refreshJellyfinBanner } from "./jellyfin";
import type { AppTile, AppTileInput, Preferences, ThemeSetting } from "./types";

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
    allowed_domains: String(data.get("allowed_domains") ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    icon_slug: iconSlug || null,
  };
}

/** Blank means "leave unchanged" (the field never redisplays a saved key,
 * so there's nothing to distinguish from a deliberate clear) — same
 * convention as the global TMDB key field. Saved via its own
 * `set_jellyfin_api_key` call, decoupled from `readForm`/`create_app`/
 * `update_app`, since the key never lives on the `AppTileInput` the
 * tile-CRUD commands accept. */
function readJellyfinApiKey(form: HTMLFormElement): string {
  const data = new FormData(form);
  return String(data.get("jellyfin_api_key") ?? "").trim();
}

function tileRow(tile: AppTile): string {
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

function blockedDomainsMarkup(
  tile: AppTile | undefined,
  blocked: string[],
): string {
  if (!tile || blocked.length === 0) return "";
  return `
    <div class="tile-form-blocked">
      <p>
        Blocked while using this tile — not in its allowed domains. A site's
        login or anti-fraud check can use domains we can't predict in
        advance; allow one here if it looks legitimate.
      </p>
      <ul class="tile-form-blocked-list">
        ${blocked
          .map(
            (domain) => `
              <li>
                <span>${escapeHtml(domain)}</span>
                <button type="button" class="blocked-allow" data-domain="${escapeHtml(domain)}">Allow</button>
                <button type="button" class="blocked-dismiss" data-domain="${escapeHtml(domain)}">Dismiss</button>
              </li>
            `,
          )
          .join("")}
      </ul>
    </div>
  `;
}

function formMarkup(tile?: AppTile, blockedDomains: string[] = []): string {
  return `
    <form id="tile-form" class="tile-form">
      <h2>${tile ? `Edit ${escapeHtml(tile.name)}` : "Add a service"}</h2>
      <label>Name<input name="name" required value="${tile ? escapeHtml(tile.name) : ""}" /></label>
      <label>Base URL<input name="base_url" type="url" required value="${tile ? escapeHtml(tile.base_url) : ""}" /></label>
      <label>Additional allowed domains (optional, comma-separated)
        <input name="allowed_domains" value="${tile ? escapeHtml(tile.allowed_domains.join(", ")) : ""}" />
      </label>
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
      ${blockedDomainsMarkup(tile, blockedDomains)}
    </form>
  `;
}

async function renderSettings(editingId: string | null = null): Promise<void> {
  const [tiles, autostartEnabled, preferences, fullscreen] = await Promise.all([
    invoke<AppTile[]>("list_apps"),
    isAutostartEnabled(),
    invoke<Preferences>("get_preferences"),
    invoke<boolean>("is_fullscreen"),
  ]);
  const editing = editingId ? tiles.find((t) => t.id === editingId) : undefined;
  const blockedDomains = editing
    ? await invoke<string[]>("list_blocked_domains", { tileId: editing.id })
    : [];

  // Re-renders (after a save, remove, or allow) keep the user's place in
  // the list rather than jumping back to the top.
  const previousScrollTop = panel.scrollTop;
  panel.innerHTML = `
    <div class="settings-header">
      <h1>Settings</h1>
      <button type="button" id="settings-close">← Home</button>
    </div>
    <label class="settings-autostart">
      <input type="checkbox" id="autostart-toggle" ${autostartEnabled ? "checked" : ""} />
      Launch at login
    </label>
    <p class="settings-autostart-error" id="autostart-error" hidden></p>
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
    <div class="settings-fullscreen-row">
      <button type="button" id="fullscreen-toggle">${fullscreenLabel(fullscreen)}</button>
      <span class="settings-key-status">Shortcut: ${primaryModifierLabel()}+Enter</span>
    </div>
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
      <button
        type="button"
        id="tmdb-key-clear"
        ${preferences.tmdb_api_key_set ? "" : "hidden"}
      >Clear saved key</button>
      <span class="settings-key-status" id="tmdb-key-status" hidden></span>
    </div>
    <p class="settings-autostart-error" id="tmdb-key-error" hidden></p>
    <ul class="settings-list">${tiles.map(tileRow).join("")}</ul>
    ${formMarkup(editing, blockedDomains)}
  `;

  panel.querySelectorAll<HTMLLIElement>(".settings-row").forEach((row) => {
    const tile = tiles.find((t) => t.id === row.dataset.id);
    if (tile)
      attachFaviconFallback(row, tile.icon_slug, tile.name, tile.base_url);
  });

  panel
    .querySelector<HTMLButtonElement>("#settings-close")!
    .addEventListener("click", () => {
      closeSettings();
    });

  const fullscreenToggle =
    panel.querySelector<HTMLButtonElement>("#fullscreen-toggle")!;
  fullscreenToggle.addEventListener("click", () => {
    void invoke<boolean>("toggle_fullscreen").then((isFullscreen) => {
      fullscreenToggle.textContent = fullscreenLabel(isFullscreen);
    });
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
          await invoke("set_screensaver_enabled", { enabled: checked });
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
          await invoke("set_theme", { theme: next });
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
  const tmdbKeyClear =
    panel.querySelector<HTMLButtonElement>("#tmdb-key-clear")!;
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
      // Blanking the field is a no-op, not a clear — use "Clear saved key"
      // for that so a stray focus/blur can't silently wipe a saved key.
      if (!apiKey) return;
      tmdbKeyError.hidden = true;
      try {
        await invoke("set_tmdb_api_key", { apiKey });
        void refreshTrendingCatalog(() => {});
        // Never keep displaying the saved key in the field, plaintext or
        // otherwise — clear it back to a placeholder once it's persisted.
        input.value = "";
        input.placeholder = "API key saved — enter a new key to replace it";
        tmdbKeyClear.hidden = false;
        showTmdbKeyStatus("Saved");
      } catch (err) {
        tmdbKeyError.textContent = `Couldn't save TMDB API key: ${String(err)}`;
        tmdbKeyError.hidden = false;
      }
    })();
  });

  tmdbKeyClear.addEventListener("click", () => {
    void (async () => {
      tmdbKeyError.hidden = true;
      try {
        await invoke("set_tmdb_api_key", { apiKey: null });
        tmdbKeyInput.value = "";
        tmdbKeyInput.placeholder = "Optional — free key from themoviedb.org";
        tmdbKeyClear.hidden = true;
        showTmdbKeyStatus("Cleared");
      } catch (err) {
        tmdbKeyError.textContent = `Couldn't clear TMDB API key: ${String(err)}`;
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
          await invoke("delete_app", { id: btn.dataset.id! });
          await renderSettings();
        })();
      });
    });

  if (editing) {
    panel
      .querySelectorAll<HTMLButtonElement>(".blocked-allow")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            const domain = btn.dataset.domain!;
            const input: AppTileInput = {
              name: editing.name,
              base_url: editing.base_url,
              allowed_domains: [...editing.allowed_domains, domain],
              icon_slug: editing.icon_slug,
            };
            await invoke("update_app", { id: editing.id, input });
            await invoke("dismiss_blocked_domain", {
              tileId: editing.id,
              domain,
            });
            await renderSettings(editing.id);
          })();
        });
      });

    panel
      .querySelectorAll<HTMLButtonElement>(".blocked-dismiss")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          void (async () => {
            await invoke("dismiss_blocked_domain", {
              tileId: editing.id,
              domain: btn.dataset.domain!,
            });
            await renderSettings(editing.id);
          })();
        });
      });
  }

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
          ? await invoke<AppTile>("update_app", { id: editing.id, input })
          : await invoke<AppTile>("create_app", { input });
        // Decoupled from create_app/update_app: the tile-CRUD commands never
        // see the raw key, so a non-blank field gets its own save call once
        // the tile (and its id, for a new tile) exists.
        if (jellyfinApiKey) {
          await invoke("set_jellyfin_api_key", {
            tileId: saved.id,
            apiKey: jellyfinApiKey,
          });
          saved = { ...saved, jellyfin_api_key_set: true };
        }
        // Re-fetch the just-saved tile's banner immediately rather than
        // waiting for the next app restart, so adding/editing a Jellyfin
        // key takes effect right away.
        void refreshJellyfinBanner(saved, () => {});
        await renderSettings();
      } catch (err) {
        errorEl.textContent = String(err);
        errorEl.hidden = false;
      }
    })();
  });

  // Editing a tile jumps to its form (the whole point of clicking Edit);
  // otherwise start focus on Back, at the top. Focusing the form's Name
  // input unconditionally used to scroll the panel down to the form on
  // open, pushing Back and the preferences above it out of view whenever
  // the tile list is taller than the window.
  if (editing) {
    nameInput.focus();
  } else {
    panel.scrollTop = previousScrollTop;
    panel
      .querySelector<HTMLButtonElement>("#settings-close")!
      .focus({ preventScroll: true });
  }
}

function fullscreenLabel(isFullscreen: boolean): string {
  return isFullscreen ? "Exit full screen" : "Enter full screen";
}

export function openSettings(): void {
  grid.hidden = true;
  panel.hidden = false;
  panel.scrollTop = 0;
  hideTileBanner();
  void renderSettings();
}

export function closeSettings(): void {
  panel.hidden = true;
  grid.hidden = false;
  void renderGrid().then(focusGrid);
}

// Keeps the full-screen button's label right when fullscreen is toggled
// some other way (the shortcut or View menu) while Settings is open.
window.addEventListener("resize", () => {
  const toggle = panel.querySelector<HTMLButtonElement>("#fullscreen-toggle");
  if (panel.hidden || !toggle) return;
  void invoke<boolean>("is_fullscreen").then((isFullscreen) => {
    toggle.textContent = fullscreenLabel(isFullscreen);
  });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !panel.hidden) {
    e.preventDefault();
    closeSettings();
  }
});
