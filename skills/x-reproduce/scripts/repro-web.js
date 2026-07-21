#!/usr/bin/env node
// Minimal browser-console-style reproduction for web frontend bugs.
// For complex DOM interactions, wrap in Puppeteer: document.querySelector(...).innerHTML = '...';
"use strict";

const errorText = process.argv[2] || ""; // pass error description as CLI arg
if (!errorText) {
  console.error("Usage: node repro-web.js '<error description>'");
  process.exit(1);
}

// User fills in the actual buggy code pattern here.
// Template provides structure; skill instructions guide customization.
console.log("Web reproduction template — customize with actual bug pattern.");
console.log("Error to reproduce:", errorText);

// Example pattern for undefined-reference:
// (() => { const obj = undefined; console.log(obj.foo); })();

process.exit(1); // placeholder: replace with actual repro that triggers the bug
