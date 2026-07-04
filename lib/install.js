"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

/**
 * Find the nearest .agents/skills/ directory, or create it.
 * Returns the absolute path to .agents/skills/.
 */
async function findOrCreateAgentSkillsDir(startDir) {
  const skillsDir = path.join(startDir, ".agents", "skills");

  if (await dirExists(skillsDir)) {
    return skillsDir;
  }

  // Create .agents/skills/ hierarchy
  await fsp.mkdir(skillsDir, { recursive: true });
  console.log(`Created ${path.relative(process.cwd(), skillsDir) || skillsDir}`);

  return skillsDir;
}

function ensureSkillExists(skillName) {
  const sourceSkill = resolveSkillSource(skillName);
  if (!sourceSkill) {
    console.error(`Skill "${skillName}" not found.`);
    console.error("Run 'xskills list' to see available skills.");
    process.exit(1);
  }
  return sourceSkill;
}

/**
 * Install a skill into the current project's .agents/skills/.
 */
async function install(skillName) {
  const sourceSkill = ensureSkillExists(skillName);
  const targetDir = await findOrCreateAgentSkillsDir(process.cwd());

  // Check for conflicts
  const targetPath = path.join(targetDir, skillName);
  if (await dirExists(targetPath)) {
    console.log(`Skill "${skillName}" is already installed.`);
    return;
  }

  // Copy skill directory (preserving structure: SKILL.md, scripts/, references/, assets/)
  await copyDir(sourceSkill, targetPath);
  console.log(`Installed "${skillName}" into .agents/skills/${skillName}/`);
}

async function globalInstall(skillName) {
  const sourceSkill = ensureSkillExists(skillName);

  const globalDir = path.join(os.homedir(), ".agents", "skills");
  if (!(await dirExists(globalDir))) {
    await fsp.mkdir(globalDir, { recursive: true });
    console.log(`Created ${globalDir}`);
  }

  const targetPath = path.join(globalDir, skillName);
  if (await dirExists(targetPath)) {
    console.log(`Skill "${skillName}" is already installed globally.`);
    return;
  }

  await copyDir(sourceSkill, targetPath);
  console.log(`Installed "${skillName}" globally into ~/.agents/skills/${skillName}/`);
}

async function listSkills() {
  const skillsDir = path.join(__dirname, "..", "skills");

  if (!(await dirExists(skillsDir))) {
    console.error("No skills found.");
    return;
  }

  const skills = await readSkills(skillsDir);
  if (skills.length === 0) {
    console.log("No skills available yet.");
    return;
  }

  console.log(formatSkillTable(skills));
}

/**
 * Format skill metadata into display strings.
 */
function formatSkillTable(skills) {
  const nameWidth = Math.max(...skills.map((s) => s.name.length));
  const lines = [];
  for (const skill of skills) {
    const tags = [];
    if (skill.hasScripts) tags.push("scripts");
    if (skill.hasRefs) tags.push("refs");
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    lines.push(`  ${skill.name.padEnd(nameWidth)}  ${skill.description}${tagStr}`);
  }

  lines.push("");
  lines.push(`Install: xskills install <name>`);
  lines.push(`Global:  xskills install <name> --global`);
  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

async function dirExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p) {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Copy a directory recursively (preserving structure).
 */
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });

  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Resolve a skill name to its source directory within the package.
 */
function resolveSkillSource(skillName) {
  const skillPath = path.join(__dirname, "..", "skills", skillName);
  return dirExists(skillPath) ? skillPath : null;
}

/**
 * Read all skills from a directory, returning their metadata.
 */
async function readSkills(skillsDir) {
  const entries = await fsp.readdir(skillsDir, { withFileTypes: true });

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name);
    const skillMd = path.join(skillPath, "SKILL.md");
    if (!(await fileExists(skillMd))) continue;

    const content = await fsp.readFile(skillMd, "utf-8");
    const description = extractDescription(content);
    const subItems = await countSubItems(skillPath);
    skills.push({ name: entry.name, description, ...subItems });
  }

  return skills;
}

/**
 * Extract the description from SKILL.md YAML frontmatter.
 *
 * Expected frontmatter schema (parsed by simple regex, no YAML library):
 *   ---
 *   name: <skill-name>
 *   description: <single-line string>
 *   version: <semver>
 *   author: <string>
 *   tags: [comma, separated, tags]
 *   user-invocable: true|false
 *   ---
 *
 * Only top-level scalar fields are supported. Nested objects or multi-line
 * values will not be parsed correctly — keep frontmatter flat and simple.
 */
function extractDescription(content) {
  const match = content.match(/^description:\s*(.+?)\s*$/m);
  if (match) return match[1].trim();

  // Try finding heading after YAML frontmatter separator
  const found = findContentAfterFrontmatter(content);
  if (found) return found;

  // Fallback: find first markdown heading in the content
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  return "(no description)";
}

/**
 * Find the line index immediately after the closing --- of YAML frontmatter.
 * Returns null if no valid frontmatter block is found.
 */
function detectFrontmatterBoundary(lines) {
  let state = 0; // 0=opening---, 1=inside FM, 2=post-FM

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (state === 0 && trimmed === "---") { state = 1; continue; }
    if (state === 1 && trimmed === "---")   { return i + 1; }
  }

  return null;
}

/**
 * Extract description text from markdown content, skipping YAML frontmatter.
 */
function findContentAfterFrontmatter(content) {
  const lines = content.split("\n");
  const postFmIndex = detectFrontmatterBoundary(lines);
  if (postFmIndex === null) return null;

  for (let i = postFmIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed) return formatDescriptionFromHeading(trimmed);
  }

  return null;
}

/**
 * Strip markdown heading markers from a line.
 */
function formatDescriptionFromHeading(text) {
  return text.startsWith("#") ? text.replace(/^#+\s*/, "") : text;
}

/**
 * Check which subdirectories exist in a skill folder.
 */
async function countSubItems(skillDir) {
  let hasScripts = false;
  let hasRefs = false;

  try {
    const entries = await fsp.readdir(skillDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === "scripts") hasScripts = true;
      if (e.name === "references") hasRefs = true;
    }
  } catch {
    // ignore
  }

  return { hasScripts, hasRefs };
}

module.exports = {
  install,
  globalInstall,
  listSkills,
  extractDescription,
  formatDescriptionFromHeading,
  findContentAfterFrontmatter,
};
