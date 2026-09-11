// Shared input resolution: file, stdin, git commit message, or GitHub PR text.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export function readTextInput({ file, useStdin, commit, pr, cwd = process.cwd() } = {}) {
  if (commit !== undefined && commit !== null) {
    const ref = commit || "HEAD";
    const text = execFileSync("git", ["log", "-1", "--pretty=%B", ref], { cwd, encoding: "utf8" });
    return { text, source: `git:${ref}` };
  }
  if (pr !== undefined && pr !== null) {
    const args = pr ? ["pr", "view", String(pr), "--json", "title,body"] : ["pr", "view", "--json", "title,body"];
    const raw = execFileSync("gh", args, { cwd, encoding: "utf8" });
    const data = JSON.parse(raw);
    return { text: `${data.title ?? ""}\n\n${data.body ?? ""}`.trim(), source: `pr:${pr || "current"}` };
  }
  if (useStdin || file === "-") {
    return { text: fs.readFileSync(0, "utf8"), source: "stdin" };
  }
  if (file) {
    return { text: fs.readFileSync(file, "utf8"), source: file };
  }
  throw new Error("No input. Provide a file path, --stdin, --commit [ref], or --pr [number].");
}
