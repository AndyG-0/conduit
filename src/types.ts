export interface AppTile {
  id: string;
  name: string;
  base_url: string;
  allowed_domains: string[];
  icon_slug: string | null;
}

export interface AppTileInput {
  name: string;
  base_url: string;
  allowed_domains: string[];
  icon_slug: string | null;
}
