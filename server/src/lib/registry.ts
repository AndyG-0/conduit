import fs from "node:fs";
import path from "node:path";
import type { AppTile, AppTileInput, AppTileView } from "@conduit/shared";
import { slugify } from "@conduit/shared";
import type { SecretsFile } from "./secrets.js";

/// ESPN's streaming landing page — the bare `www.espn.com` home page is the
/// sports-news site, not the watch experience a TV launcher tile should open.
const ESPN_BASE_URL = "https://espn.com/watch/";

/**
 * The curated set of streaming services shipped by default. Ported from
 * `default_seed()` in `src-tauri/src/app_config.rs` — same ids/names/URLs/
 * icons, minus `allowed_domains` (dropped from the schema entirely; see
 * `shared/src/types.ts`).
 */
export function defaultSeed(): AppTile[] {
  const tile = (
    id: string,
    name: string,
    base_url: string,
    icon_slug: string,
  ): AppTile => ({ id, name, base_url, icon_slug });

  return [
    tile("netflix", "Netflix", "https://www.netflix.com/", "netflix"),
    tile("hulu", "Hulu", "https://www.hulu.com/", "hulu"),
    tile("disneyplus", "Disney+", "https://www.disneyplus.com/", "disneyplus"),
    tile(
      "paramountplus",
      "Paramount+",
      "https://www.paramountplus.com/",
      "paramountplus",
    ),
    tile("peacock", "Peacock", "https://www.peacocktv.com/", "peacock"),
    tile("tubi", "Tubi", "https://tubitv.com/", "tubi"),
    tile("espn", "ESPN", ESPN_BASE_URL, "espn"),
    tile("youtubetv", "YouTube TV", "https://tv.youtube.com/", "youtubetv"),
    tile("slingtv", "Sling TV", "https://www.sling.com/", "slingtv"),
    tile("hbomax", "HBO Max", "https://www.hbomax.com/", "hbomax"),
    tile(
      "primevideo",
      "Prime Video",
      "https://www.primevideo.com/",
      "amazonprimevideo",
    ),
    tile("appletv", "Apple TV+", "https://tv.apple.com/", "appletv"),
  ];
}

/**
 * Seeded base URLs that were later corrected in `defaultSeed`, as
 * `[tile id, old base_url]`. `registry.json` persists the seed on first run,
 * so a corrected default never reaches an existing install on its own;
 * `migrateSeedUrls` rewrites a tile still on its old default to the current
 * one. Only an exact match is rewritten — a URL the user edited themselves
 * is left alone. Ported from `CORRECTED_SEED_URLS` in
 * `src-tauri/src/app_config.rs`.
 */
const CORRECTED_SEED_URLS: [id: string, oldUrl: string][] = [
  ["espn", "https://www.espn.com/"],
];

/**
 * Applies `CORRECTED_SEED_URLS` in place. Returns `true` if any tile
 * changed (i.e. `registry.json` needs re-saving). Ported from
 * `migrate_seed_urls` in `src-tauri/src/app_config.rs`.
 */
export function migrateSeedUrls(tiles: AppTile[]): boolean {
  const seed = defaultSeed();
  let changed = false;
  for (const tile of tiles) {
    const corrected = CORRECTED_SEED_URLS.some(
      ([id, oldUrl]) => tile.id === id && tile.base_url === oldUrl,
    );
    if (!corrected) continue;
    const current = seed.find((t) => t.id === tile.id);
    if (current) {
      tile.base_url = current.base_url;
      changed = true;
    }
  }
  return changed;
}

function validateInput(input: AppTileInput): void {
  if (!input.name.trim()) {
    throw new Error("name must not be empty");
  }
  if (!input.base_url.trim()) {
    throw new Error("base_url must not be empty");
  }
  try {
    new URL(input.base_url);
  } catch {
    throw new Error("base_url is not a valid URL");
  }
}

