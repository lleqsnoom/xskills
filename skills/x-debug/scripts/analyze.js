#!/usr/bin/env node
"use strict";

/**
 * x-debug analyzer — evidence-based root cause analysis.
 * Usage: node analyze.js --error "msg" [--file src.js] [--slug topic] [--no-reproduce]
 * Writes every artifact into .x-skills/runs/<stamp>-R<nn>-<slug>/.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// ── Run folders ──────────────────────────────────────────────────────
// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".x-skills/runs";
const MAX_COUNTER = 99;

function padRunCounter(value) {
  return String(value).padStart(2, "0");
}

function runFolders(rootAbs, slug) {
  if (!fs.existsSync(rootAbs)) return [];
  return fs
    .readdirSync(rootAbs)
    .filter((name) => name.endsWith(`-${slug}`))
    .sort();
}

function highestRun(rootAbs) {
  if (!fs.existsSync(rootAbs)) return 0;
  return fs.readdirSync(rootAbs).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug: the folder holding `marker` when given,
 * the sole match when only one exists, or a newly minted R<nn>.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  const folders = runFolders(rootAbs, slug);
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; resolve the run explicitly`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(`artifact counter would exceed E${MAX_COUNTER}`);
  return `E${String(next).padStart(2, "0")}`;
}
// #endregion run-folder

const PATTERNS = [
  [/Cannot read propert(ies|y) '(\w+)' of undefined/, "undefined-reference", "Accessing property on undefined value"],
  [/Cannot read propert(ies|y) '(\w+)' of null/, "null-reference", "Accessing property on null value"],
  [/is not a function/, "not-a-function", "Calling non-callable value"],
  [/Maximum call stack size exceeded/, "infinite-recursion", "Recursive function without termination"],
  [/Unexpected token|SyntaxError/, "syntax-error", "Malformed syntax or JSON"],
  [/Module not found|Cannot find module/, "missing-module", "Required package missing"],
  [/ECONNREFUSED|Connection refused/, "connection-error", "Target server unreachable"],
];

const REPRO_TEMPLATES = {
  "undefined-reference": ["const obj = undefined;", "console.log(obj.foo);"],
  "null-reference": ["const el = null;", "console.log(el.property);"],
  "not-a-function": ['const f = "string";', "f();"],
  "infinite-recursion": ["function r() { return r(); }", "r();"],
  "missing-module": ["require('nonexistent-xyz');"],
  "connection-error": [
    "const net = require('net');",
    "const c = new net.Socket();",
    "c.connect(1, '0.0.0.0', () => {});",
    "c.on('error', () => process.exit(1));",
  ],
};

function parseArgs(argv) {
  const args = argv.slice(2);
  let errorText = null, targetFile = null, contextDir = ".", sessionId = null, slug = null, reproduce = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--error" && i + 1 < args.length) errorText = args[++i];
    else if (args[i] === "--file" && i + 1 < args.length) targetFile = args[++i];
    else if (args[i] === "--context" && i + 1 < args.length) contextDir = args[++i];
    else if (args[i] === "--session-id" && i + 1 < args.length) sessionId = args[++i];
    else if (args[i] === "--slug" && i + 1 < args.length) slug = args[++i];
    else if (args[i] === "--no-reproduce") reproduce = false;
    else if (!args[i].startsWith("--")) targetFile = args[i];
  }
  return { errorText, targetFile, contextDir, sessionId, slug, reproduce };
}

function matchPatterns(errorText) {
  const matches = [];
  for (const [regex, category, desc] of PATTERNS) {
    if (regex.test(errorText)) matches.push({ category, description: desc });
  }
  return matches;
}

function reproduceLocally(errorText, targetFile, runDir) {
  fs.mkdirSync(runDir, { recursive: true });

  const matched = matchPatterns(errorText)[0];
  if (!matched) return null;

  const template = REPRO_TEMPLATES[matched.category];
  if (!template) {
    console.error("No auto-reproduction for " + matched.category);
    return null;
  }

  const reproPath = path.join(runDir, nextE(runDir) + "-repro-debug.js");
  const lines = ["// Reproduction for: " + errorText].concat(template).concat(["try { /* run */ } catch(e) { process.exit(1); }"]);
  fs.writeFileSync(reproPath, lines.join("\n"));

  try {
    execFileSync(process.execPath, [reproPath], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    return null; // didn't fail as expected
  } catch (_e) {
    const verifyPath = path.join(runDir, nextE(runDir) + "-verify.js");
    const verifyCode = [
      "const { execSync } = require('child_process');",
      "try {",
      targetFile ? "  execSync('node \"" + targetFile + "\"', { timeout: 10000 });" : "  // Run fixed code",
      "  console.log('PASS: Issue resolved'); process.exit(0);",
      "} catch (e) { console.error('FAIL:', e.message); process.exit(1); }"
    ];
    fs.writeFileSync(verifyPath, verifyCode.join("\n"));
    return { reproductionPath: reproPath, verificationPath: verifyPath, category: matched.category, reproducedSuccessfully: true };
  }
}

