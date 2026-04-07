export async function ensureCodexProposalSchema(queryable) {
  await queryable.query(`
    CREATE TABLE IF NOT EXISTS codex_proposals (
      id SERIAL PRIMARY KEY,
      proposal_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      result JSONB,
      reasoning TEXT,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    )
  `);
}
