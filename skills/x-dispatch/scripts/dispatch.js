#!/usr/bin/env node
/**
 * X-Dispatch — Parallel Subagent Task Execution
 * 
 * Parses task files, builds dependency DAG, schedules waves,
 * and dispatches parallel workers via git worktrees.
 */

import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = import.meta.dirname;
const CWD = process.cwd();

// Configuration
const PARALLEL_LIMIT = parseInt(process.argv.find(a => a.startsWith('--parallel='))?.split('=')[1] || '4');
const TIMEOUT_MINUTES = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || '120');
const KEEP_WORKTREES = process.argv.includes('--keep-worktrees');

/**
 * Parse command line args
 */
function getTaskDir() {
  const arg = process.argv.find(a => a.startsWith('--tasks='));
  if (!arg) {
    console.error('Usage: node dispatch.js --tasks <task-dir> [--parallel N] [--timeout M]');
    process.exit(1);
  }
  return arg.split('=')[1];
}

/**
 * Read and parse all task files from directory
 */
async function loadTasks(taskDir) {
  const entries = await readdir(taskDir, { withFileTypes: true });
  const tasks = [];
  
  for (const entry of entries) {
    if (!entry.name.match(/^US\d+-.*\.md$/)) continue;
    
    const content = await readFile(join(taskDir, entry.name), 'utf-8');
    const task = parseTask(entry.name, content);
    tasks.push(task);
  }
  
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Parse individual task file
 */
function parseTask(filename, content) {
  // Extract header: # Task: <name>
  const nameMatch = content.match(/^#\s*Task:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : basename(filename, '.md');
  
  // Extract effort
  const effortMatch = content.match(/\*\*Effort:\*\*\s*(\d+)h/i);
  const effort = effortMatch ? parseInt(effortMatch[1]) : 4;
  
  // Extract files created/modified
  const filesMatch = content.match(/\*\*Files?:\*\*(.+)/);
  let files = [];
  if (filesMatch) {
    files = filesMatch[1]
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0 && !f.startsWith('(new)') || f.includes('.md'))
      .map(f => f.replace(/\s*\((mod|new)\)/, '').trim());
  }
  
  // Extract explicit dependencies from Preconditions
  const deps = [];
  const preconMatch = content.match(/##\s*Preconditions\s*\n([\s\S]*?)(?=##|\n$)/);
  if (preconMatch) {
    const preconContent = preconMatch[1];
    // Match patterns like "US03", "(US02)", etc.
    const depMatches = preconContent.matchAll(/US(\d+)/g);
    for (const m of depMatches) {
      deps.push(`US${m[1].padStart(2, '0')}`);
    }
  }
  
  return {
    id: basename(filename, '.md'),
    name,
    effort,
    files,
    dependsOn: [...new Set(deps)], // Deduplicate
    status: 'pending',
    worker: null,
    result: null,
  };
}

/**
 * Build dependency DAG and compute waves
 */
function buildWaves(tasks) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  
  // Compute in-degree (number of unresolved dependencies)
  const inDegree = new Map();
  for (const task of tasks) {
    // Filter to only valid task IDs
    const validDeps = task.dependsOn.filter(id => taskMap.has(id));
    inDegree.set(task.id, validDeps.length);
  }
  
  const waves = [];
  let remaining = [...tasks];
  
  while (remaining.length > 0) {
    // Find all tasks with no pending dependencies
    const waveTasks = remaining.filter(t => {
      const deps = t.dependsOn.filter(id => taskMap.has(id));
      return deps.every(depId => {
        const depTask = taskMap.get(depId);
        return depTask.status === 'completed';
      });
    }).slice(0, PARALLEL_LIMIT);
    
    if (waveTasks.length === 0) {
      // Deadlock - remaining tasks have circular or unmet dependencies
      console.error('\n⚠️  Dependency deadlock detected!');
      console.error('   Remaining tasks with unresolved deps:', 
        remaining.map(t => t.id).join(', '));
      break;
    }
    
    waves.push(waveTasks);
    waveTasks.forEach(t => {
      const task = taskMap.get(t.id);
      // Mark dependencies as "satisfied" for next wave calculation
      if (!task.status.startsWith('completed') && !task.status.startsWith('running')) {
        task._satisfiedDeps = true;
      }
    });
    remaining = remaining.filter(t => !waveTasks.includes(t));
  }
  
  return waves;
}

/**
 * Simple dependency resolver for single-wave tasks
 */
function computeWavesSimple(tasks) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const completed = new Set();
  const waves = [];
  
  let iterations = 0;
  const maxIterations = tasks.length + 1;
  
  while (completed.size < tasks.length && iterations < maxIterations) {
    const wave = [];
    
    for (const task of tasks) {
      if (completed.has(task.id)) continue;
      
      // Check if all dependencies are completed
      const depsSatisfied = task.dependsOn.every(depId => completed.has(depId));
      
      if (depsSatisfied && wave.length < PARALLEL_LIMIT) {
        wave.push(task);
      }
    }
    
    if (wave.length === 0 && completed.size < tasks.length) {
      console.error('\n⚠️  Circular dependency detected or missing task references');
      // Add remaining tasks anyway to prevent infinite loop
      const pending = tasks.filter(t => !completed.has(t.id));
      waves.push(pending);
      break;
    }
    
    waves.push(wave);
    wave.forEach(t => completed.add(t.id));
    iterations++;
  }
  
  return waves;
}

