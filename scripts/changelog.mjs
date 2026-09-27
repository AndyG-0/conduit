#!/usr/bin/env node
// Usage: changelog.mjs release <version>
//
// Moves the "## [Unreleased]" section of CHANGELOG.md into a new
// "## [<version>] - <date>" section. If [Unreleased] has hand-written
// content, that's used as-is; otherwise a draft is generated from commit
// subjects since the last tag. The draft opens in $EDITOR for curation
// unless CI=true or CONDUIT_RELEASE_NO_EDITOR=1.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = path.join(root, "CHANGELOG.md");

function lastTag() {
  const r = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
    encoding: "utf8",
    cwd: root,
  });
  return r.status === 0 ? r.stdout.trim() : null;
}

function commitLog(since) {
  const range = since ? `${since}..HEAD` : "HEAD";
  const out = execFileSync("git", ["log", range, "--oneline", "--no-merges"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  return out ? out.split("\n") : [];
}

function extractUnreleased(text) {
  const m = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\n?$)/.exec(text);
  return m ? m[1].trim() : "";
}

const [, , cmd, newVersion] = process.argv;
if (cmd !== "release" || !newVersion) {
  console.error("Usage: changelog.mjs release <version>");
  process.exit(1);
}

const text = readFileSync(CHANGELOG, "utf8");
let body = extractUnreleased(text);

if (!body) {
  const commits = commitLog(lastTag());
  body = commits.length
    ? commits.map((l) => `- ${l.replace(/^[0-9a-f]+\s/, "")}`).join("\n")
    : "_No notable changes recorded._";
}

const skipEditor =
  process.env.CI === "true" || process.env.CONDUIT_RELEASE_NO_EDITOR === "1";
if (!skipEditor) {
  const tmp = path.join(os.tmpdir(), `conduit-changelog-${newVersion}.md`);
  writeFileSync(
    tmp,
    `# Editing release notes for v${newVersion}. Lines starting with '#' are stripped.\n${body}\n`,
  );
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const r = spawnSync(editor, [tmp], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`Editor exited with status ${r.status}`);
    process.exit(1);
  }
  body = readFileSync(tmp, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
  unlinkSync(tmp);
}

const date = new Date().toISOString().slice(0, 10);
const updated = text.replace(
  /## \[Unreleased\]\n[\s\S]*?(?=\n## \[|\n?$)/,
  `## [Unreleased]\n\n## [${newVersion}] - ${date}\n\n${body}\n`,
);
writeFileSync(CHANGELOG, updated.endsWith("\n") ? updated : `${updated}\n`);
console.log(`CHANGELOG.md updated for v${newVersion}`);
