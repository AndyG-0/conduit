# Builds and runs the Conduit PWA server: the Express backend (server/),
# serving the built frontend (web/) as static assets. The native Tauri app
# (src/, src-tauri/) has no part in this image.

FROM node:22-alpine AS build
# Pinned to match .github/workflows/ci.yml / release.yml, so a local build
# and CI resolve the same lockfile the same way.
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
# `shared`'s own `prepare` script (`tsc -p tsconfig.build.json`) runs during
# install, so its source must already be in place — no package.json-only
# layer-caching trick here.
RUN pnpm install --frozen-lockfile

RUN pnpm --filter @conduit/shared build
RUN pnpm --filter @conduit/web build
RUN pnpm --filter @conduit/server build

# `pnpm deploy` resolves each workspace:* dependency (here, @conduit/shared)
# down to its built output and writes a self-contained package + node_modules
# with no symlinks back into the monorepo — the runtime stage below needs
# nothing but this one directory plus the built web assets.
RUN pnpm --filter @conduit/server --prod deploy /app/deploy


FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV WEB_DIST_DIR=/app/web-dist

WORKDIR /app
COPY --from=build /app/deploy/ ./
COPY --from=build /app/web/dist/ /app/web-dist/

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "dist/index.js"]
