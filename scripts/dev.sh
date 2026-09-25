#!/usr/bin/env bash
# Runs the Tauri dev server in the foreground and tees its output to
# conduit-dev.log (repo root, gitignored) so it can be tailed from another
# terminal while the app is running.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm tauri dev 2>&1 | tee conduit-dev.log
