#!/usr/bin/env node
/**
 * Generate a Codex/Claude investigation packet from a runtime issue file.
 *
 * Usage:
 *   node scripts/generate-codex-investigation-packet.mjs --issue-id runtime-issue-1745123456789-abc123
 *   node scripts/generate-codex-investigation-packet.mjs --issue-id ... --send
 *   node scripts/generate-codex-investigation-packet.mjs --issue-id ... --dry-run
 *
 * --send:    call Claude API and print the diagnosis
 * --dry-run: print packet JSON only, no API call
 */

import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { getFilesForIssue } from './_shared/surface-route-map.mjs';

const RUNTIME_ISSUES_DIR = path.resolve('data', 'runtime-issues');
const BACKFILL_LOGS_DIR  = path.resolve('data', 'backfill-logs');
const AUTOMATION_DIR     = path.resolve('data', 'automation');

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const issueId = getArg('--issue-id');
const sendToApi = args.includes('--send');
const dryRun    = args.includes('--dry-run');

if (!issueId) {
  console.error('Usage: node scripts/generate-codex-investigation-packet.mjs --issue-id <id> [--send] [--dry-run]');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeReadLines(filePath, head = 100, tail = 50) {
  try {
    if (!existsSync(filePath)) return { head: null, tail: null, error: `file not found: ${filePath}` };
    const lines = readFileSync(filePath, 'utf8').split('\n');
    return {
      head: lines.slice(0, head).join('\n').slice(0, 5000),
      tail: lines.slice(-tail).join('\n').slice(0, 5000),
      error: null,
    };
  } catch (err) {
    return { head: null, tail: null, error: String(err?.message || err) };
  }
}

function findIssueFile(id) {
  if (!existsSync(RUNTIME_ISSUES_DIR)) return null;
  for (const dateDir of readdirSync(RUNTIME_ISSUES_DIR).sort().reverse()) {
    const full = path.join(RUNTIME_ISSUES_DIR, dateDir);
    try {
      for (const f of readdirSync(full)) {
        if (!f.endsWith('.json') || f.startsWith('investigation-')) continue;
        const fp = path.join(full, f);
        try {
          const data = JSON.parse(readFileSync(fp, 'utf8'));
          if (data.id === id) return { filePath: fp, issue: data };
        } catch {}
      }
    } catch {}
  }
  return null;
}

function getServerLog(maxLines = 80) {
  for (const dir of [BACKFILL_LOGS_DIR, AUTOMATION_DIR]) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.log') || f.endsWith('.err'))
        .map(f => ({ name: f, fp: path.join(dir, f) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .reverse();
      if (files.length > 0) {
        const lines = readFileSync(files[0].fp, 'utf8').split('\n');
        return lines.slice(-maxLines).join('\n').slice(0, 8000);
      }
    } catch {}
  }
  return '(no server log found)';
}

function buildReproSteps(issue) {
  return [
    `Navigate to surface: ${issue.surface || 'unknown'}`,
    `Select item of type: ${issue.itemType || 'unknown'} / ${issue.itemSubtype || 'unknown'}`,
    `Click action: ${issue.action || 'unknown'}`,
    `API called: ${issue.apiRoute || 'unknown'} → HTTP ${issue.responseStatus || 'unknown'}`,
    `Error observed: ${issue.errorMessage || 'none'}`,
  ];
}

function buildClaudePrompt(issue, reproSteps, sourceFiles) {
  const fileList = sourceFiles.map(f => `- ${f.path}${f.error ? ` (${f.error})` : ''}`).join('\n');
  const stepsText = reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const autoFixNote = issue.safeRemediation === false
    ? 'Automatic fix is NOT allowed for this issue.'
    : 'This issue may be eligible for a Class A automatic fix.';

  return `You are diagnosing a runtime issue in the Lattice Current project, a news-event-to-asset-reaction analysis platform.

Issue ID: ${issue.id}
Surface: ${issue.surface || 'unknown'}
Action taken by operator: ${issue.action || 'unknown'}
Item type: ${issue.itemType || 'unknown'} / ${issue.itemSubtype || 'unknown'}
API route called: ${issue.apiRoute || 'unknown'}
HTTP response status: ${issue.responseStatus || 'unknown'}
Error message observed: ${issue.errorMessage || 'none'}
Classification: ${issue.classification || 'unknown'}
${autoFixNote}

Reproduction steps:
${stepsText}

The following source files are likely involved (file heads and tails are included below):
${fileList}

${sourceFiles.map(f => f.error ? `\n--- ${f.path} ---\n(${f.error})\n` : `\n--- ${f.path} (head) ---\n${f.head || ''}\n\n--- ${f.path} (tail) ---\n${f.tail || ''}\n`).join('')}

Last lines of the server process log:
${getServerLog()}

Your task:
1. Diagnose the root cause of this failure. Be specific about which file and line is responsible.
2. Propose a concrete fix. Write the exact code change (before → after) with surrounding context (5 lines each side).
3. State whether the fix is:
   - Class A (safe to apply automatically): pure UI badge/label changes, adding a null guard, logging improvement.
   - Class B (requires human review): API response shape change, executor logic change, schema change.
   - Class C (must never be auto-applied): anything that touches approval execution, source registration, DB destructive writes.
4. If classification is 'external-dependency', do not propose code changes. Instead propose a retry policy or source quality flag change.

Do NOT propose changes beyond the minimal fix for this specific issue. Do NOT refactor surrounding code. Do NOT add unrelated tests or comments.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const found = findIssueFile(issueId);
if (!found) {
  console.error(`Issue not found: ${issueId}`);
  console.error(`Searched in: ${RUNTIME_ISSUES_DIR}`);
  process.exit(1);
}

const { filePath: issueFilePath, issue } = found;
console.error(`Found issue: ${issueFilePath}`);

// Collect relevant files
const relevantPaths = getFilesForIssue(issue);
const sourceFiles = relevantPaths.map(relPath => {
  const absPath = path.resolve(relPath);
  const read = safeReadLines(absPath, 100, 50);
  return { path: relPath, ...read };
});

// Build packet
const reproSteps = buildReproSteps(issue);
const claudePrompt = buildClaudePrompt(issue, reproSteps, sourceFiles);

const packet = {
  packetVersion: '1',
  generatedAt: new Date().toISOString(),
  issueId: issue.id,
  issue,
  reproductionSteps: reproSteps,
  serverLog: getServerLog(),
  sourceFiles: sourceFiles.map(f => ({
    path: f.path,
    head: f.head,
    tail: f.tail,
    error: f.error,
  })),
  claudePrompt,
};

if (dryRun || !sendToApi) {
  console.log(JSON.stringify(packet, null, 2));
  if (!sendToApi) process.exit(0);
}

// Send to Claude API
console.error('\nSending to Claude API…');
const Anthropic = (await import('@anthropic-ai/sdk')).default;
const client = new Anthropic();
const model = process.env.CODEX_MODEL || 'claude-opus-4-6';

const message = await client.messages.create({
  model,
  max_tokens: 4096,
  messages: [{ role: 'user', content: claudePrompt }],
});

const responseText = message.content.map(b => b.type === 'text' ? b.text : '').join('');
console.log('\n── Claude Diagnosis ──────────────────────────────────────\n');
console.log(responseText);

// Save investigation file
const todayStr = new Date().toISOString().slice(0, 10);
const investigationDir = path.join(RUNTIME_ISSUES_DIR, todayStr);
if (!existsSync(investigationDir)) mkdirSync(investigationDir, { recursive: true });
const investigationPath = path.join(investigationDir, `investigation-${issue.id}.json`);
writeFileSync(investigationPath, JSON.stringify({ packet, claudeResponse: responseText }, null, 2));
console.error(`\nInvestigation saved: ${investigationPath}`);
