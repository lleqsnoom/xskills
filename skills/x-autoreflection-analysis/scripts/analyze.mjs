#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * x-autoreflection-analysis — traverse past sessions across every CLI and write the skill-health
 * report: one JSON (the source of truth the heal skill consumes) and one markdown (the human read),
 * rendered from the same object so they cannot drift.
 *
 * Traversal shells out to the sibling `x-autoreflection` scripts (read-session, scan-session): those
 * own the host adapters, and the lint forbids importing them. The path is resolved relative to this
 * file, so the two skills must be installed side by side — which they always are, as one package.
 */

export const SCHEMA = "x-autoreflection-analysis/1";

/** A signal kind → the improvement class that answers it (mirrors gap-taxonomy.md). */
export const CLASS_BY_KIND = {
  "tool-failure": "doc-command-drift",
  "repeat-call": "missing-check",
  "user-correction": "missing-gate",
  "user-reprompt": "stopping-point",
  "prose-question": "panel-rule",
  "user-redo": "missing-expectation",
  "user-handoff": "missing-expectation",
  "user-pushback": "missing-expectation",
  "tool-rejected": "ritual-cost",
  "skill-script-silent": "silent-success",
  // skill-unused and expected-exit have no per-file class: the first is a portfolio
  // decision, the second is not a gap at all.
};

/** What the change for a kind usually is, as a hint the heal skill turns into an exact edit. */
export const CHANGE_HINT = {
  "tool-failure": "align the documented command or flag with what the script actually accepts",
  "repeat-call": "add a check so the retried step is verified once instead of re-run",
  "user-correction": "add the missing question or default so the agent does not proceed on a wrong assumption",
  "user-reprompt": "name the stopping point in the step's Completion: line",
  "prose-question": "point the asking section at the panel rule (references/questions.md)",
  "user-redo": "quote the user's redo, name what the first answer missed, and add it to the skill as one expected behaviour",
  "user-handoff": "read the turns before the handoff, name what the output lacked, and add it as an expected behaviour or a report-with-evidence rule",
  "user-pushback": "quote the pushback, find the skill line that should have prevented it, or add the missing expected behaviour",
  "tool-rejected": "make the step the user refused conditional on the situation that needs it",
  "skill-script-silent": "make the script print a result line on success, and compare real paths in its main guard",
};

export const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const MAX_EVIDENCE = 5;
const DELETE_MIN_RECURRENCE = 2;

/**
 * The signals that are not gaps: expected-exit is an answer, not a failure, and an interrupt only says
 * the user stopped a turn — the reason is in the anchor that follows it, if any.
 */
const NON_GAP_KINDS = new Set(["expected-exit", "interrupt"]);

function firstSummary(summaries) {
  return summaries.filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? "";
}

/**
 * Aggregate a batch of scan JSONs into the report object. Pure and importable: the traversal that
 * produced the scans is the caller's business, so a test drives it with synthetic scans alone.
 */
