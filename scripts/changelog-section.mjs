#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, for use as GitHub release notes
// (and so as the in-app "What's new" text, which tauri-action copies into latest.json).
//
//   node scripts/changelog-section.mjs v0.2.0
//
// Fails if the section is missing or empty, or if the version doesn't match
// src-tauri/tauri.conf.json, so a tag can't publish an updater feed with the wrong version.

import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const arg = process.argv[2];
if (!arg) fail("Usage: node scripts/changelog-section.mjs <version or tag>");
const version = arg.replace(/^v/, "");

const appVersion = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", root), "utf8")).version;
if (version !== appVersion) fail(`Tag version ${version} doesn't match src-tauri/tauri.conf.json (${appVersion}).`);

const lines = readFileSync(new URL("CHANGELOG.md", root), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) fail(`CHANGELOG.md has no "## [${version}]" section.`);
// The section ends at the next version heading or at the link references at the bottom.
let end = lines.findIndex((l, i) => i > start && (l.startsWith("## ") || /^\[[^\]]+\]: /.test(l)));
if (end < 0) end = lines.length;

const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) fail(`The CHANGELOG.md section for ${version} is empty.`);
process.stdout.write(`${body}\n`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
