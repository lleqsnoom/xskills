#!/usr/bin/env node
// tests/verify-routing-table.test.cjs
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const skillsDir = path.join(__dirname, "..", "skills");
const routePath = path.join(skillsDir, "x-triage", "scripts", "route.js");
const reproduceSkillPath = path.join(skillsDir, "x-reproduce", "SKILL.md");
const investigateSkillPath = path.join(skillsDir, "x-investigate", "SKILL.md");

// Test 1: route.js exports ROUTE_TABLE with all platforms having required fields
function testRouteTableExports() {
  const { ROUTE_TABLE } = require(routePath);
  assert.ok(ROUTE_TABLE, "ROUTE_TABLE must be exported from route.js");

  for (const [key, value] of Object.entries(ROUTE_TABLE)) {
    assert.ok(value.reproduceTemplate, `${key}: missing reproduceTemplate`);
    assert.ok(
      Array.isArray(value.investigateTools) && value.investigateTools.length > 0,
      `${key}: investigateTools must be a non-empty array`,
    );
  }
}

// Test 2: x-reproduce SKILL.md references Platform field from triage brief and routes via ROUTE_TABLE
function testReproduceRoutesViaTable() {
  const content = fs.readFileSync(reproduceSkillPath, "utf-8");

  // Must mention reading Platform from triage brief
  assert.ok(
    /Platform.*triage/i.test(content) || /triage.*Platform/i.test(content),
    "x-reproduce must reference Platform field from triage brief",
  );

  // Must reference route.js or ROUTE_TABLE for template selection (not just hardcoded mapping)
  assert.ok(
    /route\.js|ROUTE_TABLE/.test(content),
    "x-reproduce must reference route.js/ROUTE_TABLE for template selection",
  );
}

// Test 3: x-investigate SKILL.md references Platform field from triage brief and routes via ROUTE_TABLE
function testInvestigateRoutesViaTable() {
  const content = fs.readFileSync(investigateSkillPath, "utf-8");

  // Must mention reading Platform from triage brief
  assert.ok(
    /Platform.*triage/i.test(content) || /triage.*Platform/i.test(content),
    "x-investigate must reference Platform field from triage brief",
  );

  // Must reference route.js or ROUTE_TABLE for tool selection
  assert.ok(
    /route\.js|ROUTE_TABLE/.test(content),
    "x-investigate must reference route.js/ROUTE_TABLE for tool selection",
  );
}

// Test 4: Adding a new platform requires editing only the table + one template (no hardcoded mappings in SKILL.md)
function testNoHardcodedMappings() {
  const reproduceContent = fs.readFileSync(reproduceSkillPath, "utf-8");
  // The skill should not have all platforms hardcoded as if they're the source of truth.
  // It should reference the shared table instead.
  assert.ok(
    !/web.*mobile.*backend.*gaming/m.test(reproduceContent),
    "x-reproduce SKILL.md must not list ALL platforms inline — defer to ROUTE_TABLE",
  );
}

// Run all tests
let failed = 0;
const tests = [testRouteTableExports, testReproduceRoutesViaTable, testInvestigateRoutesViaTable, testNoHardcodedMappings];
for (const t of tests) {
  try {
    t();
    console.log(`PASS: ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL: ${t.name} — ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} tests FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll ${tests.length} routing table wiring tests passed.`);
}