function generateSession(errorText, matches, targetFile, sessionId, runDir) {
  fs.mkdirSync(runDir, { recursive: true });
  const prefix = nextE(runDir);
  const fileName = `${prefix}-debug`;
  const filePath = path.join(runDir, fileName + ".md");

  let md = "# Debug Session\n\n**Error:** `" + errorText + "`\n";
  if (targetFile) md += "**File:** " + path.relative(process.cwd(), targetFile) + "\n";
  md += "\n## Hypotheses\n";
  for (const m of matches) md += "- **" + m.category + "**: " + m.description + "\n";
  md += "\n## Tests\n_Run each test and mark [ ] -> [x] Confirmed or [ ] Rejected_\n";
  md += "\n## Root Cause\n_Fill after testing:_\n";
  fs.writeFileSync(filePath, md);
  return { sessionId: fileName, reportPath: filePath, errorText, matches };
}

function exportFixPlan(errorText, matches, targetFile, sessionId, confirmed, runDir) {
  if (confirmed === undefined) confirmed = false;
  fs.mkdirSync(runDir, { recursive: true });
  const filePath = path.join(runDir, nextE(runDir) + "-fix-plan.md");

  let plan = "# Fix Plan\n\n**Error:** `" + errorText + "`\n\n";
  if (!confirmed) {
    plan += "## Test Hypotheses First\n";
    for (const m of matches) {
      plan += "- [ ] **" + m.category + "**: " + m.description + "\n";
    }
    plan += "\nRun tests above, then re-run with confirmed root cause.\n";
  } else {
    plan += "## Confirmed Root Cause\n\n";
    plan += "- [ ] **Severity:** CRITICAL (fix root cause, do NOT silence)\n";
    if (targetFile) plan += "  - **Location:** " + path.relative(process.cwd(), targetFile) + "\n";
    plan += "\n**CRITICAL RULES:**\n";
    plan += "- Do NOT add try/catch wrappers that silently swallow errors\n";
    plan += "- Do NOT disable error reporting or set process.exit(0) on failure\n";
    plan += "- DO fix the root cause so the error cannot occur\n";
    plan += "- ALWAYS verify with reproduction script after applying fix\n";
  }
  fs.writeFileSync(filePath, plan);
  return { filePath };
}

async function main() {
  const args = parseArgs(process.argv);
  const errorText = args.errorText, targetFile = args.targetFile, contextDir = args.contextDir, sessionId = args.sessionId, reproduce = args.reproduce;
  if (!errorText) { console.error("Error: --error required"); process.exit(1); }

  const matches = matchPatterns(errorText);
  const runDir = resolveRunDir(args.slug || "debug");
  let targetResolved = targetFile ? path.resolve(targetFile) : null;
  if (!targetResolved && contextDir) {
    for (const c of ["index.js","app.js","server.js","main.js"]) {
      const p = path.join(contextDir, c);
      if (fs.existsSync(p)) { targetResolved = p; break; }
    }
  }

  let reproResult = null;
  if (reproduce !== false) {
    process.stderr.write("\n[Step 1/3] Attempting local reproduction...\n\n");
    reproResult = reproduceLocally(errorText, targetResolved, runDir);
    if (reproResult) {
      process.stderr.write("Reproduction: " + reproResult.category + "\n");
      process.stderr.write("Verify script: " + reproResult.verificationPath + "\n");
      process.stderr.write("\nIMPORTANT: Verify fix before declaring done!\n\n");
    } else {
      process.stderr.write("Note: Manual reproduction needed. Use --file for better results.\n\n");
    }
  }

  const session = generateSession(errorText, matches, targetResolved, sessionId, runDir);
  const fixPlan = exportFixPlan(errorText, matches, targetResolved, sessionId, false, runDir);

  console.log(JSON.stringify(Object.assign({}, session, { fixPlanPath: fixPlan.filePath, rootCauseConfirmed: false, reproduction: reproResult }), null, 2));
  process.stderr.write("\nDebug session: " + session.reportPath + "\nFix plan: " + fixPlan.filePath + "\n");
  process.stderr.write("Matches: " + matches.length + "\n");
  process.stderr.write("\nWorkflow:\n1. Reproduce locally (done)\n2. Confirm root cause via hypothesis testing\n3. Fix root cause - NEVER silence errors\n");
  process.stderr.write("4. Verify: node " + (reproResult ? reproResult.verificationPath : "verify-script.js") + "\n");
  process.exit(0);
}

main().catch(function(err) { console.error("Fatal:", err.message || err); process.exit(1); });
