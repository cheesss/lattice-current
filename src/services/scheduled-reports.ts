


export interface ScheduledReport {
  id: string;
  title: string;
  summary: string;
  rebuttalSummary?: string;
  consensusMode?: string;
  generatedAt: string;
  category: 'daily' | 'weekly' | 'flash' | 'incident';
  items: Array<{ title: string; link: string; source: string }>;
}

/**
 * Mock implementation of scheduled reports service.
 */
export async function listScheduledReports(limit = 10): Promise<ScheduledReport[]> {
  return [
    {
      id: 'rep:1',
      title: 'Global Macro Briefing',
      summary: 'Equities stable amid low-volatility regime. Energy markets watching OPEC+ headlines.',
      generatedAt: new Date().toISOString(),
      category: 'daily' as const,
      items: [],
    }
  ].slice(0, limit);
}
