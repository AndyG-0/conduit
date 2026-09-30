#!/usr/bin/env bash
# Runs the PWA backend (server/) and frontend (web/) dev servers together for
# local testing — plain HTTP, no Docker/Caddy, no PWA installability (that
# needs real HTTPS; see DEPLOYMENT.md). Just fast iteration:
#   - server: http://localhost:8080 (tsx watch, restarts on save)
#   - web:    http://localhost:5173 (vite dev, proxies /api to the server)
# Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

# @conduit/shared's built dist/ is what server/ and web/ actually import at
# runtime (see shared/package.json) — rebuild it first so local edits to
# shared/src take effect without a separate manual step.
pnpm --filter @conduit/shared build

# Local-only run, not the Docker deployment — data lives in server/data
# (gitignored) unless overridden.
export DATA_DIR="${DATA_DIR:-$(pwd)/server/data}"

pnpm --filter @conduit/server dev &
SERVER_PID=$!

pnpm --filter @conduit/web dev &
WEB_PID=$!

trap 'kill "$SERVER_PID" "$WEB_PID" 2>/dev/null' EXIT INT TERM

wait
