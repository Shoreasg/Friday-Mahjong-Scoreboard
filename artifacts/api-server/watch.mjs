#!/usr/bin/env node
// Polling-based restart supervisor for local development.
//
// tsx's built-in `--watch` uses Node's native recursive fs.watch (inotify on
// Linux), which does not reliably propagate change events across every
// Docker bind-mount implementation (this depends on the host's filesystem
// sharing backend). Polling mtimes instead works regardless of that, at the
// cost of a bounded delay between saving a file and the restart firing.
//
// The child itself still runs under tsx so extensionless/bundler-style
// relative imports (as used throughout this codebase and its workspace
// dependencies) resolve the same way they do everywhere else.
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.join(packageRoot, "src/index.ts");
const POLL_INTERVAL_MS = 500;

// The API server's own source, plus every workspace package it imports —
// matches @workspace/db, @workspace/api-zod and
// @workspace/integrations-gemini-ai in package.json.
const watchRoots = [
  path.join(packageRoot, "src"),
  path.resolve(packageRoot, "../../lib/db/src"),
  path.resolve(packageRoot, "../../lib/api-zod/src"),
  path.resolve(packageRoot, "../../lib/integrations-gemini-ai/src"),
];

function collectFiles(dir, files) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, files);
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function snapshot() {
  const state = new Map();
  for (const root of watchRoots) {
    for (const file of collectFiles(root, [])) {
      try {
        state.set(file, statSync(file).mtimeMs);
      } catch {
        // File disappeared between listing and stat-ing; ignore.
      }
    }
  }
  return state;
}

function hasChanged(before, after) {
  if (before.size !== after.size) return true;
  for (const [file, mtime] of after) {
    if (before.get(file) !== mtime) return true;
  }
  return false;
}

let child = null;

function startChild() {
  child = spawn(
    "tsx",
    [entryPoint],
    { stdio: "inherit" },
  );
  child.on("exit", (code, signal) => {
    if (signal) return; // We killed it ourselves for a restart.
    console.error(
      `[watch] server exited with code ${code} — waiting for a file change before restarting.`,
    );
  });
}

let previous = snapshot();
startChild();

const interval = setInterval(() => {
  const current = snapshot();
  if (hasChanged(previous, current)) {
    previous = current;
    console.log("[watch] change detected, restarting...");
    if (child && child.exitCode === null && child.signalCode === null) {
      child.once("exit", startChild);
      child.kill();
    } else {
      startChild();
    }
  } else {
    previous = current;
  }
}, POLL_INTERVAL_MS);

function shutdown() {
  clearInterval(interval);
  if (child) child.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
