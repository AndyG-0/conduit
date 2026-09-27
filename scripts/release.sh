#!/usr/bin/env bash
# Cuts a release: bumps the version everywhere, updates CHANGELOG.md,
# commits, tags, and pushes. Pushing the tag triggers
# .github/workflows/release.yml, which builds and publishes the GitHub
# Release, so this script confirms twice: once before committing/tagging
# (still local, reversible), and again right before the push.
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP_KIND="${1:-}"
AUTO_YES=false
for a in "$@"; do
  if [[ "$a" == "-y" || "$a" == "--yes" ]]; then
    AUTO_YES=true
  fi
done

case "$BUMP_KIND" in
  patch|minor|major) ;;
  *)
    echo "Usage: scripts/release.sh <patch|minor|major> [-y|--yes]" >&2
    exit 1
    ;;
esac

confirm() {
  if $AUTO_YES; then
    return 0
  fi
  read -r -p "$1 [type 'yes' to continue] " reply
  [[ "$reply" == "yes" ]]
}

# --- Pre-flight ---
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != "main" ]]; then
  echo "Must be on main (currently: $branch)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree not clean; commit or stash first." >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "No 'origin' remote configured." >&2
  exit 1
fi

git fetch origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "Local main has diverged from origin/main; pull/rebase first." >&2
  exit 1
fi

# --- Full local CI check suite ---
echo "Running full CI check suite..."
pnpm install --frozen-lockfile
./scripts/ci.sh

# --- Version bump ---
current_version=$(node scripts/version.mjs get)
new_version=$(node scripts/version.mjs bump "$BUMP_KIND")
echo "Version: $current_version -> $new_version"

# --- Changelog ---
node scripts/changelog.mjs release "$new_version"

# Cargo.lock has its own `version` entry for this crate that mirrors
# Cargo.toml's — `cargo check` is what actually rewrites it to match after
# the bump above; skipping this would commit a release with a stale
# Cargo.lock version field.
cargo check --manifest-path src-tauri/Cargo.toml

# --- Gate 1: review before commit/tag (local, reversible) ---
echo "----- Changes for release v$new_version -----"
git diff --stat -- package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git diff -- CHANGELOG.md
if ! confirm "Commit and tag v$new_version locally?"; then
  echo "Aborted. Working tree left dirty for review (git checkout -- <file> to discard)."
  exit 1
fi

git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "Release v$new_version"
git tag -a "v$new_version" -m "v$new_version"

# --- Gate 2: the actually-hard-to-reverse step ---
echo "About to push 'main' and tag 'v$new_version' to origin."
echo "This triggers .github/workflows/release.yml (builds + publishes a GitHub Release)."
if ! confirm "Push to origin now?"; then
  echo "Commit and tag created locally but NOT pushed."
  echo "To undo: git tag -d v$new_version && git reset --hard HEAD~1"
  exit 1
fi

git push origin main
git push origin "v$new_version"
echo "Released v$new_version."
