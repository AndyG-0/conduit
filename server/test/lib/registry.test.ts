import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Registry, defaultSeed } from "../../src/lib/registry.js";
import type { SecretsFile } from "../../src/lib/secrets.js";
import type { AppTileInput } from "@conduit/shared";

function emptySecrets(): SecretsFile {
  return { sessionSigningKey: "test", jellyfin: {} };
}

function input(name: string, base_url: string): AppTileInput {
  return { name, base_url, icon_slug: null };
}

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-registry-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Loads a registry with no seed data — mirrors the Rust tests' bare
 * `Registry { tiles: vec![] }` fixture, since `Registry.load` otherwise
 * always seeds a brand-new data dir with `defaultSeed()`. */
function loadEmpty(secrets: SecretsFile): Registry {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "registry.json"), "[]");
  return Registry.load(dataDir, secrets);
}

describe("defaultSeed", () => {
  it("has unique ids", () => {
    const ids = defaultSeed().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trips through JSON", () => {
    const seed = defaultSeed();
    const back = JSON.parse(JSON.stringify(seed));
    expect(back).toEqual(seed);
  });
});

describe("Registry", () => {
  it("seeds a fresh registry with defaultSeed and persists it", () => {
    const registry = Registry.load(dataDir, emptySecrets());
    expect(registry.list().length).toBe(defaultSeed().length);
    expect(
      fs.existsSync(path.join(dataDir, "registry.json")),
    ).toBe(true);
  });

  it("rejects empty required fields", () => {
    const registry = loadEmpty(emptySecrets());
    expect(() => registry.add(input("", "https://example.com/"))).toThrow();
    expect(() => registry.add(input("Name", ""))).toThrow();
    expect(() => registry.add(input("Name", "not a url"))).toThrow();
  });

  it("assigns a slugified unique id and persists", () => {
    const registry = loadEmpty(emptySecrets());
    const tile = registry.add(input("My Service", "https://example.com/"));
    expect(tile.id).toBe("my-service");

    const reloaded = Registry.load(dataDir, emptySecrets());
    expect(reloaded.get("my-service")?.name).toBe("My Service");
  });

  it("deduplicates slug collisions", () => {
    const registry = loadEmpty(emptySecrets());
    registry.add(input("Test", "https://example.com/"));
    const second = registry.add(input("Test", "https://example.com/"));
    expect(second.id).toBe("test-2");
  });

  it("rejects updating an unknown id", () => {
    const registry = loadEmpty(emptySecrets());
    expect(() =>
      registry.update("nonexistent", input("Name", "https://example.com/")),
    ).toThrow();
  });

  it("rejects removing an unknown id and removes a known one", () => {
    const registry = loadEmpty(emptySecrets());
    const tile = registry.add(input("My Service", "https://example.com/"));
    expect(() => registry.remove("nonexistent")).toThrow();
    expect(() => registry.remove(tile.id)).not.toThrow();
    expect(registry.get(tile.id)).toBeUndefined();
  });

  function seedThree(registry: Registry): string[] {
    return ["One", "Two", "Three"].map(
      (name) => registry.add(input(name, "https://example.com/")).id,
    );
  }

  it("persists a new order and round-trips through registry.json", () => {
    const registry = loadEmpty(emptySecrets());
    const ids = seedThree(registry);
    const permuted = [ids[2]!, ids[0]!, ids[1]!];

    registry.reorder(permuted);
    expect(registry.list().map((t) => t.id)).toEqual(permuted);

    const reloaded = Registry.load(dataDir, emptySecrets());
    expect(reloaded.list().map((t) => t.id)).toEqual(permuted);
  });

  it("rejects a reorder missing an id", () => {
    const registry = loadEmpty(emptySecrets());
    const ids = seedThree(registry);
    expect(() => registry.reorder([ids[0]!, ids[1]!])).toThrow();
  });

  it("rejects a reorder with an unknown id", () => {
    const registry = loadEmpty(emptySecrets());
    const ids = seedThree(registry);
    expect(() =>
      registry.reorder([ids[0]!, ids[1]!, "nonexistent"]),
    ).toThrow();
  });

  it("rejects a reorder with a duplicate id", () => {
    const registry = loadEmpty(emptySecrets());
    const ids = seedThree(registry);
    expect(() => registry.reorder([ids[0]!, ids[0]!, ids[1]!])).toThrow();
  });

  it("reflects jellyfin_api_key_set from the secrets file", () => {
    const secrets = emptySecrets();
    const registry = loadEmpty(secrets);
    const tile = registry.add(input("Jellyfin", "https://example.com/"));
    expect(registry.list().find((t) => t.id === tile.id)?.jellyfin_api_key_set).toBe(
      false,
    );
    secrets.jellyfin[tile.id] = "some-key";
    expect(registry.list().find((t) => t.id === tile.id)?.jellyfin_api_key_set).toBe(
      true,
    );
  });
});