export function aggregate(scans, { hours = 24 } = {}) {
  const sessions = scans.map((scan) => ({
    id: scan.source?.id ?? scan.source?.uuid ?? "?",
    title: scan.source?.title ?? null,
    host: scan.source?.host ?? null,
    stats: scan.stats ?? {},
    skills: {
      loaded: scan.skills?.loaded ?? [],
      used: scan.skills?.used ?? [],
      unused: scan.skills?.unused ?? [],
    },
    signals: scan.signals ?? [],
  }));

  const skillRows = new Map();
  const skillFor = (name) => {
    if (!skillRows.has(name)) {
      skillRows.set(name, { name, sessions: 0, loaded: 0, used: 0, unused: 0, high: 0, medium: 0, low: 0 });
    }
    return skillRows.get(name);
  };
  const touched = new Set();
  for (const session of sessions) {
    const named = new Set([...session.skills.loaded, ...session.skills.used]);
    for (const name of named) {
      skillFor(name).sessions++;
      touched.add(name);
    }
    for (const name of session.skills.loaded) {
      skillFor(name).loaded++;
      if (session.skills.unused.includes(name)) skillFor(name).unused++;
    }
    for (const name of session.skills.used) skillFor(name).used++;
    for (const signal of session.signals) {
      for (const suspect of signal.suspects ?? []) skillFor(suspect)[signal.severity ?? "low"]++;
    }
  }

  // Group signals by (kind, primary suspect) so the same gap in two sessions is one finding.
  // `skill-unused` is grouped per skill, not per the whole suspect list: a signal names every unused
  // skill at once, and grouping the whole list would split one skill's recurrence across subsets.
  const groups = new Map();
  const ensureGroup = (key, signal, session, shape) => {
    if (!groups.has(key)) {
      groups.set(key, { ...shape, sessionSet: new Set(), count: 0, severity: "low", summaries: [], evidence: [] });
    }
    const group = groups.get(key);
    group.sessionSet.add(session.id);
    group.count += signal.count ?? 1;
    if (SEVERITY_WEIGHT[signal.severity] > SEVERITY_WEIGHT[group.severity]) group.severity = signal.severity;
    if (signal.summary) group.summaries.push(signal.summary);
    for (const ev of signal.evidence ?? []) {
      if (group.evidence.length < MAX_EVIDENCE) group.evidence.push({ session: session.id, message: ev.message, excerpt: ev.excerpt ?? "" });
    }
  };

  for (const session of sessions) {
    for (const signal of session.signals) {
      if (NON_GAP_KINDS.has(signal.kind)) continue;
      if (signal.kind === "skill-unused") {
        for (const name of signal.suspects ?? []) {
          ensureGroup(`skill-unused|${name}`, signal, session, { kind: signal.kind, skill: name, suspects: [name] });
        }
        continue;
      }
      const primary = (signal.suspects && signal.suspects[0]) || null;
      ensureGroup(`${signal.kind}|${primary ?? "(none)"}`, signal, session, { kind: signal.kind, skill: primary, suspects: signal.suspects ?? [] });
    }
  }

  const findings = [];
  const portfolio = [];
  let fi = 0;
  let pi = 0;

  for (const group of groups.values()) {
    const recurrence = group.sessionSet.size;

    if (group.kind === "skill-unused") {
      if (recurrence >= DELETE_MIN_RECURRENCE) {
        portfolio.push({
          id: `PF${++pi}`,
          action: "delete",
          skills: [group.skill],
          reason: `loaded but never used in ${recurrence} session(s)`,
          evidence: group.evidence.slice(0, 2),
        });
      }
      continue;
    }

    const cls = CLASS_BY_KIND[group.kind] ?? null;
    const finding = {
      id: `F${++fi}`,
      kind: group.kind,
      class: cls,
      skill: group.skill,
      severity: group.severity,
      recurrence,
      count: group.count,
      summary: firstSummary(group.summaries),
      change: cls ? CHANGE_HINT[group.kind] : "",
      sessions: [...group.sessionSet].sort(),
      evidence: group.evidence.slice(0, MAX_EVIDENCE),
    };
    findings.push(finding);

    // A failure no skill names is a gap no skill covers: a create candidate.
    if (!group.skill && (group.kind === "tool-failure" || group.kind === "user-correction") && recurrence >= 2) {
      portfolio.push({
        id: `PF${++pi}`,
        action: "create",
        skills: [],
        reason: `recurring ${group.kind} names no skill, so no skill owns this gap`,
        evidence: group.evidence.slice(0, 2),
      });
    }
  }

  // Rank findings: recurrence first, then severity, then count — "most important" first.
  findings.sort(
    (a, b) =>
      b.recurrence - a.recurrence ||
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
      b.count - a.count ||
      a.id.localeCompare(b.id)
  );

  const totalSignals = sessions.reduce((sum, session) => sum + session.signals.length, 0);
  const highSignals = sessions.reduce(
    (sum, session) => sum + session.signals.filter((signal) => signal.severity === "high").length,
    0
  );

  return {
    schema: SCHEMA,
    generatedAt: timestamp(new Date()),
    window: { hours, since: null, until: null },
    stats: {
      sessions: sessions.length,
      skillsTouched: touched.size,
      signals: totalSignals,
      high: highSignals,
      findings: findings.length,
      portfolio: portfolio.length,
    },
    skills: [...skillRows.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
    findings,
    portfolio,
    notes: [
      "recurrence counts distinct sessions, not signals: the same gap in three sessions is a defect, in one a hypothesis.",
      "severity is mechanical and inherited from the scanner; a finding names a suspect skill, not a verdict.",
    ],
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

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

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with `fresh`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  if (fresh) return mintRunDir(rootAbs, slug, now);

  const folders = runFolders(rootAbs, slug);
  if (run !== null) {
    const wanted = `-R${padRunCounter(run)}-`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(`no run R${padRunCounter(run)} for "${slug}"`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; pass --run <nn> to pick one, or --new-run to start another`);
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

/** The cross-session view the sibling `anchors.mjs` computed: retries, reading order, audit. */
export function withAnchors(report, anchors) {
  return {
    ...report,
    retries: anchors?.retries ?? [],
    select: anchors?.select ?? [],
    recurring: anchors?.recurring ?? [],
    audit: anchors?.audit ?? null,
  };
}

function renderReadFirst(report) {
  if (!report.select?.length) return [];
  const lines = ["## Read first", ""];
  for (const choice of report.select) {
    const anchors = choice.anchors.map((anchor) => (anchor.message === null || anchor.message === undefined ? anchor.kind : `${anchor.kind} msg ${anchor.message}`));
    lines.push(`- \`${choice.session}\` — ${choice.reason}${choice.owner ? ` (\`${choice.owner}\`)` : ""}${choice.model ? ` · ${choice.model}` : ""}${anchors.length ? ` · ${anchors.join(", ")}` : ""}`);
  }
  if (report.audit) lines.push(`- audit: \`${report.audit.session}\` — no anchor, read and label it anyway`);
  lines.push("");
  if (report.retries?.length) {
    lines.push("## Asked again in a later session", "");
    for (const retry of report.retries) lines.push(`- \`${retry.earlier}\` → \`${retry.later}\` after ${retry.hours} h: "${retry.excerpt}"`);
    lines.push("");
  }
  return lines;
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Skill-health analysis — ${report.window.hours}h window`);
  lines.push("");
  lines.push(
    `**Written:** ${report.generatedAt} · **Sessions:** ${report.stats.sessions} · ` +
      `**Skills touched:** ${report.stats.skillsTouched} · **Signals:** ${report.stats.signals} (${report.stats.high} high)`
  );
  lines.push("");

  lines.push(...renderReadFirst(report));
  lines.push("## Skills in use");
  lines.push("");
  if (!report.skills.length) {
    lines.push("No session loaded or mentioned an x-skill in this window.");
  } else {
    lines.push("| Skill | Sessions | Loaded | Used | Unused | Signals h/m/l |");
    lines.push("|---|---|---|---|---|---|");
    for (const row of report.skills) {
      lines.push(`| \`${row.name}\` | ${row.sessions} | ${row.loaded} | ${row.used} | ${row.unused} | ${row.high}/${row.medium}/${row.low} |`);
    }
  }
  lines.push("");

  lines.push("## Findings");
  lines.push("");
  if (!report.findings.length) {
    lines.push("No skill friction survived the scan. A quiet window is a result, not a gap.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.id} — ${finding.kind}${finding.skill ? ` (\`${finding.skill}\`)` : ""}`);
      lines.push(`**Class:** ${finding.class ?? "none"} · **Severity:** ${finding.severity} · **Recurrence:** ${finding.recurrence} session(s) · **Count:** ${finding.count}`);
      lines.push(`**Summary:** ${finding.summary}`);
      if (finding.change) lines.push(`**Change:** ${finding.change}`);
      lines.push(`**Sessions:** ${finding.sessions.join(", ")}`);
      for (const ev of finding.evidence) lines.push(`- \`${ev.session}\`#${ev.message}: ${ev.excerpt}`);
      lines.push("");
    }
  }

  lines.push("## Portfolio");
  lines.push("");
  if (!report.portfolio.length) {
    lines.push("No structural changes suggested.");
  } else {
    for (const item of report.portfolio) {
      lines.push(`### ${item.id} — ${item.action}: ${item.skills.length ? item.skills.map((s) => `\`${s}\``).join(", ") : "a new skill"}`);
      lines.push(`**Reason:** ${item.reason}`);
      for (const ev of item.evidence) lines.push(`- \`${ev.session}\`#${ev.message}: ${ev.excerpt}`);
      lines.push("");
    }
  }

  lines.push("## Notes");
  lines.push("");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}

