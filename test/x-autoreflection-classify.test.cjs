"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "x-autoreflection", "scripts");
const CLASSIFY = path.join(SCRIPTS, "classify-turns.mjs");

const text = (value) => ({ type: "text", text: value });

function session(messages) {
  return {
    source: { host: "crush", id: "908228ee", uuid: "uuid-a", model: "deepseek-v4-pro" },
    skills: [],
    messages: messages.map((message, index) => ({ index, created: null, ...message })),
  };
}

const CASE = session([
  { role: "user", parts: [text("I am not happy with the reflection skills, do a deep research with online sources")] },
  { role: "assistant", parts: [text("Done. Deep research complete in 5 loops, with a verified trail.")] },
  { role: "user", parts: [text("Do another full round for that analysis, read internet sources, again check the article")] },
  { role: "user", parts: [text("Base directory for this skill: /home/u/.claude/skills/x-plan\n\n# X-Plan")] },
  { role: "assistant", parts: [text("Round two: the plan is written.")] },
  { role: "user", parts: [text("go on")] },
  { role: "user", parts: [text("make it as LLM prompt so i can pass it to another agent")] },
]);

describe("x-autoreflection classify-turns", async () => {
  const mod = await import(CLASSIFY);

  it("offers the model the user's own turns after the request, each with the end of the reply before it", () => {
    const items = mod.turnsToClassify(CASE);
    assert.deepEqual(items.map((item) => item.message), [2, 6], "not the request, not an injected skill body, not a bare nudge");
    assert.equal(items[0].before, "Done. Deep research complete in 5 loops, with a verified trail.");
    assert.equal(items[1].before, "Round two: the plan is written.");
  });

  it("builds one numbered prompt with the seven classes, and reads the answers back", () => {
    const items = mod.turnsToClassify(CASE);
    const prompt = mod.buildPrompt(items);
    for (const label of mod.CLASSES) assert.ok(prompt.includes(label), `the prompt names ${label}`);
    assert.match(prompt, /you missed/, "pushback names the criticism and narrowing forms, not only outright corrections");
    assert.match(prompt, /^1\. \[agent said before: "Done\. Deep research/m);
    assert.match(prompt, /^2\. \[agent said before: "Round two/m);
    const answers = mod.parseAnswers("Here you go:\n1 redo\n2 handoff\n3 pushback\n1 nonsense");
    assert.deepEqual([...answers], [[1, "redo"], [2, "handoff"], [3, "pushback"]], "an unknown class is dropped, never guessed");
  });

  it("turns labelled items into the per-session turns file the scanner reads", () => {
    const items = mod.turnsToClassify(CASE);
    assert.deepEqual(mod.labelTurns(items, mod.parseAnswers("1 redo\n2 handoff")), [
      { message: 2, class: "redo" },
      { message: 6, class: "handoff" },
    ]);
  });

  it("prints the prompt and writes the turns file from the command line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-classify-"));
    try {
      const input = path.join(dir, "session.json");
      fs.writeFileSync(input, JSON.stringify(CASE));
      const prompt = spawnSync(process.execPath, [CLASSIFY, "--input", input, "--prompt"], { encoding: "utf8" });
      assert.equal(prompt.status, 0, prompt.stderr);
      assert.match(prompt.stdout, /USER: Do another full round/);
      const answers = path.join(dir, "answers.txt");
      fs.writeFileSync(answers, "1 redo\n2 handoff\n");
      const out = path.join(dir, "turns.json");
      const labelled = spawnSync(process.execPath, [CLASSIFY, "--input", input, "--labels", answers, "--out", out], { encoding: "utf8" });
      assert.equal(labelled.status, 0, labelled.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")).turns, [
        { message: 2, class: "redo" },
        { message: 6, class: "handoff" },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
