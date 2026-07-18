#!/usr/bin/env node
"use strict";

/**
 * x-migrate analyzer — generates migration plans from dependency analysis.
 *
 * Parses package.json, detects current versions, and identifies breaking changes
 * between source and target versions with automated fix candidates.
 *
 * Usage:
 *   node analyze.js --target express@5 [--source express@4] [--output plan.md]
 *   node analyze.js --all [--output migration-plan.md]
 *
 * Output: JSON report to stdout, markdown plan to stderr and optional file.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Known Breaking Changes Database ───────────────────────────────────

const BREAKING_CHANGES = {
  express: [
    { fromVersion: "4.x", toVersion: "5.x", change: "Async handlers now required for async functions", severity: "breaking", fix: "Wrap async handlers in express.asyncHandler() or use try/catch" },
    { fromVersion: "4.x", toVersion: "5.x", change: "req.param() removed, use req.body/params/query instead", severity: "breaking", fix: "Replace req.param('name') with req.body.name || req.params.name || req.query.name" },
    { fromVersion: "4.x", toVersion: "5.x", change: "res.send() with numbers now requires explicit status code", severity: "minor", fix: "Change res.send(200) to res.status(200).send()" },
  ],
  react: [
    { fromVersion: "16.x", toVersion: "17.x", change: "Automatic batching of state updates", severity: "minor", fix: "Review setState calls in async callbacks" },
    { fromVersion: "17.x", toVersion: "18.x", change: "StrictMode renders components twice in development", severity: "info", fix: "Ensure components are idempotent" },
    { fromVersion: "17.x", toVersion: "18.x", change: "useTransition and useDeferredValue APIs added", severity: "feature", fix: "None required, new APIs available" },
  ],
  typescript: [
    { fromVersion: "4.x", toVersion: "5.x", change: "Strict null checks enforcement in certain patterns", severity: "breaking", fix: "Add explicit null checks or use optional chaining (?.)" },
    { fromVersion: "4.x", toVersion: "5.x", change: "\"use strict\" added automatically", severity: "minor", fix: "None required" },
  ],
};

// ── Argument Parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let source = null;
  let outputFile = null;
  let allDeps = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && i + 1 < args.length) {
      target = args[++i];
    } else if (args[i] === "--source" && i + 1 < args.length) {
      source = args[++i];
    } else if (args[i] === "--output" && i + 1 < args.length) {
      outputFile = args[++i];
    } else if (args[i] === "--all") {
      allDeps = true;
    } else if (!args[i].startsWith("--")) {
      target = args[i];
    }
  }

  return { target, source, outputFile, allDeps };
}

// ── Dependency Analysis ───────────────────────────────────────────────

function readPackageJson(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch (err) {
    console.error(`Error reading package.json: ${err.message}`);
    return null;
  }
}

function getCurrentVersions(pkg) {
  const versions = {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [name, version] of Object.entries(deps)) {
    // Extract major.minor from ^1.2.3 or ~1.2.3 or 1.2.3
    const match = version.match(/^[\^~]?(\d+\.\d+(?:\.\d+)?)/);
    if (match) versions[name] = match[1];
  }
  return versions;
}

// ── Migration Plan Generation ────────────────────────────────────────

function generateMigrationPlan(target, source, currentVersions) {
  const plan = [];
  const parts = target.split("@");
  const packageName = parts[0];
  const targetVersion = parts[1] || "latest";

  if (!BREAKING_CHANGES[packageName]) {
    return [{ package: packageName, message: `No known breaking changes database for ${packageName}. Manual review required.` }];
  }

  const sourceVersion = source || currentVersions[packageName] || "unknown";
  const changes = BREAKING_CHANGES[packageName].filter((c) => c.fromVersion.includes(sourceVersion.split(".")[0]) || source === "any");

  for (const change of changes) {
    plan.push({
      package: packageName,
      fromVersion: `${packageName}@${change.fromVersion}`,
      toVersion: `${packageName}@${targetVersion}`,
      change: change.change,
      severity: change.severity,
      fix: change.fix,
      automated: change.severity === "minor" || change.severity === "feature",
    });
  }

  return plan;
}

function generateAllPlan(currentVersions) {
  const allPlans = [];
  for (const [pkg, versions] of Object.entries(BREAKING_CHANGES)) {
    if (currentVersions[pkg]) {
      const currentMajor = currentVersions[pkg].split(".")[0];
      // Check if we can upgrade to next major version
      const nextMajor = parseInt(currentMajor) + 1;
      for (const change of versions) {
        if (change.fromVersion.includes(currentMajor)) {
          allPlans.push({
            package: pkg,
            fromVersion: `${pkg}@${currentVersions[pkg]}`,
            toVersion: `${pkg}@${nextMajor}.0.0`,
            change: change.change,
            severity: change.severity,
            fix: change.fix,
            automated: change.severity === "minor" || change.severity === "feature",
          });
        }
      }
    }
  }
  return allPlans;
}

// ── Report Formatters ────────────────────────────────────────────────

function formatJSON(plan, metadata) {
  console.log(JSON.stringify({ ...metadata, plan }, null, 2));
}

function formatMarkdownPlan(plan, metadata) {
  const lines = [];
  lines.push("# Migration Plan\n");
  lines.push(`**Generated:** ${new Date().toISOString()}\n`);
  lines.push(`**Packages analyzed:** ${metadata.packagesAnalyzed || "?"}\n`);
  lines.push("---\n");

  if (plan.length === 0) {
    lines.push("No migration steps identified. Project is up to date or no breaking changes detected.\n");
    return lines.join("\n");
  }

  // Group by package
  const byPackage = {};
  for (const step of plan) {
    if (!byPackage[step.package]) byPackage[step.package] = [];
    byPackage[step.package].push(step);
  }

  for (const [pkg, steps] of Object.entries(byPackage)) {
    lines.push(`## ${pkg}\n`);
    lines.push(`**Current:** ${steps[0].fromVersion} → **Target:** ${steps[0].toVersion}\n`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const severityIcons = { breaking: "🔴", minor: "🟡", info: "ℹ️", feature: "🟢" };
      lines.push(`### ${i + 1}. ${step.change}\n`);
      lines.push(`- **Severity:** ${severityIcons[step.severity] || "?"} ${step.severity}`);
      lines.push(`- **Automated fix available:** ${step.automated ? "Yes" : "No (manual review required)"}`);
      lines.push(`\n**Fix:** ${step.fix}\n`);
    }

    lines.push("---\n");
  }

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const { target, source, outputFile, allDeps } = parseArgs(process.argv);

  if (!target && !allDeps) {
    console.error("Error: --target <package@version> or --all required");
    process.exit(1);
  }

  // Read package.json
  const pkg = readPackageJson(process.cwd());
  if (!pkg) {
    console.error("Error: No package.json found in current directory");
    process.exit(1);
  }

  const currentVersions = getCurrentVersions(pkg);
  let plan;

  if (allDeps) {
    plan = generateAllPlan(currentVersions);
  } else {
    plan = generateMigrationPlan(target, source, currentVersions);
  }

  // Format and output
  const metadata = { packagesAnalyzed: allDeps ? Object.keys(BREAKING_CHANGES).length : 1 };
  formatJSON(plan, metadata);

  const report = formatMarkdownPlan(plan, metadata);
  process.stderr.write(report + "\n");

  // Write to file if specified
  if (outputFile) {
    fs.writeFileSync(outputFile, report);
    console.error(`Migration plan written to: ${outputFile}`);
  }

  process.exit(0);
}

main();
