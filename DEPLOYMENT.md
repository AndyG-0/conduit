# Deploying the Conduit PWA

This covers the self-hosted browser/server variant of Conduit (`server/`,
`web/`, `shared/`) — a small Node backend fronted by Caddy for locally-trusted
HTTPS, meant to run on a home LAN (a NAS, a homelab box, a spare machine).
This is separate from the native macOS/Windows app in `src/`/`src-tauri/`,
which doesn't need any of this.

## Why HTTPS is required at all

A PWA only installs ("Add to Home Screen") from a secure context: the
manifest and service worker simply won't register over plain HTTP (except on
`localhost`, which isn't useful once you're on a LAN with actual streaming
sites in other tabs). There's no public domain here to get a real certificate
for, so Caddy's `tls internal` mode is used instead — it mints certificates
from its own local CA. That CA has to be trusted once per client device
before installation works; see below.

## First-time setup

1. **Pick a hostname.** Anything that resolves on your LAN works — an
   `/etc/hosts` entry, a router-level DNS override, or an mDNS name
   (`conduit.local` if your router/devices support `.local` resolution).
   Edit `Caddyfile` and replace `conduit.local` with it.
2. **(Optional) Pick non-default ports.** If 80/443 are already taken by
   another service on this machine, copy `.env.example` to `.env` and set
   `HTTP_PORT`/`HTTPS_PORT` there.
3. **Bring up the stack:**
   ```sh
   docker compose up -d
   ```
   This pulls the published server image (`ghcr.io/andyg-0/conduit`, built
   from `shared/`, `web/`, and `server/` — see `Dockerfile`) and starts it
   alongside Caddy. To build from source instead (e.g. for local
   development, or before that image has been published), use
   `docker compose up -d --build`. Tile/session state persists in the
   `conduit-data` volume; Caddy's certificates persist in
   `caddy-data`/`caddy-config` — none of that is lost across a
   `docker compose down`/`up` cycle (only `-v` clears it).
4. **Trust Caddy's local CA on each client device that will use Conduit.**
   Caddy writes its root certificate to the `caddy-data` volume the first
   time it runs. Copy it out and install it as a trusted root:
   ```sh
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./conduit-ca.crt
   ```
   Then trust `conduit-ca.crt`:
   - **macOS**: open it in Keychain Access, add to the *System* keychain, and
     set it to "Always Trust".
   - **iOS**: AirDrop or email it to the device, install the profile in
     Settings, then separately enable full trust under
     *Settings → General → About → Certificate Trust Settings*.
   - **Android**: Settings → Security → Encryption & credentials → Install a
     certificate → CA certificate.
   - **Windows**: double-click → Install Certificate → Local Machine →
     Trusted Root Certification Authorities.

   This is the one manual step per device — after it's done, `https://` to
   your chosen hostname will show as secure, and the browser will offer to
   install the PWA.
5. **Open `https://<your-hostname>/` and set a passphrase.** The first visit
   shows a setup screen instead of a login screen — see
   `GET /api/auth/status`'s `needsSetup` flag. This passphrase gates the
   whole app (there are no per-user accounts); anyone on your LAN with it can
   use and edit the tile grid.
6. **Install it.** On mobile, "Add to Home Screen" from the browser's share
   sheet; on desktop Chrome/Edge, the install icon in the address bar. It
   launches fullscreen (or standalone, on platforms that don't support
   `display: "fullscreen"`).

## Updating

```sh
git pull
docker compose pull
docker compose up -d
```

(`docker compose pull` re-fetches the `:latest` image tag — plain `up -d`
won't do that if it's already present locally.) If you're building from
source instead, use `docker compose up -d --build` as before.

Tile/session/secrets data lives in the `conduit-data` volume, independent of
the image — rebuilding or pulling a new image doesn't touch it.

## Configuration

### Compose-level (host ports, image version)

Set these via a `.env` file next to `docker-compose.yml` (see
`.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `80` | Host port forwarded to Caddy's HTTP listener |
| `HTTPS_PORT` | `443` | Host port forwarded to Caddy's HTTPS listener (TCP and UDP/QUIC) |
| `CONDUIT_VERSION` | `latest` | Image tag to pull for the `server` service, e.g. `0.1.2` to pin a release |

Images are published to `ghcr.io/andyg-0/conduit` on each tagged release,
for `linux/amd64` and `linux/arm64`. The package needs to be set to public
in GitHub's package settings before `docker compose pull` will work
without authenticating to GHCR.

### Server process

Environment variables the server reads (set them via a `.env` file next to
`docker-compose.yml`, or directly in that file):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Port the Node server listens on inside its container |
| `DATA_DIR` | `/data` | Where `registry.json`/`secrets.json` are stored |
| `WEB_DIST_DIR` | `/app/web-dist` | Where the built frontend is served from |

None of these normally need changing in the Docker deployment — they're
already set correctly in `Dockerfile`/`docker-compose.yml`. They matter more
for running the server directly on a host without Docker.

## Threat model, briefly

This is built for a trusted home LAN, not a multi-tenant or internet-facing
deployment:

- One shared passphrase, not per-user accounts.
- `secrets.json` (passphrase hash, session-signing key, TMDB/Jellyfin API
  keys) is **not encrypted at rest** — anyone with filesystem access to the
  `conduit-data` volume can read it, same posture as `registry.json` already
  had. Protect the host, not just the app.
- Don't expose this stack's Caddy ports directly to the public internet
  without understanding what that changes about the threat model above.
