import path from 'node:path';
import { existsSync } from 'node:fs';

export const AUTOMATION_BUDGETS = Object.freeze({
  daily: Object.freeze({
    backfillCalls: 5,
    backfillItems: 100000,
    codexCalls: 300,
    rssRegistrations: 30,
    symbolRegistrations: 20,
    themeRegistrations: 5,
    selfHealingActions: 20,
    schemaChanges: 0,
    destructiveOps: 0,
  }),
  weekly: Object.freeze({
    backfillCalls: 20,
    backfillItems: 500000,
  }),
  hourly: Object.freeze({
    backfillCalls: 2,
    codexCalls: 40,
  }),
});

const KILL_SWITCH_FILE = path.resolve('data', '.automation-disabled');

export function checkKillSwitch() {
  if (process.env.AUTOMATION_KILL_SWITCH === '1') {
    throw new Error('AUTOMATION_KILL_SWITCH active, all automation disabled');
  }
  if (existsSync(KILL_SWITCH_FILE)) {
    throw new Error(`automation disabled by ${KILL_SWITCH_FILE}`);
  }
}

function getLimit(scope, action) {
  const table = AUTOMATION_BUDGETS?.[scope];
  if (!table) return null;
  const value = table[action];
  return Number.isFinite(value) ? Number(value) : null;
}

async function getUsedAmount(client, action, intervalSql) {
  const { rows } = await client.query(
    `
      SELECT COALESCE(SUM(amount), 0)::bigint AS used
      FROM automation_budget_log
      WHERE action = $1
        AND consumed_at >= NOW() - ${intervalSql}
    `,
    [action],
  );
  return Number(rows[0]?.used || 0);
}

export async function checkBudget(client, action, amount = 1) {
  checkKillSwitch();
  const normalizedAction = String(action || '').trim();
  const normalizedAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!normalizedAction) {
    return { allowed: false, remaining: 0, reason: 'missing action' };
  }

  const hourlyLimit = getLimit('hourly', normalizedAction);
  if (hourlyLimit != null) {
    const used = await getUsedAmount(client, normalizedAction, "INTERVAL '1 hour'");
    if (used + normalizedAmount > hourlyLimit) {
      return {
        allowed: false,
        remaining: Math.max(0, hourlyLimit - used),
        reason: 'hourly budget exceeded',
      };
    }
  }

  const dailyLimit = getLimit('daily', normalizedAction);
  if (dailyLimit != null) {
    const used = await getUsedAmount(client, normalizedAction, "INTERVAL '1 day'");
    if (used + normalizedAmount > dailyLimit) {
      return {
        allowed: false,
        remaining: Math.max(0, dailyLimit - used),
        reason: 'daily budget exceeded',
      };
    }
  }

  const weeklyLimit = getLimit('weekly', normalizedAction);
  if (weeklyLimit != null) {
    const used = await getUsedAmount(client, normalizedAction, "INTERVAL '7 days'");
    if (used + normalizedAmount > weeklyLimit) {
      return {
        allowed: false,
        remaining: Math.max(0, weeklyLimit - used),
        reason: 'weekly budget exceeded',
      };
    }
  }

  return {
    allowed: true,
    remaining: dailyLimit == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, dailyLimit - normalizedAmount - await getUsedAmount(client, normalizedAction, "INTERVAL '1 day'")),
  };
}

export async function consumeBudget(client, action, amount = 1, metadata = {}) {
  await client.query(
    `
      INSERT INTO automation_budget_log (action, amount, metadata)
      VALUES ($1, $2, $3)
    `,
    [
      String(action || ''),
      Math.max(0, Math.floor(Number(amount) || 0)),
      JSON.stringify(metadata || {}),
    ],
  );
}

async function buildScopeStatus(client, scope, intervalSql) {
  const entries = Object.entries(AUTOMATION_BUDGETS?.[scope] || {});
  const rows = await Promise.all(entries.map(async ([action, limit]) => {
    const used = await getUsedAmount(client, action, intervalSql);
    return [
      action,
      {
        limit: Number(limit),
        used,
        remaining: Math.max(0, Number(limit) - used),
      },
    ];
  }));
  return Object.fromEntries(rows);
}

export async function getBudgetStatus(client) {
  const [hourly, daily, weekly] = await Promise.all([
    buildScopeStatus(client, 'hourly', "INTERVAL '1 hour'"),
    buildScopeStatus(client, 'daily', "INTERVAL '1 day'"),
    buildScopeStatus(client, 'weekly', "INTERVAL '7 days'"),
  ]);
  return {
    hourly,
    daily,
    weekly,
    killSwitchActive: process.env.AUTOMATION_KILL_SWITCH === '1' || existsSync(KILL_SWITCH_FILE),
    killSwitchFile: KILL_SWITCH_FILE,
  };
}
