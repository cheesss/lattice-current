import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const CODEX_PROMPT_METRICS_PATH = path.resolve('data', 'codex-prompt-metrics.json');

export function getSafeEnv(overrides = {}) {
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
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null) delete env[key];
    else env[key] = String(value);
  }
  return env;
}

export async function resolveCodexCommand() {
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
  const bundledCodexBinRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
  if (existsSync(bundledCodexBinRoot)) {
    try {
      const entries = await readdir(bundledCodexBinRoot, { withFileTypes: true });
      for (const entry of entries
        .filter((item) => item.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))) {
        candidates.unshift(path.join(bundledCodexBinRoot, entry.name, 'codex.exe'));
      }
    } catch {
      // Ignore bundled desktop CLI discovery failures.
    }
  }
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
      if (parsed?.type === 'message' && typeof parsed.message === 'string') {
        lastAgentMessage = parsed.message.trim();
      }
      if (parsed?.type === 'response.completed' && typeof parsed.response?.output_text === 'string') {
        lastAgentMessage = parsed.response.output_text.trim();
      }
    } catch {
      // ignore
    }
  }
  return lastAgentMessage;
}

function parseBalancedJsonObject(text) {
  const source = String(text || '');
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
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
        const repaired = parseBalancedJsonObject(fenced[1]);
        if (repaired) return repaired;
      }
    }
    const balanced = parseBalancedJsonObject(text);
    if (balanced) return balanced;
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

function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try { child.kill('SIGKILL'); } catch {}
      });
      return;
    } catch {
      // Fall through to the portable kill path.
    }
  }
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { child.kill('SIGKILL'); } catch {}
  }, 1500).unref?.();
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
    lastModel: null,
    lastFailureKind: null,
    lastAttemptCount: 0,
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
  promptEntry.lastModel = result.model || null;
  promptEntry.lastFailureKind = result.failureKind || null;
  promptEntry.lastAttemptCount = Number(result.attempts?.length || 1);
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
    model: result.model || null,
    failureKind: result.failureKind || null,
    attempts: Number(result.attempts?.length || 1),
    stderr: String(result.stderr || result.message || '').slice(0, 240),
  });
  metrics.prompts = prompts;
  metrics.history = history.slice(0, 120);
  await persistPromptMetrics(metrics);
}

