#!/usr/bin/env node
"use strict";

/**
 * x-debug analyzer — structured debugging workflow engine.
 *
 * Generates hypotheses from error messages, designs elimination tests,
 * and produces debug session reports in .x-skills/debug/.
 *
 * Usage:
 *   node analyze.js --error "TypeError: Cannot read property 'foo' of undefined" [--file src/main.js]
 *   node analyze.js --context . [--session-id my-debug-123]
 *
 * Output: JSON report to stdout, markdown debug session to stderr and file.
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Common Error Pattern Database ─────────────────────────────────────

const ERROR_PATTERNS = [
  {
    regex: /Cannot read propert(y|s) '(\w+)' of undefined/,
    category: "undefined-reference",
    description: "Attempting to access a property on an undefined or null value",
    likelihood: 0.9,
    hypotheses: [
      {
        id: "H1",
        cause: "Variable is not initialized before use",
        test: `// Test if variable is defined before accessing property
if (typeof myVar === 'undefined' || myVar === null) {
  console.error('myVar is undefined/null at access point');
}`,
        expectedIfTrue: "Console error shows myVar is undefined/null",
      },
      {
        id: "H2",
        cause: "Function returned undefined instead of expected object",
        test: `// Log the return value of the function before accessing property
const result = someFunction();
console.log('Return type:', typeof result);
console.log('Is object?', result !== null && typeof result === 'object');`,
        expectedIfTrue: "Console shows 'undefined' or non-object type",
      },
      {
        id: "H3",
        cause: "Async operation completed but data not available yet",
        test: `// Add await or check if promise resolved before accessing property
const data = await fetchData();
console.log('Data exists?', !!data);`,
        expectedIfTrue: "Console shows 'Data exists? false' when run without await",
      },
    ],
  },
  {
    regex: /Cannot read propert(y|s) '(\w+)' of null/,
    category: "null-reference",
    description: "Attempting to access a property on a null value",
    likelihood: 0.85,
    hypotheses: [
      {
        id: "H1",
        cause: "Element not found in DOM or collection is empty",
        test: `// Check if element exists before accessing properties
const el = document.querySelector('.target');
console.log('Element found?', !!el);`,
        expectedIfTrue: "Console shows 'Element found? false'",
      },
    ],
  },
  {
    regex: /is not a function/,
    category: "not-a-function",
    description: "Attempting to call something that is not callable",
    likelihood: 0.8,
    hypotheses: [
      {
        id: "H1",
        cause: "Variable holds wrong type (string/number instead of function)",
        test: `// Check the actual type of the variable
console.log('Type:', typeof myVar);
console.log('Is function?', typeof myVar === 'function');`,
        expectedIfTrue: "Console shows 'Is function? false'",
      },
    ],
  },
  {
    regex: /Maximum call stack size exceeded/,
    category: "infinite-recursion",
    description: "Recursive function without proper termination condition",
    likelihood: 0.95,
    hypotheses: [
      {
        id: "H1",
        cause: "Missing or incorrect base case in recursive function",
        test: `// Add console.log to track recursion depth
let depth = 0;
function myFunc() {
  console.log('Depth:', ++depth);
  // ... existing logic ...
}`,
        expectedIfTrue: "Console shows increasing depth without stopping",
      },
    ],
  },
  {
    regex: /Unexpected token|SyntaxError/,
    category: "syntax-error",
    description: "JavaScript syntax issue in code or JSON data",
    likelihood: 0.7,
    hypotheses: [
      {
        id: "H1",
        cause: "Malformed JSON string being parsed",
        test: `// Validate JSON before parsing
try {
  JSON.parse(jsonString);
} catch (e) {
  console.error('JSON parse error:', e.message);
}`,
        expectedIfTrue: "Console shows JSON parse error with position",
      },
    ],
  },
  {
    regex: /Module not found|Cannot find module/,
    category: "missing-module",
    description: "Required module or package is missing from node_modules",
    likelihood: 0.9,
    hypotheses: [
      {
        id: "H1",
        cause: "Package not installed in current directory",
        test: `// Check if package exists in node_modules
const fs = require('fs');
console.log('Module exists?', fs.existsSync('./node_modules/package-name'));`,
        expectedIfTrue: "Console shows 'Module exists? false'",
      },
    ],
  },
  {
    regex: /ECONNREFUSED|Connection refused/,
    category: "connection-error",
    description: "Cannot connect to target server or service",
    likelihood: 0.85,
    hypotheses: [
      {
        id: "H1",
        cause: "Target server is not running on expected port",
        test: `// Check if port is listening
const net = require('net');
const client = new net.Socket();
client.connect(3000, 'localhost', () => console.log('Port open'));
client.on('error', (e) => console.error('Connection failed:', e.message));`,
        expectedIfTrue: "Console shows 'Connection failed' with error details",
      },
    ],
  },
];

// ── Argument Parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let errorText = null;
  let targetFile = null;
  let contextDir = ".";
  let sessionId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--error" && i + 1 < args.length) {
      errorText = args[++i];
    } else if (args[i] === "--file" && i + 1 < args.length) {
      targetFile = args[++i];
    } else if (args[i] === "--context" && i + 1 < args.length) {
      contextDir = args[++i];
    } else if (args[i] === "--session-id" && i + 1 < args.length) {
      sessionId = args[++i];
    } else if (!args[i].startsWith("--")) {
      targetFile = args[i];
    }
  }

  return { errorText, targetFile, contextDir, sessionId };
}

// ── Analysis Engine ───────────────────────────────────────────────────

function findMatchingPatterns(errorText) {
  const matches = [];
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.regex.test(errorText)) {
      matches.push(pattern);
    }
  }
  return matches;
}

// ── Report Generation ────────────────────────────────────────────────

function generateDebugSession(errorText, matches, targetFile, sessionId) {
  const timestamp = new Date().toISOString();
  const sessionDir = path.join(process.cwd(), ".x-skills", "debug");
  fs.mkdirSync(sessionDir, { recursive: true });

  const fileName = sessionId || `debug-${Date.now()}`;
  const filePath = path.join(sessionDir, `${fileName}.md`);

  // Build hypothesis table
  let mdReport = `# Debug Session Report\n\n`;
  mdReport += `**Timestamp:** ${timestamp}\n`;
  mdReport += `**Error:** \`${errorText}\`\n`;
  if (targetFile) mdReport += `**Target File:** ${path.relative(process.cwd(), targetFile)}\n`;
  mdReport += `\n---\n\n`;

  // Phase 1: Hypothesis Formation
  mdReport += `## Phase 1: Hypothesis Formation\n\n`;
  mdReport += `### Detected Error Category\n\n`;
  for (const match of matches) {
    mdReport += `- **${match.category}**: ${match.description}\n`;
  }
  mdReport += `\n`;

  // Phase 2: Test Design
  mdReport += `## Phase 2: Elimination Tests\n\n`;
  for (const match of matches) {
    mdReport += `### Category: ${match.category}\n\n`;
    for (let i = 0; i < match.hypotheses.length; i++) {
      const h = match.hypotheses[i];
      mdReport += `#### ${h.id}: ${h.cause} (likelihood: ${(h.likelihood * 100).toFixed(0)}%)\n\n`;
      mdReport += `**Test Code:**\n\`\`\`javascript\n${h.test}\n\`\`\`\n\n`;
      mdReport += `**Expected if true:** ${h.expectedIfTrue}\n\n`;
      mdReport += `[ ] **Result:** (pending)\n\n`;
    }
  }

  // Phase 3: Evidence Collection Template
  mdReport += `## Phase 3: Evidence Collection\n\n`;
  mdReport += `_Fill in test results above. Mark each hypothesis as:_\n`;
  mdReport += `- [x] **Confirmed** — evidence supports this cause\n`;
  mdReport += `- [ ] **Rejected** — evidence contradicts this cause\n`;
  mdReport += `- [ ] **Inconclusive** — need more tests\n\n`;

  // Phase 4: Root Cause Declaration Template
  mdReport += `## Phase 4: Root Cause Declaration\n\n`;
  mdReport += `_Complete after testing:_\n\n`;
  mdReport += `### Confirmed Root Cause\n- [ ] (check when identified)\n\n`;
  mdReport += `### Evidence Chain\n1. _(list observations in order)_\n2. \n3. \n\n`;
  mdReport += `### Recommended Fix\n\`\`\`javascript\n// TODO: Implement fix based on confirmed root cause\n\`\`\`\n`;

  // Write report
  fs.writeFileSync(filePath, mdReport);

  return {
    sessionId: fileName,
    filePath,
    errorText,
    matches: matches.map((m) => ({ category: m.category, description: m.description, hypothesesCount: m.hypotheses.length })),
    reportPath: filePath,
  };
}

// ── Export to Fix Plan Format ────────────────────────────────────────

function exportToFixPlan(errorText, matches, targetFile, sessionId, rootCauseConfirmed = false) {
  const reviewDir = path.join(process.cwd(), ".x-skills", "review");
  fs.mkdirSync(reviewDir, { recursive: true });

  const timestamp = new Date();
  const dateStr = `${String(timestamp.getDate()).padStart(2, '0')}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${timestamp.getFullYear()}-${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}`;
  const fileName = `debug-${sessionId || dateStr.replace(/[:\s]/g, '-')}.md`;
  const filePath = path.join(reviewDir, fileName);

  let planContent = `# Debug Session — Fix Plan\n\n`;
  planContent += `**Date:** ${dateStr}\n`;
  planContent += `**Source:** x-debug session\n`;
  planContent += `**Error:** \`${errorText}\`\n`;
  if (targetFile) {
    planContent += `**Target File:** ${path.relative(process.cwd(), targetFile)}\n`;
  }
  planContent += `\n---\n\n`;

  if (!rootCauseConfirmed) {
    // Initial hypotheses phase - not ready for x-fix yet
    planContent += `## Phase 1: Hypothesis Testing Required\n\n`;
    planContent += `_Complete hypothesis testing in the debug session before running x-fix._\n\n`;
    
    let hypothesisCount = 0;
    for (const match of matches) {
      for (let i = 0; i < match.hypotheses.length; i++) {
        const h = match.hypotheses[i];
        hypothesisCount++;
        
        planContent += `### [${match.category.toUpperCase()}] — ${h.cause}\n\n`;
        planContent += `- [ ] **Hypothesis ID:** ${h.id} (likelihood: ${(h.likelihood * 100).toFixed(0)}%)\n`;
        planContent += `  - **Test Code:**\n    \`\`\`javascript\n    ${h.test.split('\n').join('\n    ')}\n    \`\`\`\n`;
        planContent += `  - **Expected Result:** ${h.expectedIfTrue}\n\n`;
      }
    }

    planContent += `\n## Next Steps\n\n`;
    planContent += `1. Run each test above to confirm/reject hypotheses\n`;
    planContent += `2. Once root cause is identified, re-run x-debug with --session-id to update this plan\n`;
    planContent += `3. Then run \`x-fix\` to systematically resolve the confirmed issue\n`;
  } else {
    // Root cause confirmed - create actionable fix items
    planContent += `## Confirmed Root Cause\n\n`;
    
    let issueCount = 0;
    for (const match of matches) {
      // Only include the confirmed hypothesis
      const confirmedHypothesis = match.hypotheses.find(h => h.confirmed);
      if (!confirmedHypothesis) continue;
      
      issueCount++;
      planContent += `## [${match.category.toUpperCase()}] — ${confirmedHypothesis.cause}\n\n`;
      planContent += `- [ ] **Severity:** CRITICAL\n`;
      planContent += `  - **Location:** ${targetFile ? path.relative(process.cwd(), targetFile) : 'Unknown'}\n`;
      planContent += `  - **Root Cause:** ${confirmedHypothesis.cause}\n`;
      planContent += `  - **Recommended Fix:**\n    \`\`\`javascript\n    ${confirmedHypothesis.recommendedFix || '// Implement fix based on confirmed root cause'}\n    \`\`\`\n\n`;
      planContent += `---\n\n`;
    }

    planContent += `## Summary\n\n`;
    planContent += `**Total issues:** ${issueCount}\n`;
    planContent += `**Status:** 0/${issueCount} resolved | Run \`x-fix\` to systematically resolve.\n`;
  }

  fs.writeFileSync(filePath, planContent);
  
  return { filePath, issueCount: rootCauseConfirmed ? issueCount : hypothesisCount };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const { errorText, targetFile, contextDir, sessionId } = parseArgs(process.argv);

  if (!errorText) {
    console.error("Error: --error flag required with error message or stack trace");
    process.exit(1);
  }

  // Find matching error patterns
  const matches = findMatchingPatterns(errorText);

  let targetResolved = null;
  if (targetFile) {
    targetResolved = path.resolve(targetFile);
  } else if (contextDir && fs.statSync(contextDir).isDirectory()) {
    // Auto-detect main source file
    const candidates = ["index.js", "app.js", "server.js", "main.js"];
    for (const candidate of candidates) {
      const fullPath = path.join(contextDir, candidate);
      if (fs.existsSync(fullPath)) {
        targetResolved = fullPath;
        break;
      }
    }
  }

  // Generate debug session report
  const result = generateDebugSession(errorText, matches, targetResolved, sessionId);

  // Export to fix plan format for x-fix consumption (initial hypotheses phase)
  const fixPlanResult = exportToFixPlan(errorText, matches, targetResolved, sessionId, false);

  // Output JSON to stdout
  console.log(JSON.stringify({
    ...result,
    fixPlanPath: fixPlanResult.filePath,
    fixPlanIssues: fixPlanResult.issueCount,
    rootCauseConfirmed: false,
  }, null, 2));

  // Output summary to stderr
  process.stderr.write(`\nDebug session created: ${result.reportPath}\n`);
  process.stderr.write(`Fix plan exported: ${fixPlanResult.filePath}\n`);
  process.stderr.write(`Matches found: ${matches.length} categories\n`);
  for (const m of result.matches) {
    process.stderr.write(`  - ${m.category}: ${m.hypothesesCount} hypotheses\n`);
  }
  process.stderr.write(`\nNext steps:\n`);
  process.stderr.write(`1. Run each test in the debug session to confirm/reject hypotheses\n`);
  process.stderr.write(`2. Once root cause is confirmed, re-run with --confirmed flag to generate actionable fix plan\n`);
  process.stderr.write(`3. Then run \`x-fix\` to systematically resolve the confirmed issue\n`);

  process.exit(0);
}

main();
