#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml's `pwa` job — the self-hosted
# server/browser-frontend stack (shared/, server/, web/), independent of
# the native Tauri app and its scripts/ci.sh. Assumes `pnpm install` is
# already done (pass --with-install to run `pnpm install --frozen-lockfile`
# first).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

if [[ "${1:-}" == "--with-install" ]]; then
  step "Install dependencies"
  pnpm install --frozen-lockfile
fi

step "Check formatting (pnpm format:check)"
pnpm format:check

step "Lint (pnpm lint)"
pnpm lint

step "Build shared package (@conduit/shared)"
pnpm --filter @conduit/shared build

step "Typecheck shared"
pnpm --filter @conduit/shared typecheck

step "Typecheck server"
pnpm --filter @conduit/server typecheck

step "Typecheck web"
pnpm --filter @conduit/web typecheck

step "Shared unit tests"
pnpm --filter @conduit/shared test

step "Server unit tests"
pnpm --filter @conduit/server test

step "Web unit tests"
pnpm --filter @conduit/web test

step "Build server"
pnpm --filter @conduit/server build

step "Build web"
pnpm --filter @conduit/web build

printf '\n\033[1;32m✓ All PWA checks passed.\033[0m\n'
