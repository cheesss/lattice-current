import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ALERTS_PATH = path.resolve('data', 'alerts.json');
const MAX_ALERTS = 200;

function ensureAlertsDir(filePath) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadAlerts(filePath = ALERTS_PATH) {
  try {
    if (!existsSync(filePath)) return [];
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts, filePath = ALERTS_PATH) {
  ensureAlertsDir(filePath);
  writeFileSync(filePath, JSON.stringify(alerts, null, 2));
}

export async function sendAlert(severity, message, context = {}, options = {}) {
  const filePath = path.resolve(options.filePath || ALERTS_PATH);
  const entry = {
    severity: String(severity || 'info'),
    message: String(message || '').trim(),
    context,
    timestamp: new Date().toISOString(),
  };

  const alerts = loadAlerts(filePath);
  alerts.push(entry);
  if (alerts.length > MAX_ALERTS) {
    alerts.splice(0, alerts.length - MAX_ALERTS);
  }
  saveAlerts(alerts, filePath);

  const webhookUrl = String(options.webhookUrl || process.env.ALERT_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return { ok: true, delivered: false, entry };
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[${entry.severity.toUpperCase()}] ${entry.message}`,
        ...context,
      }),
    });
    return { ok: true, delivered: true, entry };
  } catch (error) {
    return {
      ok: false,
      delivered: false,
      entry,
      error: String(error?.message || error || 'webhook delivery failed'),
    };
  }
}

export function readAlertLog(filePath = ALERTS_PATH) {
  return loadAlerts(path.resolve(filePath));
}

