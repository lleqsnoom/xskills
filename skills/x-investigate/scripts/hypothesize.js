#!/usr/bin/env node
"use strict";
// scripts/hypothesize.js — Generate ranked hypotheses from error evidence.
// Usage: node hypothesize.js "<error text>" [--context .]
// Output: JSON array of {rank, id, description, test, likelihood}

const PATTERNS = [
  { pattern: /Cannot read propert(ies|y) '(\w+)' of (undefined|null)/, category: "null-reference", likelihood: "high" },
  { pattern: /is not a function/, category: "not-a-function", likelihood: "high" },
  { pattern: /Maximum call stack size exceeded/, category: "infinite-recursion", likelihood: "medium" },
  { pattern: /ECONNREFUSED|Connection refused/, category: "connection-error", likelihood: "medium" },
  { pattern: /Module not found|Cannot find module/, category: "missing-module", likelihood: "high" },
  { pattern: /SyntaxError|Unexpected token/, category: "syntax-error", likelihood: "high" },
];

function generateHypotheses(errorText) {
  return PATTERNS
    .filter(p => p.pattern.test(errorText))
    .map((p, i) => ({
      rank: i + 1,
      id: p.category,
      description: `Bug matches pattern: ${p.pattern.source}`,
      test: describeTest(p.category),
      likelihood: p.likelihood,
    }));
}

function describeTest(category) {
  const tests = {
    "null-reference": "Check if the referenced variable/object is initialized before use; add null guard or trace initialization path",
    "not-a-function": "Verify the value at the call site is actually a function; check imports and module exports",
    "infinite-recursion": "Add call depth counter; verify base case exists and is reachable",
    "connection-error": "Check target host/port accessibility: nc -zv <host> <port>; verify server is running",
    "missing-module": "Run node -e \"require('<module>')\" to confirm package is installed; check package.json dependencies",
    "syntax-error": "Run node -c <file> to validate syntax; check for incomplete statements or bad JSON",
  };
  return tests[category] || null;
}

const args = process.argv.slice(2);
let errorText = "";
let contextDir = ".";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--error" && i + 1 < args.length) errorText = args[++i];
  else if (args[i] === "--context" && i + 1 < args.length) contextDir = args[++i];
}

if (!errorText) {
  process.stderr.write("Usage: node hypothesize.js --error '<text>' [--context .]\n");
  process.exit(1);
}

const hypotheses = generateHypotheses(errorText);
console.log(JSON.stringify(hypotheses, null, 2));
