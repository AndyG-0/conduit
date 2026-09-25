pub struct AppTile {
    pub id: &'static str,
    /// Unused until item 2 (settings app) renders tiles from this struct
    /// instead of the hardcoded grid markup.
    #[allow(dead_code)]
    pub name: &'static str,
    pub base_url: &'static str,
    pub allowed_domains: &'static [&'static str],
    pub partition: &'static str,
}

/// The single hardcoded tile for this prototype. Item 2 (settings app)
/// replaces this with a real, user-editable registry.
pub const NETFLIX: AppTile = AppTile {
    id: "netflix",
    name: "Netflix",
    base_url: "https://www.netflix.com/",
    allowed_domains: &["netflix.com"],
    partition: "netflix",
};
