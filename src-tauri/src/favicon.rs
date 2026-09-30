use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use tauri::command;
use url::Url;

const FAVICON_FETCH_TIMEOUT: Duration = Duration::from_secs(3);

fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(FAVICON_FETCH_TIMEOUT)
        .build()
        .ok()
}

async fn fetch_as_data_url(client: &reqwest::Client, url: Url) -> Option<String> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/x-icon")
        .to_string();
    // SPA servers often answer an unknown path with their index.html and a
    // 200, which would render as a broken `<img>` instead of falling back.
    if content_type.to_ascii_lowercase().starts_with("text/html") {
        return None;
    }

    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(&bytes)
    ))
}

/// Finds the best `<link rel="...icon...">` href in an HTML document. Prefers
/// a plain `icon`/`shortcut icon` over `apple-touch-icon` (usually a large
/// app-icon PNG meant for a home-screen bookmark, fine as a last resort but
/// not the first choice for a small tile badge) — many self-hosted apps (e.g.
/// Jellyfin) only declare their favicon this way, at a hashed/cache-busted
/// filename that isn't at a predictable path like `/favicon.ico`.
fn find_icon_href(html: &str) -> Option<String> {
    // Double- and single-quoted variants are matched separately, each only
    // excluding its own quote character: a `data:` URI href can itself
    // contain the *other* quote character (e.g. an inlined SVG's
    // `xmlns='...'`), and a single `[^"']` class would truncate the capture
    // at that inner quote.
    let link_re = Regex::new(r#"(?is)<link\s+[^>]*>"#).ok()?;
    let rel_dq = Regex::new(r#"(?is)\brel\s*=\s*"([^"]*)""#).ok()?;
    let rel_sq = Regex::new(r#"(?is)\brel\s*=\s*'([^']*)'"#).ok()?;
    let href_dq = Regex::new(r#"(?is)\bhref\s*=\s*"([^"]*)""#).ok()?;
    let href_sq = Regex::new(r#"(?is)\bhref\s*=\s*'([^']*)'"#).ok()?;
    let attr = |tag: &str, dq: &Regex, sq: &Regex| -> Option<String> {
        dq.captures(tag)
            .or_else(|| sq.captures(tag))
            .map(|c| c[1].to_string())
    };

    let mut apple_touch_fallback = None;
    for link_tag in link_re.find_iter(html) {
        let tag = link_tag.as_str();
        let Some(rel) = attr(tag, &rel_dq, &rel_sq).map(|r| r.to_lowercase()) else {
            continue;
        };
        if !rel.contains("icon") {
            continue;
        }
        let Some(href) = attr(tag, &href_dq, &href_sq) else {
            continue;
        };
        if rel.contains("apple-touch-icon") {
            apple_touch_fallback.get_or_insert(href);
            continue;
        }
        return Some(href);
    }
    apple_touch_fallback
}

/// Best-effort favicon fetch for tile icons, run from Rust rather than
/// through the webview's own `<img>` loading pipeline. `src/icons.ts` tries a
/// direct in-page `<img src>` first and only calls this command if that
/// fails — which it always will for a plain-HTTP local network device (e.g.
/// `http://192.168.50.50:8080/favicon.ico`): the packaged app's window is a
/// secure origin (Tauri's asset protocol), so that image load is mixed
/// content and gets silently blocked/upgraded by the webview itself, with no
/// way for page JS to tell that apart from a genuine 404. Fetching over a
/// plain outbound HTTP client sidesteps the webview's origin restrictions
/// entirely (same rationale as `screensaver::fetch_aerial_catalog`).
///
/// `/favicon.ico` at the site root is tried first (cheap, and correct for
/// most services), but plenty of self-hosted apps don't serve one there at
/// all — Jellyfin redirects to `/web/` and declares a hashed favicon filename
/// via `<link rel="shortcut icon">`; other dashboards inline a `data:` URI
/// icon directly in the tag. When the root guess fails, this falls back to
/// fetching the page itself and parsing its `<link rel="icon">` tags,
/// resolving a relative href against the page's *final* URL (post-redirect).
/// If `base_url`'s own page yields nothing, the site root's page is tried too.
///
/// Returns `None` on any failure (unparsable URL, unreachable host, timeout,
/// non-2xx, no icon link found) — callers should treat that as "no favicon
/// available", not surface an error.
#[command]
pub async fn fetch_favicon(base_url: String) -> Option<String> {
    let base = Url::parse(&base_url).ok()?;
    let client = build_client()?;

    if let Ok(direct) = base.join("/favicon.ico") {
        if let Some(data_url) = fetch_as_data_url(&client, direct).await {
            return Some(data_url);
        }
    }

    if let Some(icon) = icon_from_page(&client, base.clone()).await {
        return Some(icon);
    }
    // A tile's `base_url` can be a client-side route the server itself
    // 404s (Jellyfin's `/web/home`; the real route is `/web/#/home`). The
    // site root redirects to the app's actual entry page instead.
    let root = base.join("/").ok()?;
    if root == base {
        return None;
    }
    icon_from_page(&client, root).await
}

/// Fetches the HTML page at `url` and returns the icon its `<link rel="icon">`
/// tags point to, resolved against the page's final (post-redirect) URL.
async fn icon_from_page(client: &reqwest::Client, url: Url) -> Option<String> {
    let page = client.get(url).send().await.ok()?;
    if !page.status().is_success() {
        return None;
    }
    let page_url = page.url().clone();
    let html = page.text().await.ok()?;
    let href = find_icon_href(&html)?;

    if href.starts_with("data:") {
        return Some(href);
    }

    let icon_url = page_url.join(&href).ok()?;
    fetch_as_data_url(client, icon_url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_icon_href_prefers_shortcut_icon_over_apple_touch_icon() {
        // Jellyfin 10.x's `/web/` index.
        let html = r#"<link rel="apple-touch-icon" sizes="180x180" href="touchicon.f5bb.png">
<link rel="shortcut icon" href="favicon.bc8d.ico">"#;
        assert_eq!(find_icon_href(html).as_deref(), Some("favicon.bc8d.ico"));
    }

    #[test]
    fn find_icon_href_falls_back_to_apple_touch_icon() {
        let html = r#"<link rel="apple-touch-icon" href="/touch.png">"#;
        assert_eq!(find_icon_href(html).as_deref(), Some("/touch.png"));
    }

    #[test]
    fn find_icon_href_none_without_icon_links() {
        assert_eq!(find_icon_href(r#"<link rel="stylesheet" href="a.css">"#), None);
    }
}
