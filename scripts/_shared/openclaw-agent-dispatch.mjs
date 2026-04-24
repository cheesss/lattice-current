import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function normalizeString(value) {
  return String(value || '').trim();
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function runOpenClawAgent(envelope) {
  return new Promise((resolve) => {
    const args = [
      envelope.cliEntry,
      'agent',
      '--agent',
      envelope.agentId,
      '--message',
      envelope.instruction,
      '--timeout',
      String(envelope.timeoutSeconds || 600),
      '--json',
    ];

    const child = spawn(
      envelope.nodePath,
      args,
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
        parsed: safeJsonParse(stdout),
      });
    });
    child.on('error', (error) => {
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${String(error?.message || error)}`,
        parsed: null,
      });
    });
  });
}

async function main() {
  const envelopePath = normalizeString(process.argv[2]);
  if (!envelopePath) {
    throw new Error('missing dispatch envelope path');
  }

  const raw = await readFile(envelopePath, 'utf8');
  const envelope = JSON.parse(raw);
  const artifactDir = path.resolve(envelope.artifactDir || path.dirname(envelopePath));
  await mkdir(artifactDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const result = await runOpenClawAgent(envelope);
  const finishedAt = new Date().toISOString();
  const artifact = {
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    agentId: envelope.agentId,
    instruction: envelope.instruction,
    startedAt,
    finishedAt,
    exitCode: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: result.parsed,
  };

  const resultPath = path.join(artifactDir, `${envelope.eventId}.result.json`);
  await writeFile(resultPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

main().catch(async (error) => {
  const envelopePath = normalizeString(process.argv[2]);
  if (envelopePath) {
    try {
      const raw = await readFile(envelopePath, 'utf8');
      const envelope = JSON.parse(raw);
      const artifactDir = path.resolve(envelope.artifactDir || path.dirname(envelopePath));
      await mkdir(artifactDir, { recursive: true });
      const errorPath = path.join(artifactDir, `${envelope.eventId || 'dispatch-error'}.result.json`);
      await writeFile(errorPath, `${JSON.stringify({
        eventId: envelope.eventId || null,
        eventType: envelope.eventType || null,
        error: String(error?.message || error),
      }, null, 2)}\n`, 'utf8');
    } catch {
      // ignore secondary write failure
    }
  }
  process.exitCode = 1;
});