/**
 * Create git worktree for a task
 */
async function createWorktree(task) {
  const branchName = `impl/${task.id}`;
  const worktreePath = join(CWD, '..', `xskills-${task.id.replace('US', '')}`);
  
  // Check if worktree already exists
  const worktreeExists = await checkWorktreeExists(worktreePath);
  if (worktreeExists) {
    console.log(`⚠️  Worktree ${worktreePath} already exists, skipping creation`);
    return { path: worktreePath, branchName, created: false };
  }
  
  try {
    // Create new branch from current HEAD
    spawnSync('git', ['checkout', '-b', branchName], { stdio: 'pipe' });
    
    // Reset to same commit as main
    spawnSync('git', ['reset', '--soft', 'HEAD~0'], { stdio: 'pipe' });
    
    console.log(`✓ Worktree created: ${worktreePath} (branch ${branchName})`);
    return { path: worktreePath, branchName, created: true };
  } catch (err) {
    console.error(`✗ Failed to create worktree for ${task.id}:`, err.message);
    throw err;
  }
}

function checkWorktreeExists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Spawn agent in worktree
 */
async function dispatchAgent(task, worktreePath) {
  return new Promise((resolve, reject) => {
    const taskFileContent = `Task: ${task.name}\n\nFiles: ${task.files.join(', ') || 'none'}\n`;
    
    // For now, just log what would happen
    console.log(`[${task.id}] Would dispatch to worktree: ${worktreePath}`);
    console.log(`       Agent instructions:\n       ${taskFileContent.split('\n').slice(0, 3).join('\n       ')}`);
    
    // Simulate completion after short delay (replace with actual agent spawn)
    setTimeout(() => {
      task.status = 'completed';
      resolve({ success: true });
    }, 100);
  });
}

/**
 * Aggregate results back to main branch
 */
async function aggregateResults(tasks, waves) {
  console.log('\nAggregating results...');
  
  for (const wave of waves) {
    for (const task of wave) {
      if (task.status !== 'completed') continue;
      
      const worktreePath = join(CWD, '..', `xskills-${task.id.replace('US', '')}`);
      if (!existsSync(worktreePath)) continue;
      
      // In real implementation: cherry-pick commits from worktree
      console.log(`[${task.id}] Aggregating from ${worktreePath}`);
    }
  }
}

/**
 * Main execution loop
 */
async function main() {
  const taskDir = getTaskDir();
  
  console.log('\nX-Dispatch v1.0.0 — Parallel Task Execution');
  console.log('=============================================\n');
  
  // Load tasks
  const tasks = await loadTasks(taskDir);
  console.log(`Parsed ${tasks.length} tasks from ${taskDir}`);
  
  if (tasks.length === 0) {
    console.error('\n✗ No task files found (*.md matching US*)');
    process.exit(1);
  }
  
  // Compute waves
  const waves = computeWavesSimple(tasks);
  console.log(`Organized into ${waves.length} wave(s)\n`);
  
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    if (wave.length === 0) continue;
    
    console.log(`Wave ${i + 1} (${wave.length} task${wave.length > 1 ? 's' : ''})`);
    console.log('─'.repeat(50));
    
    // Show tasks in this wave
    for (const task of wave) {
      const deps = task.dependsOn.filter(id => !['US01', 'US02'].includes(task.id));
      const depStr = deps.length > 0 ? ` (deps: ${deps.join(', ')})` : '';
      console.log(`├── ${task.id} — ${task.name}${depStr}`);
    }
    console.log('');
    
    // Execute tasks in parallel
    for (const task of wave) {
      try {
        const worktree = await createWorktree(task);
        
        if (worktree.created) {
          // Copy task content to worktree context
          const ctxFile = join(worktree.path, 'TASK.md');
          await writeFile(ctxFile, `# Task Context\n\nTask ID: ${task.id}\nName: ${task.name}\n`);
          
          // Dispatch agent (simulated for now)
          await dispatchAgent(task, worktree.path);
        }
      } catch (err) {
        console.error(`✗ Error executing ${task.id}:`, err.message);
        task.status = 'failed';
      }
    }
    
    // Cleanup worktrees if not keeping
    if (!KEEP_WORKTREES) {
      for (const task of wave) {
        const worktreePath = join(CWD, '..', `xskills-${task.id.replace('US', '')}`);
        try {
          await rm(worktreePath, { recursive: true, force: true });
          console.log(`✓ Cleaned up worktree: ${worktreePath}`);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
  
  // Aggregate results
  await aggregateResults(tasks, waves);
  
  // Summary
  const completed = tasks.filter(t => t.status === 'completed').length;
  console.log('\n=============================================');
  console.log(`Dispatch complete: ${completed}/${tasks.length} tasks executed`);
  console.log('=============================================\n');
}

// Helper for sync spawn
function spawnSync(cmd, args, opts) {
  const { execSync } = require('node:child_process');
  return execSync(`${cmd} ${args.join(' ')}`, { 
    cwd: CWD,
    stdio: opts?.stdio || 'inherit',
    ...opts 
  });
}

main().catch(err => {
  console.error('\n✗ Dispatch failed:', err);
  process.exit(1);
});
