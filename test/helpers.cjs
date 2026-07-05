"use strict";

const os = require("os");
const path = require("node:path");
const fsp = require("node:fs/promises");

/**
 * Run an async test in a temporary directory with automatic cleanup via process.chdir.
 */
async function withTmpDir(prefix, fn) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    process.chdir(tmpDir);
    await fn();
  } finally {
    process.chdir(__dirname + "/..");
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run an async test that requires setting HOME to a temp directory (for global install tests).
 */
async function withGlobalTmpDir(fn) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xskills-glob-"));
  const origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  try {
    await fn();
  } finally {
    process.env.HOME = origHome;
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fileExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

async function dirExists(p) {
  return fileExists(p);
}

function spyOn(obj, method) {
  const original = obj[method];
  const calls = [];
  obj[method] = function (...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  obj[method].mock = { calls };
  return obj[method];
}

module.exports = { withTmpDir, withGlobalTmpDir, dirExists, fileExists, spyOn };
