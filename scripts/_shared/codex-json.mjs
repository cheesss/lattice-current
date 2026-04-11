import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const CODEX_PROMPT_METRICS_PATH = path.resolve('data', 'codex-prompt-metrics.json');

function getSafeEnv() {
  const keys = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'CODEX_HOME', 'HTTPS_PROXY',
    'HTTP_PROXY', 'NO_PROXY', 'LANG', 'TERM', 'CODEX_MODEL', 'CODEX_BIN',
  ];
  const env = {};
  for (const key of keys) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function resolveCodexCommand() {
  if (process.env.CODEX_BIN?.trim() && existsSync(process.env.CODEX_BIN.trim())) {
    return process.env.CODEX_BIN.trim();
  }
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
      for (const entry of entries
        .filter((item) => item.isDirectory() && item.name.startsWith('openai.chatgpt-'))
        .sort((left, right) => right.name.localeCompare(left.name))) {
        candidates.unshift(path.join(vscodeExtRoot, entry.name, 'bin', 'windows-x86_64', 'codex.exe'));
      }
    } catch {
      // Ignore discovery failures.
    }
  }
  return candidates.find((candidate) => existsSync(candidate)) || 'codex';
}

function parseCodexJsonOutput(stdout) {
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

export function parseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        const parsed = JSON.parse(fenced[1].trim());
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function loadPromptMetrics() {
  try {
    const raw = await readFile(CODEX_PROMPT_METRICS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { prompts: {}, history: [] };
  } catch {
    return { prompts: {}, history: [] };
  }
}

async function persistPromptMetrics(metrics) {
  await mkdir(path.dirname(CODEX_PROMPT_METRICS_PATH), { recursive: true });
  await writeFile(CODEX_PROMPT_METRICS_PATH, JSON.stringify(metrics, null, 2));
}

async function recordPromptMetric(meta, result, durationMs) {
  const label = String(meta?.label || 'unlabeled').trim() || 'unlabeled';
  const metrics = await loadPromptMetrics();
  const prompts = metrics.prompts || {};
  const promptEntry = prompts[label] || {
    label,
    totalCalls: 0,
    successCount: 0,
    parseSuccessCount: 0,
    parseFailCount: 0,
    timeoutCount: 0,
    avgDurationMs: 0,
    lastDurationMs: 0,
    lastCode: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: '',
  };
  promptEntry.totalCalls += 1;
  if (result.code === 0) promptEntry.successCount += 1;
  if (result.parsed) promptEntry.parseSuccessCount += 1;
  else promptEntry.parseFailCount += 1;
  const stderrText = String(result.stderr || result.message || '').toLowerCase();
  const timedOut = result.code !== 0 && (stderrText.includes('timed out') || stderrText.includes('timeout'));
  if (timedOut) promptEntry.timeoutCount += 1;
  promptEntry.lastDurationMs = durationMs;
  promptEntry.avgDurationMs = Number((((promptEntry.avgDurationMs * (promptEntry.totalCalls - 1)) + durationMs) / promptEntry.totalCalls).toFixed(2));
  promptEntry.lastCode = result.code;
  if (result.code === 0 && result.parsed) {
    promptEntry.lastSuccessAt = new Date().toISOString();
    promptEntry.lastError = '';
  } else {
    promptEntry.lastFailureAt = new Date().toISOString();
    promptEntry.lastError = String(result.stderr || result.message || '').slice(0, 240);
  }
  prompts[label] = promptEntry;
  const history = Array.isArray(metrics.history) ? metrics.history : [];
  history.unshift({
    at: new Date().toISOString(),
    label,
    code: result.code,
    parsed: Boolean(result.parsed),
    durationMs,
    stderr: String(result.stderr || result.message || '').slice(0, 240),
  });
  metrics.prompts = prompts;
  metrics.history = history.slice(0, 120);
  await persistPromptMetrics(metrics);
}

export async function runCodexJsonPrompt(prompt, timeoutMs = 95_000, meta = {}) {
  const command = await resolveCodexCommand();
  const args = ['exec'];
  if (process.env.CODEX_MODEL?.trim()) {
    args.push('--model', process.env.CODEX_MODEL.trim());
  }
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--full-auto');

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: getSafeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdin?.write(String(prompt || ''));
    child.stdin?.end();
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const message = parseCodexJsonOutput(stdout) || stdout;
      const result = {
        code: Number(code ?? 1),
        stdout,
        stderr,
        message,
        parsed: parseJsonObject(message),
      };
      const durationMs = Date.now() - startedAt;
      recordPromptMetric(meta, result, durationMs).catch(() => {});
      resolve(result);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      const result = {
        code: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        message: '',
        parsed: null,
      };
      const durationMs = Date.now() - startedAt;
      recordPromptMetric(meta, result, durationMs).catch(() => {});
      resolve(result);
    });
  });
}
