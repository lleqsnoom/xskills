import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const git = (root, args) => {
  try {
    return { ok: true, out: execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() };
  } catch {
    return { ok: false, out: "" };
  }
};

export function isGitRepository(root) {
  return git(root, ["rev-parse", "--git-dir"]).ok;
}

export function isIgnored(root, relPath) {
  return git(root, ["check-ignore", "-q", relPath]).ok;
}

export function isTracked(root, relPath) {
  return git(root, ["ls-files", relPath]).out.length > 0;
}

const STORE_DIR = ".index";

export function storeGuard(root, { allowDirty = false, relPath = ".x-skills" } = {}) {
  if (allowDirty || !isGitRepository(root)) return { ok: true, reason: null, fix: null };
  if (isIgnored(root, path.posix.join(relPath, STORE_DIR))) return { ok: true, reason: null, fix: null };
  const fix = `echo '/${relPath}' >> ${path.join(root, ".gitignore")}`;
  const tracked = isTracked(root, relPath);
  return {
    ok: false,
    reason: tracked
      ? `${relPath} is tracked by git in ${root}, so an index inside it would be committed with the code`
      : `${relPath} is not ignored by git in ${root}, so the index would show as untracked`,
    fix,
  };
}

export function guardMessage(root, guard) {
  if (guard.ok) return null;
  return [
    `refusing to index ${root}`,
    `  ${guard.reason}`,
    `  fix: ${guard.fix}`,
    `  or: x-search index --root ${root} --allow-dirty`,
  ].join("\n");
}

export function gitignoreWarning(root, relPath = ".x-skills") {
  const guard = storeGuard(root, { allowDirty: false, relPath });
  if (guard.ok) return null;
  if (!fs.existsSync(path.join(root, relPath))) return null;
  return `x-search: warning: ${guard.reason}\n  fix: ${guard.fix}`;
}