/** The report is written as one JSON (truth) and one markdown rendered from it (read). */
export function writeReport(report, runDir) {
  fs.mkdirSync(runDir, { recursive: true });
  const number = nextE(runDir);
  const jsonPath = path.join(runDir, `${number}-analysis.json`);
  const mdPath = path.join(runDir, `${number}-analysis.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderMarkdown(report)}\n`);
  return { jsonPath, mdPath };
}

/** Resolve the sibling skill's script dir, or throw a clear error when it is not installed. */
export function siblingScripts(root = path.resolve(__dirname, "..", "..")) {
  const dir = path.join(root, "x-autoreflection", "scripts");
  if (!fs.existsSync(path.join(dir, "read-session.mjs"))) {
    throw new Error(`x-autoreflection is not installed beside x-autoreflection-analysis (expected ${dir}/read-session.mjs)`);
  }
  return dir;
}

function runNode(script, args) {
  return execFileSync("node", [script, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

/**
 * Retries, reading order and audit from the sibling `anchors.mjs`. A missing or failing sibling leaves
 * the report without them and says so, rather than failing the whole analysis.
 */
export function anchorsFor(scans, { scripts, date = timestamp(new Date()).slice(0, 10) }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-anchors-"));
  try {
    const input = path.join(workDir, "scans.json");
    fs.writeFileSync(input, JSON.stringify(scans));
    return JSON.parse(runNode(path.join(scripts, "anchors.mjs"), ["--input", input, "--date", date]));
  } catch (err) {
    return { retries: [], select: [], recurring: [], audit: null, error: err.message.slice(0, 160) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Enumerate the window's sessions by shelling to the sibling reader. */
export function listWindow({ hours, host, scripts }) {
  const args = ["--list", "--hours", String(hours)];
  if (host) args.push("--host", host);
  const { sessions, hosts } = JSON.parse(runNode(path.join(scripts, "read-session.mjs"), args));
  return { sessions, hosts };
}

/** Scan one session into a signals file, returning the parsed scan. */
export function scanOne({ host, id, skillsDir, scripts, workDir, out, hours = 24 }) {
  const transcript = path.join(workDir, "session.json");
  // `--hours` sets the project lookback, not the session window: `--session` reads any id, but the
  // crush adapter only lists projects touched within the lookback, so a 72h window must look back 72h.
  runNode(path.join(scripts, "read-session.mjs"), ["--session", String(id), "--host", host, "--hours", String(hours), "--out", transcript]);
  const args = ["--input", transcript, "--out", out];
  if (skillsDir) args.push("--skills-dir", skillsDir);
  runNode(path.join(scripts, "scan-session.mjs"), args);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

function usage() {
  return [
    "x-autoreflection-analysis analyze — traverse past sessions and write the skill-health report.",
    "",
    "Usage:",
    "  node analyze.mjs [--hours 24] [--host crush,codex] [--scans <dir>] [--out <run-dir>]",
    "",
    "Flags:",
    "  --hours <n>      How far back to look (default: 24)",
    "  --host <ids>     Comma-separated hosts to read (default: every detected host)",
    "  --scans <dir>    Skip traversal and aggregate the *-signals.json files already in <dir>",
    "  --max <n>        Cap on sessions scanned (default: 60)",
    "  --skills-dir <d> Folder holding skill directories (default: skills/, then .agents/skills/)",
    "  --slug <s>       Run-folder slug (default: autoreflection-analysis)",
    "  --out <dir>      Write the report here instead of the run folder",
    "  --new-run        Mint a fresh run instead of joining the existing one",
    "  --help           Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    const hours = Number(args.hours ?? 24) || 24;
    const max = Number(args.max ?? 60) || 60;

    let scans = [];
    let hosts = [];
    let reportWarnings = [];
    let reportFailed = 0;
    if (typeof args.scans === "string") {
      const dir = path.resolve(args.scans);
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith(".signals.json") && !name.endsWith(".json")) continue;
        scans.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
      }
    } else {
      const scripts = siblingScripts();
      const listed = listWindow({ hours, host: args.host || null, scripts });
      hosts = listed.hosts;
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-analysis-"));
      const warnings = [];
      let failed = 0;
      try {
        for (const session of listed.sessions.slice(0, max)) {
          const safe = String(session.id).replace(/[^A-Za-z0-9._-]/g, "_");
          const out = path.join(workDir, `${session.host}--${safe}.signals.json`);
          try {
            scans.push(scanOne({ host: session.host, id: session.id, skillsDir: args["skills-dir"] || null, scripts, workDir, out, hours }));
          } catch (err) {
            failed++;
            if (warnings.length < 20) warnings.push({ session: `${session.host}:${session.id}`, reason: err.message.slice(0, 120) });
          }
        }
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      reportWarnings = warnings;
      reportFailed = failed;
    }

    const anchors = anchorsFor(scans, { scripts: siblingScripts() });
    const report = withAnchors(aggregate(scans, { hours }), anchors);
    if (anchors.error) report.notes.push(`retries and reading order unavailable: ${anchors.error}`);
    if (hosts.length) {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      report.window.since = since;
      report.window.until = new Date().toISOString();
      report.hosts = hosts;
    }
    if (reportFailed) report.stats.failed = reportFailed;
    if (reportWarnings.length) report.warnings = reportWarnings;

    const runDir = args.out
      ? path.resolve(args.out)
      : resolveRunDir(args.slug || "autoreflection-analysis", { fresh: args["new-run"] === true });
    const { jsonPath, mdPath } = writeReport(report, runDir);
    process.stdout.write(`${JSON.stringify({ json: jsonPath, md: mdPath, sessions: report.stats.sessions, findings: report.stats.findings, portfolio: report.stats.portfolio })}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

function parseArgs(args) {
  const out = { _: [], unknown: [] };
  const booleans = new Set(["new-run", "help"]);
  const known = new Set(["hours", "host", "scans", "max", "skills-dir", "slug", "out", "new-run", "help"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!known.has(key)) {
      out.unknown.push(key);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) i++;
    } else if (booleans.has(key)) {
      out[key] = true;
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      out[key] = args[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
