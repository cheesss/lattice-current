import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type {
  CodexCandidateExpansionProposal,
  DirectAssetMapping,
  InvestmentThemeDefinition,
  UniverseCoverageGap,
} from '../investment-intelligence';

interface CodexExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const CODEX_TIMEOUT_MS = 95_000;

function buildExecArgs(prompt: string): string[] {
  const args = ['exec'];
  if (process.env.CODEX_MODEL?.trim()) {
    args.push('--model', process.env.CODEX_MODEL.trim());
  }
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--ask-for-approval', 'never', prompt);
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
  for (const key of keys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function splitWindowsPath(pathValue: string | undefined): string[] {
  if (!pathValue || typeof pathValue !== 'string') return [];
  return pathValue.split(';').map((item) => item.trim()).filter(Boolean);
}

function pushPathUnique(buffer: string[], entry: string | null | undefined): void {
  if (!entry || typeof entry !== 'string') return;
  const trimmed = entry.trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();
  if (buffer.some((item) => item.toLowerCase() === lower)) return;
  buffer.push(trimmed);
}

function isWindowsAppsAliasPath(candidate: string): boolean {
  return /[\\/]windowsapps[\\/]/i.test(String(candidate || ''));
}

function withCodexPathHints(env: NodeJS.ProcessEnv, codexCommand: string): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return env;
  const merged: string[] = [];
  for (const existing of splitWindowsPath(env.PATH || env.Path || process.env.PATH || process.env.Path || '')) {
    pushPathUnique(merged, existing);
  }
  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  pushPathUnique(merged, path.join(appData, 'npm'));
  if (codexCommand && codexCommand !== 'codex') {
    pushPathUnique(merged, path.dirname(codexCommand));
  }
  const mergedPath = merged.join(';');
  if (mergedPath) {
    env.PATH = mergedPath;
    env.Path = mergedPath;
  }
  return env;
}

function isCodexLoggedIn(outputText: string): boolean {
  return /logged in/i.test(String(outputText || ''));
}

async function resolveCodexCommand(): Promise<string> {
  const fromEnv = (process.env.CODEX_BIN || '').trim();
  if (fromEnv && existsSync(fromEnv) && !isWindowsAppsAliasPath(fromEnv)) {
    return fromEnv;
  }
  const userHome = process.env.USERPROFILE || os.homedir();
  const appData = process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local');
  const codexHome = (process.env.CODEX_HOME || path.join(userHome, '.codex')).trim();
  const candidates = [
    path.join(codexHome, '.sandbox-bin', 'codex.exe'),
    path.join(userHome, '.codex', '.sandbox-bin', 'codex.exe'),
    path.join(localAppData, 'Programs', 'OpenAI', 'codex', 'codex.exe'),
    path.join(appData, 'npm', 'codex.cmd'),
    path.join(appData, 'npm', 'codex'),
  ];
  const vscodeExtRoot = path.join(userHome, '.vscode', 'extensions');
  if (existsSync(vscodeExtRoot)) {
    try {
      const entries = await readdir(vscodeExtRoot, { withFileTypes: true });
      for (const entry of entries
        .filter((item) => item.isDirectory() && item.name.startsWith('openai.chatgpt-'))
        .sort((a, b) => b.name.localeCompare(a.name))) {
        candidates.unshift(path.join(vscodeExtRoot, entry.name, 'bin', 'windows-x86_64', 'codex.exe'));
      }
    } catch {
      // ignore
    }
  }
  return candidates.find((candidate) => existsSync(candidate) && !isWindowsAppsAliasPath(candidate)) || 'codex';
}

async function runCodexCli(args: string[], timeoutMs = CODEX_TIMEOUT_MS): Promise<CodexExecResult> {
  const command = await resolveCodexCommand();
  const env = withCodexPathHints(getSafeEnv(), command);
  const useShell = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: useShell,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
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

function buildCandidatePrompt(input: {
  theme: InvestmentThemeDefinition;
  gaps: UniverseCoverageGap[];
  topMappings: DirectAssetMapping[];
}): string {
  const gapRows = input.gaps
    .slice(0, 5)
    .map((gap) => `- ${gap.severity}: missing kinds=${gap.missingAssetKinds.join(', ') || '(none)'} missing sectors=${gap.missingSectors.join(', ') || '(none)'} suggested=${gap.suggestedSymbols.join(', ') || '(none)'}`)
    .join('\n');
  const mappingRows = input.topMappings
    .slice(0, 8)
    .map((mapping) => `- ${mapping.symbol} ${mapping.direction} ${mapping.role} conviction=${mapping.conviction} sector=${mapping.sector} commodity=${mapping.commodity || '-'} reasons=${mapping.reasons.slice(0, 3).join(' | ')}`)
    .join('\n');
  const existingSymbols = input.theme.assets.map((asset) => asset.symbol).join(', ');

  return [
    'You are a candidate-expansion planner for macro and geopolitical investment intelligence.',
    'Return strict JSON only. No markdown.',
    'Propose liquid, backtestable additional candidates for the given theme.',
    'Do not repeat existing symbols.',
    'Only use asset kinds: etf, equity, commodity, fx, rate, crypto.',
    'Prefer liquid ETFs or large liquid equities unless the gap strongly requires otherwise.',
    'JSON schema:',
    '{',
    '  "proposals": [',
    '    {',
    '      "symbol": "XLE",',
    '      "assetName": "Energy Select Sector SPDR",',
    '      "assetKind": "etf",',
    '      "sector": "energy",',
    '      "commodity": "crude oil",',
    '      "direction": "long",',
    '      "role": "primary",',
    '      "confidence": 0-100,',
    '      "reason": "one sentence",',
    '      "supportingSignals": ["...", "..."]',
    '    }',
    '  ]',
    '}',
    `Theme id: ${input.theme.id}`,
    `Theme label: ${input.theme.label}`,
    `Timeframe: ${input.theme.timeframe}`,
    `Thesis: ${input.theme.thesis}`,
    `Triggers: ${input.theme.triggers.join(', ') || '(none)'}`,
    `Sectors: ${input.theme.sectors.join(', ') || '(none)'}`,
    `Commodities: ${input.theme.commodities.join(', ') || '(none)'}`,
    `Invalidation: ${input.theme.invalidation.join(' | ') || '(none)'}`,
    `Existing symbols: ${existingSymbols || '(none)'}`,
    'Coverage gaps:',
    gapRows || '(none)',
    'Top current mappings:',
    mappingRows || '(none)',
  ].join('\n');
}

function normalizeAssetKind(value: unknown): CodexCandidateExpansionProposal['assetKind'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'equity' || normalized === 'commodity' || normalized === 'fx' || normalized === 'rate' || normalized === 'crypto') {
    return normalized;
  }
  return 'etf';
}

function normalizeDirection(value: unknown): CodexCandidateExpansionProposal['direction'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'short' || normalized === 'hedge' || normalized === 'watch' || normalized === 'pair') {
    return normalized;
  }
  return 'long';
}

