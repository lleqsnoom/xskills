#!/usr/bin/env node
"use strict";
// Mobile reproduction: documents ADB/Logcat steps rather than running code.
const errorText = process.argv[2] || "";
if (!errorText) {
  console.error("Usage: node repro-mobile.js '<error description>'");
  process.exit(1);
}

console.log(`Mobile Reproduction Steps for: ${errorText}`);
console.log("");
console.log("1. Connect device: adb devices");
console.log("2. Clear logs: adb logcat -c");
console.log("3. Reproduce the issue on device");
console.log("4. Capture: adb logcat -d > repro-log.txt 2>&1");
console.log("5. Search for error: grep -i 'error\\|exception\\|fatal' repro-log.txt");

process.exit(1); // indicates reproduction steps documented, actual bug not in this script
