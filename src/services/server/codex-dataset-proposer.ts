import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { DatasetProposal, DatasetDiscoveryThemeInput } from '../dataset-discovery';
import type { ProposalEvidenceBundle } from './proposal-evidence-builder';

interface CodexExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const CODEX_TIMEOUT_MS = 95_000;

function buildExecArgs(prompt: string): string[] {
  const args = ['exec'];
  if (process.env.CODEX_MODEL?.trim()) args.push('--model', process.env.CODEX_MODEL.trim());
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--full-auto', prompt);
  return args;
}

function getSafeEnv(): NodeJS.ProcessEnv {
  const keys = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'CODEX_HOME', 'HTTPS_PROXY',
    'HTTP_PROXY', 'NO_PROXY', 'LANG', 'TERM', 'CODEX_MODEL', 'CODEX_BIN',
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function isCodexLoggedIn(outputText: string): boolean {
  return /logged in/i.test(String(outputText || ''));
}

async function resolveCodexCommand(): Promise<string> {
  if (process.env.CODEX_BIN?.trim() && existsSync(process.env.CODEX_BIN.trim())) return process.env.CODEX_BIN.trim();
  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');
  const candidates = [
    path.join(localAppData, 'Programs', 'OpenAI', 'codex', 'codex.exe'),
    path.join(appData, 'npm', 'codex.cmd'),
    path.join(appData, 'npm', 'codex'),
  ];
  const vscodeExtRoot = path.join(userHome, '.vscode', 'extensions');
  if (existsSync(vscodeExtRoot)) {
    try {
      const entries = await readdir(vscodeExtRoot, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith('openai.chatgpt-')).sort((a, b) => b.name.localeCompare(a.name))) {
        candidates.unshift(path.join(vscodeExtRoot, entry.name, 'bin', 'windows-x86_64', 'codex.exe'));
      }
    } catch {
      // ignore
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) || 'codex';
}

async function runCodexCli(args: string[], timeoutMs = CODEX_TIMEOUT_MS): Promise<CodexExecResult> {
  const command = await resolveCodexCommand();
  // If the last argument (prompt) is very long, pipe it via stdin instead
  const lastArg = args.length > 0 ? args[args.length - 1] ?? '' : '';
  const usePipedPrompt = lastArg.length > 6000;
  const spawnArgs = usePipedPrompt ? args.slice(0, -1) : args;
  return new Promise((resolve) => {
    const child = spawn(command, spawnArgs, {
      cwd: process.cwd(),
      env: getSafeEnv(),
      stdio: [usePipedPrompt ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    if (usePipedPrompt) {
      child.stdin?.write(lastArg);
      child.stdin?.end();
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code ?? 1), stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
  });
}

function parseCodexJsonOutput(stdout: string): string {
  let lastAgentMessage = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'item.completed' && parsed?.item?.type === 'agent_message' && typeof parsed.item.text === 'string') {
        lastAgentMessage = parsed.item.text.trim();
      }
    } catch {
      // ignore
    }
  }
  return lastAgentMessage;
}

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        const parsed = JSON.parse(fenced[1].trim());
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPrompt(theme: DatasetDiscoveryThemeInput, evidence?: ProposalEvidenceBundle | null): string {
  return [
    'You are a historical dataset planner for macro and geopolitical replay.',
    'Return strict JSON only. No markdown.',
    'Use only providers: fred, alfred, gdelt-doc, coingecko, acled.',
    'JSON schema:',
    '{ "proposals": [ { "id": "...", "label": "...", "provider": "gdelt-doc", "confidence": 0-100, "rationale": "...", "querySummary": "...", "fetchArgs": { } } ] }',
    `Theme: ${theme.label}`,
    `Triggers: ${theme.triggers.join(', ') || '(none)'}`,
    `Sectors: ${theme.sectors.join(', ') || '(none)'}`,
    `Commodities: ${theme.commodities.join(', ') || '(none)'}`,
    `Headlines: ${(theme.supportingHeadlines || []).slice(0, 4).join(' || ') || '(none)'}`,
    `Suggested symbols: ${(theme.suggestedSymbols || []).join(', ') || '(none)'}`,
    evidence?.summary ? `Evidence summary: ${evidence.summary}` : '',
    evidence?.historicalAnalogs?.length
      ? `Historical analogs:\n${evidence.historicalAnalogs.map((row) => `- ${row}`).join('\n')}`
      : '',
    evidence?.weaknessSignals?.length
      ? `Weakness signals:\n${evidence.weaknessSignals.map((row) => `- ${row}`).join('\n')}`
      : '',
    evidence?.coverageSignals?.length
      ? `Coverage signals:\n${evidence.coverageSignals.map((row) => `- ${row}`).join('\n')}`
      : '',
  ].join('\n');
}

export async function proposeDatasetsWithCodex(
  theme: DatasetDiscoveryThemeInput,
  evidence?: ProposalEvidenceBundle | null,
): Promise<DatasetProposal[] | null> {
  const loginStatus = await runCodexCli(['login', 'status'], 8_000);
  if (loginStatus.code !== 0 || !isCodexLoggedIn(`${loginStatus.stdout}\n${loginStatus.stderr}`)) return null;
  const result = await runCodexCli(buildExecArgs(buildPrompt(theme, evidence)), CODEX_TIMEOUT_MS);
  if (result.code !== 0) return null;
  const parsed = parseJsonObject(parseCodexJsonOutput(result.stdout || '') || result.stdout);
  if (!parsed || !Array.isArray(parsed.proposals)) return null;
  return parsed.proposals.map((row) => ({
    id: String((row as Record<string, unknown>).id || '').trim(),
    label: String((row as Record<string, unknown>).label || '').trim(),
    provider: String((row as Record<string, unknown>).provider || '').trim() as DatasetProposal['provider'],
    proposedBy: 'codex' as const,
    confidence: Math.max(25, Math.min(95, Math.round(Number((row as Record<string, unknown>).confidence) || 60))),
    proposalScore: Math.max(25, Math.min(99, Math.round(Number((row as Record<string, unknown>).confidence) || 60))),
    rationale: String((row as Record<string, unknown>).rationale || 'Codex dataset proposal').trim(),
    querySummary: String((row as Record<string, unknown>).querySummary || '').trim(),
    sourceThemeId: theme.themeId,
    fetchArgs: ((row as Record<string, unknown>).fetchArgs || {}) as Record<string, string | number | boolean>,
    pitSafety: 'medium' as const,
    estimatedCost: 'medium' as const,
    autoRegister: false,
    autoEnable: false,
  })).filter((proposal) => proposal.id && proposal.label && proposal.provider);
}
