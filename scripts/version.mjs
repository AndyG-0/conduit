#!/usr/bin/env node
// Keeps package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml
// version fields in lockstep. Uses anchored regex replacement rather than
// full TOML/JSON parsing so formatting/comments in each file are preserved.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.join(root, "package.json");
const CONF = path.join(root, "src-tauri/tauri.conf.json");
const CARGO = path.join(root, "src-tauri/Cargo.toml");

function readVersion() {
  return JSON.parse(readFileSync(PKG, "utf8")).version;
}

function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Unparseable version: ${version}`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

function replaceJsonVersion(file, v) {
  const re = /^(\s*"version":\s*")[^"]+(")/m;
  const text = readFileSync(file, "utf8");
  if (!re.test(text))
    throw new Error(`No top-level "version" field found in ${file}`);
  writeFileSync(file, text.replace(re, `$1${v}$2`));
}

function replaceCargoVersion(file, v) {
  const re = /(\[package\][^[]*?version\s*=\s*")[^"]+(")/s;
  const text = readFileSync(file, "utf8");
  if (!re.test(text))
    throw new Error(`No [package] version field found in ${file}`);
  writeFileSync(file, text.replace(re, `$1${v}$2`));
}

function setVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v))
    throw new Error(`Version must be X.Y.Z, got: ${v}`);
  replaceJsonVersion(PKG, v);
  replaceJsonVersion(CONF, v);
  replaceCargoVersion(CARGO, v);
}

const [, , cmd, arg] = process.argv;

if (cmd === "get") {
  console.log(readVersion());
} else if (cmd === "bump" && arg) {
  const next = bump(readVersion(), arg);
  setVersion(next);
  console.log(next);
} else if (cmd === "set" && arg) {
  setVersion(arg);
  console.log(arg);
} else {
  console.error(
    "Usage: version.mjs <get | bump <patch|minor|major> | set X.Y.Z>",
  );
  process.exit(1);
}