function registryPath(dataDir: string): string {
  return path.join(dataDir, "registry.json");
}

/**
 * The user-editable "channel lineup". Persisted as JSON in `DATA_DIR`,
 * seeded with `defaultSeed()` on first run. TS port of `Registry` in
 * `src-tauri/src/app_config.rs` — same load/save/CRUD/reorder semantics.
 */
export class Registry {
  private tiles: AppTile[];
  private readonly dataDir: string;
  private readonly secrets: SecretsFile;

  private constructor(dataDir: string, secrets: SecretsFile, tiles: AppTile[]) {
    this.dataDir = dataDir;
    this.secrets = secrets;
    this.tiles = tiles;
  }

  static load(dataDir: string, secrets: SecretsFile): Registry {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = registryPath(dataDir);
    try {
      const contents = fs.readFileSync(filePath, "utf8");
      const tiles = JSON.parse(contents) as AppTile[];
      const registry = new Registry(dataDir, secrets, tiles);
      if (migrateSeedUrls(tiles)) {
        registry.save();
      }
      return registry;
    } catch {
      const seed = defaultSeed();
      const registry = new Registry(dataDir, secrets, seed);
      registry.save();
      return registry;
    }
  }

  private save(): void {
    fs.writeFileSync(
      registryPath(this.dataDir),
      JSON.stringify(this.tiles, null, 2),
    );
  }

  private view(tile: AppTile): AppTileView {
    return {
      ...tile,
      jellyfin_api_key_set: Object.prototype.hasOwnProperty.call(
        this.secrets.jellyfin,
        tile.id,
      ),
    };
  }

  list(): AppTileView[] {
    return this.tiles.map((t) => this.view(t));
  }

  get(id: string): AppTile | undefined {
    return this.tiles.find((t) => t.id === id);
  }

  private uniqueIdFrom(name: string): string {
    const base = slugify(name) || "app";
    if (!this.tiles.some((t) => t.id === base)) return base;
    let n = 2;
    for (;;) {
      const candidate = `${base}-${n}`;
      if (!this.tiles.some((t) => t.id === candidate)) return candidate;
      n += 1;
    }
  }

  add(input: AppTileInput): AppTileView {
    validateInput(input);
    const id = this.uniqueIdFrom(input.name);
    const tile: AppTile = {
      id,
      name: input.name,
      base_url: input.base_url,
      icon_slug: input.icon_slug,
    };
    this.tiles.push(tile);
    this.save();
    return this.view(tile);
  }

  update(id: string, input: AppTileInput): AppTileView {
    validateInput(input);
    const existing = this.tiles.find((t) => t.id === id);
    if (!existing) throw new Error(`no tile with id ${id}`);
    existing.name = input.name;
    existing.base_url = input.base_url;
    existing.icon_slug = input.icon_slug;
    this.save();
    return this.view(existing);
  }

  remove(id: string): void {
    const lenBefore = this.tiles.length;
    this.tiles = this.tiles.filter((t) => t.id !== id);
    if (this.tiles.length === lenBefore) {
      throw new Error(`no tile with id ${id}`);
    }
    this.save();
  }

  /** Rebuilds tile order to match `ids`, which must be a permutation of the
   * existing tile ids exactly — same length *and* same set, which together
   * rule out a missing id, an unknown id, and a duplicate id in one check. */
  reorder(ids: string[]): void {
    if (ids.length !== this.tiles.length) {
      throw new Error("ids must match the current set of tiles exactly");
    }
    const existing = new Set(this.tiles.map((t) => t.id));
    const given = new Set(ids);
    if (given.size !== ids.length || given.size !== existing.size) {
      throw new Error("ids must match the current set of tiles exactly");
    }
    for (const id of given) {
      if (!existing.has(id)) {
        throw new Error("ids must match the current set of tiles exactly");
      }
    }
    this.tiles = ids.map((id) => this.tiles.find((t) => t.id === id)!);
    this.save();
  }
}
