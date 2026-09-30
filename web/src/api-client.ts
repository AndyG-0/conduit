import type {
  AppTileInput,
  AppTileView,
  AuthStatus,
  Preferences,
  ThemeSetting,
} from "@conduit/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fired whenever any API call gets a 401 — main.ts listens for this to
 * drop back to the login screen without every call site needing to check
 * `err instanceof ApiError && err.status === 401` itself. */
export const UNAUTHENTICATED_EVENT = "conduit:unauthenticated";

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    throw new ApiError(401, "unauthenticated");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.error === "string") message = data.error;
    } catch {
      // Body wasn't JSON — fall back to statusText.
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const authApi = {
  status: () => request<AuthStatus>("GET", "/api/auth/status"),
  setup: (passphrase: string) =>
    request<AuthStatus>("POST", "/api/auth/setup", { passphrase }),
  login: (passphrase: string) =>
    request<AuthStatus>("POST", "/api/auth/login", { passphrase }),
  logout: () => request<void>("POST", "/api/auth/logout"),
};

export const tilesApi = {
  list: () => request<AppTileView[]>("GET", "/api/tiles"),
  create: (input: AppTileInput) =>
    request<AppTileView>("POST", "/api/tiles", input),
  update: (id: string, input: AppTileInput) =>
    request<AppTileView>("PUT", `/api/tiles/${encodeURIComponent(id)}`, input),
  remove: (id: string) =>
    request<void>("DELETE", `/api/tiles/${encodeURIComponent(id)}`),
  reorder: (ids: string[]) =>
    request<void>("POST", "/api/tiles/reorder", { ids }),
  setJellyfinKey: (id: string, apiKey: string) =>
    request<void>(
      "PUT",
      `/api/tiles/${encodeURIComponent(id)}/jellyfin-key`,
      { apiKey },
    ),
};

export const preferencesApi = {
  get: () => request<Preferences>("GET", "/api/preferences"),
  setScreensaverEnabled: (enabled: boolean) =>
    request<Preferences>("PUT", "/api/preferences/screensaver", { enabled }),
  setTheme: (theme: ThemeSetting) =>
    request<Preferences>("PUT", "/api/preferences/theme", { theme }),
  setTmdbApiKey: (apiKey: string) =>
    request<Preferences>("PUT", "/api/preferences/tmdb-key", { apiKey }),
};

export function faviconProxyUrl(tileId: string): string {
  return `/api/proxy/favicon?tileId=${encodeURIComponent(tileId)}`;
}
