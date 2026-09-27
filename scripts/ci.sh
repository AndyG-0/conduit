#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml's check steps. Assumes `pnpm
# install` and a stable Rust toolchain are already set up (pass
# --with-install to run `pnpm install --frozen-lockfile` first).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }

if [[ "${1:-}" == "--with-install" ]]; then
  step "Install frontend dependencies"
  pnpm install --frozen-lockfile
fi

step "Check formatting (pnpm format:check)"
pnpm format:check

step "Lint (pnpm lint)"
pnpm lint

step "Typecheck (pnpm typecheck)"
pnpm typecheck

step "Build frontend (pnpm build)"
pnpm build

step "Frontend unit tests (pnpm test)"
pnpm test

step "Check Rust formatting"
cargo fmt --manifest-path src-tauri/Cargo.toml --check

step "Clippy (-D warnings)"
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

step "Cargo check"
cargo check --manifest-path src-tauri/Cargo.toml

step "Rust unit tests"
cargo test --manifest-path src-tauri/Cargo.toml

printf '\n\033[1;32m✓ All CI checks passed.\033[0m\n'
