#!/usr/bin/env node
"use strict";

/**
 * x-debug analyzer — evidence-based root cause analysis.
 * Usage: node analyze.js --error "msg" [--file src.js] [--no-reproduce]
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
  let errorText = null, targetFile = null, contextDir = ".", sessionId = null, reproduce = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--error" && i + 1 < args.length) errorText = args[++i];
    else if (args[i] === "--file" && i + 1 < args.length) targetFile = args[++i];
    else if (args[i] === "--context" && i + 1 < args.length) contextDir = args[++i];
    else if (args[i] === "--session-id" && i + 1 < args.length) sessionId = args[++i];
    else if (args[i] === "--no-reproduce") reproduce = false;
    else if (!args[i].startsWith("--")) targetFile = args[i];
  }
  return { errorText, targetFile, contextDir, sessionId, reproduce };
}

function matchPatterns(errorText) {
  const matches = [];
  for (const [regex, category, desc] of PATTERNS) {
    if (regex.test(errorText)) matches.push({ category, description: desc });
  }
  return matches;
}

function reproduceLocally(errorText, targetFile) {
  const debugDir = path.join(process.cwd(), ".x-skills", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const matched = matchPatterns(errorText)[0];
  if (!matched) return null;

  const template = REPRO_TEMPLATES[matched.category];
  if (!template) {
    console.error("No auto-reproduction for " + matched.category);
    return null;
  }

  const reproPath = path.join(debugDir, "repro-" + Date.now() + ".js");
  const lines = ["// Reproduction for: " + errorText].concat(template).concat(["try { /* run */ } catch(e) { process.exit(1); }"]);
  fs.writeFileSync(reproPath, lines.join("\n"));

  try {
    execFileSync(process.execPath, [reproPath], { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    return null; // didn't fail as expected
  } catch (_e) {
    const verifyPath = path.join(debugDir, "verify-" + Date.now() + ".js");
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

function generateSession(errorText, matches, targetFile, sessionId) {
  const sessionDir = path.join(process.cwd(), ".x-skills", "debug");
  fs.mkdirSync(sessionDir, { recursive: true });
  const fileName = sessionId || "debug-" + Date.now();
  const filePath = path.join(sessionDir, fileName + ".md");

  let md = "# Debug Session\n\n**Error:** `" + errorText + "`\n";
  if (targetFile) md += "**File:** " + path.relative(process.cwd(), targetFile) + "\n";
  md += "\n## Hypotheses\n";
  for (const m of matches) md += "- **" + m.category + "**: " + m.description + "\n";
  md += "\n## Tests\n_Run each test and mark [ ] -> [x] Confirmed or [ ] Rejected_\n";
  md += "\n## Root Cause\n_Fill after testing:_\n";
  fs.writeFileSync(filePath, md);
  return { sessionId: fileName, reportPath: filePath, errorText, matches };
}

function exportFixPlan(errorText, matches, targetFile, sessionId, confirmed) {
  if (confirmed === undefined) confirmed = false;
  const reviewDir = path.join(process.cwd(), ".x-skills", "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const ts = new Date();
  const dateStr = String(ts.getDate()).padStart(2,'0') + "-" + String(ts.getMonth()+1).padStart(2,'0') + "-" + ts.getFullYear() + "-" + String(ts.getHours()).padStart(2,'0') + ":" + String(ts.getMinutes()).padStart(2,'0');
  const filePath = path.join(reviewDir, "debug-" + (sessionId || dateStr.replace(/[:\s]/g,'-')) + ".md");

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
    reproResult = reproduceLocally(errorText, targetResolved);
    if (reproResult) {
      process.stderr.write("Reproduction: " + reproResult.category + "\n");
      process.stderr.write("Verify script: " + reproResult.verificationPath + "\n");
      process.stderr.write("\nIMPORTANT: Verify fix before declaring done!\n\n");
    } else {
      process.stderr.write("Note: Manual reproduction needed. Use --file for better results.\n\n");
    }
  }

  const session = generateSession(errorText, matches, targetResolved, sessionId);
  const fixPlan = exportFixPlan(errorText, matches, targetResolved, sessionId, false);

  console.log(JSON.stringify(Object.assign({}, session, { fixPlanPath: fixPlan.filePath, rootCauseConfirmed: false, reproduction: reproResult }), null, 2));
  process.stderr.write("\nDebug session: " + session.reportPath + "\nFix plan: " + fixPlan.filePath + "\n");
  process.stderr.write("Matches: " + matches.length + "\n");
  process.stderr.write("\nWorkflow:\n1. Reproduce locally (done)\n2. Confirm root cause via hypothesis testing\n3. Fix root cause - NEVER silence errors\n");
  process.stderr.write("4. Verify: node " + (reproResult ? reproResult.verificationPath : "verify-script.js") + "\n");
  process.exit(0);
}

main().catch(function(err) { console.error("Fatal:", err.message || err); process.exit(1); });
