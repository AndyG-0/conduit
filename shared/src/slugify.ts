/**
 * Lowercases and replaces anything that isn't `[a-z0-9-]` with `-`,
 * collapsing repeats and trimming leading/trailing `-`. Used to derive a
 * stable tile `id` from a user-supplied display name.
 *
 * Ported from `slugify` in `src-tauri/src/app_config.rs` — same behavior,
 * used by both the server (id generation) and the Settings UI (live id
 * preview).
 */
export function slugify(name: string): string {
  let slug = "";
  let lastWasDash = false;
  for (const ch of name.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      slug += ch;
      lastWasDash = false;
    } else if (!lastWasDash) {
      slug += "-";
      lastWasDash = true;
    }
  }
  return slug.replace(/^-+|-+$/g, "");
}
