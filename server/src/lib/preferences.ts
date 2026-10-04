import fs from "node:fs";
import path from "node:path";
import type { Preferences, ThemeSetting } from "@conduit/shared";
import type { SecretsFile } from "./secrets.js";

const TMDB_API_KEY_ACCOUNT = "tmdb_api_key";

interface StoredPreferences {
  screensaver_enabled: boolean;
  theme: ThemeSetting;
}

function defaultPreferences(): StoredPreferences {
  return { screensaver_enabled: false, theme: "system" };
}

function preferencesPath(dataDir: string): string {
  return path.join(dataDir, "preferences.json");
}

/** App-wide, non-secret user preferences. TS port of `Preferences` in
 * `src-tauri/src/preferences.rs`. */
export class PreferencesStore {
  private prefs: StoredPreferences;
  private readonly dataDir: string;
  private readonly secrets: SecretsFile;

  private constructor(
    dataDir: string,
    secrets: SecretsFile,
    prefs: StoredPreferences,
  ) {
    this.dataDir = dataDir;
    this.secrets = secrets;
    this.prefs = prefs;
  }

  static load(dataDir: string, secrets: SecretsFile): PreferencesStore {
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const contents = fs.readFileSync(preferencesPath(dataDir), "utf8");
      const parsed = JSON.parse(contents) as Partial<StoredPreferences>;
      return new PreferencesStore(dataDir, secrets, {
        screensaver_enabled: parsed.screensaver_enabled ?? false,
        theme: parsed.theme ?? "system",
      });
    } catch {
      return new PreferencesStore(dataDir, secrets, defaultPreferences());
    }
  }

  private save(): void {
    fs.writeFileSync(
      preferencesPath(this.dataDir),
      JSON.stringify(this.prefs, null, 2),
    );
  }

  view(): Preferences {
    return {
      ...this.prefs,
      tmdb_api_key_set: Boolean(this.secrets.tmdbApiKey),
    };
  }

  setScreensaverEnabled(enabled: boolean): Preferences {
    this.prefs.screensaver_enabled = enabled;
    this.save();
    return this.view();
  }

  setTheme(theme: ThemeSetting): Preferences {
    this.prefs.theme = theme;
    this.save();
    return this.view();
  }
}

export { TMDB_API_KEY_ACCOUNT };
