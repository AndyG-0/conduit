import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

function makeTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "conduit-app-test-"));
}

describe("createApp", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = makeTempDataDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports needsSetup before a passphrase is set", async () => {
    const app = createApp(dataDir);
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, needsSetup: true });
  });

  it("rejects unauthenticated access to protected routes", async () => {
    const app = createApp(dataDir);
    const res = await request(app).get("/api/tiles");
    expect(res.status).toBe(401);
  });

  it("setup sets a session cookie usable for protected routes", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);

    const setup = await agent
      .post("/api/auth/setup")
      .send({ passphrase: "correct horse battery staple" });
    expect(setup.status).toBe(200);
    expect(setup.body.authenticated).toBe(true);

    const tiles = await agent.get("/api/tiles");
    expect(tiles.status).toBe(200);
    expect(tiles.body.length).toBeGreaterThan(0);
  });

  it("rejects setup a second time once a passphrase exists", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "first passphrase" });
    const second = await agent
      .post("/api/auth/setup")
      .send({ passphrase: "second passphrase" });
    expect(second.status).toBe(409);
  });

  it("logs in with the correct passphrase and rejects the wrong one", async () => {
    const app = createApp(dataDir);
    await request(app)
      .post("/api/auth/setup")
      .send({ passphrase: "correct horse battery staple" });

    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ passphrase: "wrong passphrase" });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .post("/api/auth/login")
      .send({ passphrase: "correct horse battery staple" });
    expect(right.status).toBe(200);
    expect(right.body.authenticated).toBe(true);
  });

  it("logout clears the session so protected routes 401 again", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });
    expect((await agent.get("/api/tiles")).status).toBe(200);

    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/tiles")).status).toBe(401);
  });

  it("supports full tile CRUD once authenticated", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const created = await agent
      .post("/api/tiles")
      .send({ name: "My Custom App", base_url: "https://example.com/", icon_slug: null });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("my-custom-app");
    expect(created.body.jellyfin_api_key_set).toBe(false);

    const updated = await agent
      .put(`/api/tiles/${created.body.id}`)
      .send({ name: "Renamed App", base_url: "https://example.com/", icon_slug: null });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Renamed App");

    const withKey = await agent
      .put(`/api/tiles/${created.body.id}/jellyfin-key`)
      .send({ apiKey: "secret-key" });
    expect(withKey.status).toBe(204);

    const list = await agent.get("/api/tiles");
    const tile = list.body.find((t: { id: string }) => t.id === created.body.id);
    expect(tile.jellyfin_api_key_set).toBe(true);

    const removed = await agent.delete(`/api/tiles/${created.body.id}`);
    expect(removed.status).toBe(204);
  });

  it("updates preferences once authenticated", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const theme = await agent.put("/api/preferences/theme").send({ theme: "dark" });
    expect(theme.status).toBe(200);
    expect(theme.body.theme).toBe("dark");

    const badTheme = await agent.put("/api/preferences/theme").send({ theme: "not-a-theme" });
    expect(badTheme.status).toBe(400);

    const tmdb = await agent.put("/api/preferences/tmdb-key").send({ apiKey: "abc123" });
    expect(tmdb.status).toBe(200);
    expect(tmdb.body.tmdb_api_key_set).toBe(true);
  });

  it("returns 404 from the favicon proxy for an unknown tile", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const res = await agent.get("/api/proxy/favicon?tileId=does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns an empty trending catalog when no TMDB key is set", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const res = await agent.get("/api/proxy/trending");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it("returns 404 from the jellyfin proxy for an unknown tile", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const res = await agent.get("/api/proxy/jellyfin/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns null from the jellyfin proxy for a tile with no key set", async () => {
    const app = createApp(dataDir);
    const agent = request.agent(app);
    await agent.post("/api/auth/setup").send({ passphrase: "correct horse battery staple" });

    const tiles = await agent.get("/api/tiles");
    const tileId = tiles.body[0].id;

    const res = await agent.get(`/api/proxy/jellyfin/${tileId}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("rejects unauthenticated access to the proxy routes", async () => {
    const app = createApp(dataDir);
    const res = await request(app).get("/api/proxy/trending");
    expect(res.status).toBe(401);
  });
});
