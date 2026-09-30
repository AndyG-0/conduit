fn main() {
    // tauri-build normally embeds its Windows app manifest (which opts into
    // Common Controls v6) as a resource on the app binary only. Test binaries
    // then link against comctl32 v5, which lacks `TaskDialogIndirect`, and die
    // at startup with STATUS_ENTRYPOINT_NOT_FOUND before a single test runs.
    // Embedding the same manifest (`windows-app-manifest.xml`, copied verbatim
    // from tauri-build) through the linker instead covers every target,
    // tests included; tauri-build's own copy is turned off so the app binary
    // doesn't end up with two.
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