async function runCodexJsonPromptLegacy(prompt, timeoutMs = 95_000, meta = {}) {
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
    let oversized = false;
    // Cap accumulated output to keep heap bounded if Codex returns a runaway
    // response. 20MB is well above any legitimate completion (~50KB typical)
    // but small enough to prevent OOM during silent infinite-loop replies.
    const MAX_OUTPUT_BYTES = Number(process.env.CODEX_MAX_OUTPUT_BYTES) || 20 * 1024 * 1024;
    const timer = setTimeout(() => {
      terminateProcessTree(child);
    }, timeoutMs);

    child.stdin?.write(String(prompt || ''));
    child.stdin?.end();
    child.stdout?.on('data', (chunk) => {
      if (oversized) return;
      stdout += String(chunk);
      if (stdout.length > MAX_OUTPUT_BYTES) {
        oversized = true;
        stdout += `\n[truncated at ${MAX_OUTPUT_BYTES} bytes — likely runaway response]\n`;
        terminateProcessTree(child);
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (oversized) return;
      stderr += String(chunk);
      if (stderr.length > MAX_OUTPUT_BYTES) {
        oversized = true;
        stderr += '\n[truncated]\n';
        terminateProcessTree(child);
      }
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

function uniqueStrings(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function resolveJsonModels() {
  const configured = String(process.env.CODEX_JSON_MODEL || '').trim();
  const inherited = String(process.env.CODEX_MODEL || '').trim();
  const fallbackModels = String(process.env.CODEX_JSON_FALLBACK_MODELS || 'gpt-5.4,gpt-5.4-mini')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  // Codex CLI 0.116.0 rejects gpt-5.5. This wrapper powers dashboard
  // synthesis, so prefer a compatible model unless CODEX_JSON_MODEL explicitly
  // asks for something else.
  const primary = configured || (/^gpt-5\.5\b/i.test(inherited) ? 'gpt-5.4' : inherited) || 'gpt-5.4';
  return uniqueStrings([primary, ...fallbackModels, inherited].filter((model) => (
    !/^gpt-5\.5\b/i.test(model) || configured === model
  )));
}

function buildCodexArgs(model) {
  const args = ['exec'];
  if (model) args.push('--model', model);
  args.push('--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--full-auto');
  return args;
}

function classifyCodexFailure(result) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}\n${result.message || ''}`.toLowerCase();
  if (combined.includes('requires a newer version of codex')) return 'incompatible_model';
  if (combined.includes('invalid_request_error')) return 'invalid_request';
  if (Number(result.code ?? 0) === 124 || combined.includes('timed out') || combined.includes('timeout')) return 'timeout';
  if (result.parsed) return null;
  if (result.code !== 0) return 'execution_error';
  return 'parse_error';
}

function buildRetryPrompt(prompt, previousMessage) {
  return `${String(prompt || '').trim()}

The previous response was not valid JSON for this dashboard parser.
Return ONLY one valid JSON object.
Do not use markdown fences.
Do not include commentary before or after JSON.
If a value is unknown, use null or an empty array.

Previous invalid response excerpt:
${String(previousMessage || '').slice(0, 1200)}`;
}

function summarizeAttempt(result) {
  return {
    model: result.model || null,
    code: Number(result.code ?? 1),
    parsed: Boolean(result.parsed),
    failureKind: result.failureKind || null,
    durationMs: Number(result.durationMs || 0),
    message: String(result.message || '').slice(0, 600),
    stderr: String(result.stderr || '').slice(0, 600),
  };
}

async function runCodexJsonAttempt({ command, args, prompt, timeoutMs, model, attemptIndex }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const shell = process.platform === 'win32' && !/\.exe$/i.test(command);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: getSafeEnv({ CODEX_MODEL: model || undefined }),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell,
    });
    let stdout = '';
    let stderr = '';
    let oversized = false;
    let timedOut = false;
    const MAX_OUTPUT_BYTES = Number(process.env.CODEX_MAX_OUTPUT_BYTES) || 20 * 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    child.stdin?.write(String(prompt || ''));
    child.stdin?.end();
    child.stdout?.on('data', (chunk) => {
      if (oversized) return;
      stdout += String(chunk);
      if (stdout.length > MAX_OUTPUT_BYTES) {
        oversized = true;
        stdout += `\n[truncated at ${MAX_OUTPUT_BYTES} bytes - likely runaway response]\n`;
        terminateProcessTree(child);
      }
    });
    child.stderr?.on('data', (chunk) => {
      if (oversized) return;
      stderr += String(chunk);
      if (stderr.length > MAX_OUTPUT_BYTES) {
        oversized = true;
        stderr += '\n[truncated]\n';
        terminateProcessTree(child);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const message = parseCodexJsonOutput(stdout) || stdout;
      const result = {
        code: timedOut ? 124 : Number(code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out after ${timeoutMs}ms`.trim() : stderr,
        message,
        parsed: parseJsonObject(message) || parseJsonObject(stdout),
        model,
        attemptIndex,
        durationMs: Date.now() - startedAt,
      };
      result.failureKind = classifyCodexFailure(result);
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
        model,
        attemptIndex,
        durationMs: Date.now() - startedAt,
      };
      result.failureKind = classifyCodexFailure(result);
      resolve(result);
    });
  });
}

export async function runCodexJsonPrompt(prompt, timeoutMs = 95_000, meta = {}) {
  const command = await resolveCodexCommand();
  const startedAt = Date.now();
  const maxParseRetries = Math.max(0, Math.min(3, Number(process.env.CODEX_JSON_PARSE_RETRIES ?? 1)));
  const models = resolveJsonModels();
  const attempts = [];

  for (const model of models) {
    const first = await runCodexJsonAttempt({
      command,
      args: buildCodexArgs(model),
      prompt,
      timeoutMs,
      model,
      attemptIndex: attempts.length + 1,
    });
    attempts.push(summarizeAttempt(first));
    if (first.parsed) {
      const final = { ...first, attempts };
      await recordPromptMetric(meta, final, Date.now() - startedAt).catch(() => {});
      return final;
    }
    if (first.failureKind === 'incompatible_model') continue;
    if (first.failureKind === 'timeout') break;
    if (first.failureKind === 'parse_error') {
      for (let retry = 0; retry < maxParseRetries; retry += 1) {
        const retryResult = await runCodexJsonAttempt({
          command,
          args: buildCodexArgs(model),
          prompt: buildRetryPrompt(prompt, first.message || first.stdout),
          timeoutMs,
          model,
          attemptIndex: attempts.length + 1,
        });
        attempts.push(summarizeAttempt(retryResult));
        if (retryResult.parsed) {
          const final = { ...retryResult, attempts };
          await recordPromptMetric(meta, final, Date.now() - startedAt).catch(() => {});
          return final;
        }
        if (retryResult.failureKind !== 'parse_error') break;
      }
    }
    if (first.failureKind !== 'execution_error' && first.failureKind !== 'invalid_request') break;
  }

  const last = attempts[attempts.length - 1] || {};
  const final = {
    code: Number(last.code ?? 1),
    stdout: '',
    stderr: String(last.stderr || last.message || 'codex json prompt failed'),
    message: String(last.message || ''),
    parsed: null,
    model: last.model || models[0] || null,
    failureKind: last.failureKind || 'unknown',
    attempts,
  };
  await recordPromptMetric(meta, final, Date.now() - startedAt).catch(() => {});
  return final;
}
