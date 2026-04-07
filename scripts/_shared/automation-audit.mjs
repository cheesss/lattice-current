export async function logAutomationAction(client, action) {
  await client.query(
    `
      INSERT INTO automation_actions (action_type, metadata, result, reason)
      VALUES ($1, $2, $3, $4)
    `,
    [
      String(action?.type || 'unknown'),
      JSON.stringify(action?.params || {}),
      String(action?.result || 'success'),
      action?.reason ? String(action.reason).slice(0, 500) : null,
    ],
  );
}

export async function getRecentAutomationActions(client, hours = 24, limit = 200) {
  const safeHours = Math.max(1, Math.floor(Number(hours) || 24));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 200)));
  const { rows } = await client.query(
    `
      SELECT id, action_type, metadata, executed_at, result, reason
      FROM automation_actions
      WHERE executed_at >= NOW() - ($1::int * INTERVAL '1 hour')
      ORDER BY executed_at DESC
      LIMIT $2
    `,
    [safeHours, safeLimit],
  );
  return rows;
}