function normalizeRole(value: unknown): CodexCandidateExpansionProposal['role'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'confirm' || normalized === 'hedge') return normalized;
  return 'primary';
}

function normalizeProposals(raw: unknown): CodexCandidateExpansionProposal[] {
  return Array.isArray(raw)
    ? raw
      .map((proposal) => ({
        symbol: String((proposal as Record<string, unknown>).symbol || '').trim().toUpperCase(),
        assetName: String((proposal as Record<string, unknown>).assetName || (proposal as Record<string, unknown>).symbol || '').trim(),
        assetKind: normalizeAssetKind((proposal as Record<string, unknown>).assetKind),
        sector: String((proposal as Record<string, unknown>).sector || 'cross-asset').trim().toLowerCase() || 'cross-asset',
        commodity: (proposal as Record<string, unknown>).commodity ? String((proposal as Record<string, unknown>).commodity).trim().toLowerCase() : null,
        direction: normalizeDirection((proposal as Record<string, unknown>).direction),
        role: normalizeRole((proposal as Record<string, unknown>).role),
        confidence: Math.max(25, Math.min(95, Math.round(Number((proposal as Record<string, unknown>).confidence) || 62))),
        reason: String((proposal as Record<string, unknown>).reason || 'Codex candidate proposal').trim().slice(0, 280),
        supportingSignals: Array.isArray((proposal as Record<string, unknown>).supportingSignals)
          ? ((proposal as Record<string, unknown>).supportingSignals as unknown[]).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
          : [],
      }))
      .filter((proposal) => proposal.symbol)
      .slice(0, 10)
    : [];
}

export async function proposeCandidatesWithCodex(input: {
  theme: InvestmentThemeDefinition;
  gaps: UniverseCoverageGap[];
  topMappings: DirectAssetMapping[];
}): Promise<CodexCandidateExpansionProposal[] | null> {
  const loginStatus = await runCodexCli(['login', 'status'], 8_000);
  if (loginStatus.code !== 0 || !isCodexLoggedIn(`${loginStatus.stdout}\n${loginStatus.stderr}`)) {
    return null;
  }
  const prompt = buildCandidatePrompt(input);
  const result = await runCodexCli(buildExecArgs(prompt), CODEX_TIMEOUT_MS);
  if (result.code !== 0) return null;
  const message = parseCodexJsonOutput(result.stdout || '');
  const parsed = parseJsonObject(message);
  if (!parsed) return null;
  return normalizeProposals(parsed.proposals);
}
