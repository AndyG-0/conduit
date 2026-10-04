import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Without this, Vitest's default include glob also picks up
  // server/test/**, shared/src/**, and web/src/** — those workspaces have
  // their own tsconfig/module resolution and their own `pnpm test`, and
  // only pass here by accident (e.g. depending on @conduit/shared already
  // being built). Scope this project's own `pnpm test` to its own tests.
  test: {
    include: ["src/**/*.{test,spec}.ts"],
  },
}));
