#!/usr/bin/env bash
# Runs the Tauri dev server in the foreground and tees its output to
# conduit-dev.log (repo root, gitignored) so it can be tailed from another
# terminal while the app is running.
set -euo pipefail
cd "$(dirname "$0")/.."
# Ad-hoc sign (matches release.yml) so local builds don't fall back to a real
# Developer ID cert in the login keychain, which would prompt for the
# keychain password on every single build.
#
# Trade-off: an ad-hoc signature hashes the binary, so every rebuild gets a
# new identity and macOS re-prompts for Keychain access to stored secrets
# (TMDB/Jellyfin keys, src-tauri/src/secrets.rs) every time too. Set
# APPLE_SIGNING_IDENTITY in your own shell profile to a stable local
# self-signed cert to stop that — see CONTRIBUTING.md's "Avoiding repeated
# Keychain prompts" section.
# Harmless on Windows (Git Bash), where nothing reads it.
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
pnpm tauri dev 2>&1 | tee conduit-dev.log
