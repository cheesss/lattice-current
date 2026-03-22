
export type SessionState = 'always-on' | 'open' | 'extended' | 'closed';

export interface RealityAssessment {
  executionPenaltyPct: number;
  realityScore: number;
  sessionState: SessionState;
  tradableNow: boolean;
  spreadBps: number;
  slippageBps: number;
  liquidityPenaltyPct: number;
  notes: string[];
}

export interface RealityAssessmentArgs {
  assetKind: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
  liquidityScore: number;
  marketMovePct: number | null;
  timestamp: string;
}

/**
 * Assesses the feasibility of executing a trade based on market conditions and asset characteristics.
 */
export function assessExecutionReality(args: RealityAssessmentArgs): RealityAssessment {
  const ts = new Date(args.timestamp);
  const hour = ts.getUTCHours();
  const day = ts.getUTCDay(); // 0 = Sunday, 6 = Saturday
  
  let sessionState: SessionState = 'closed';
  let tradableNow = false;
  
  // Basic session logic (UTC)
  if (args.assetKind === 'crypto' || args.assetKind === 'fx') {
    sessionState = 'always-on';
    tradableNow = true;
    if (args.assetKind === 'fx' && (day === 0 || day === 6)) {
        tradableNow = false; // Weekend FX
        sessionState = 'closed';
    }
  } else {
    // Equities/ETFs roughly align with US/EU sessions
    if (day >= 1 && day <= 5) {
      if (hour >= 13 && hour <= 20) {
        sessionState = 'open';
        tradableNow = true;
      } else if ((hour >= 12 && hour < 13) || (hour > 20 && hour <= 22)) {
        sessionState = 'extended';
        tradableNow = true;
      }
    }
  }

  const spreadBps = Math.max(1, 40 - args.liquidityScore * 0.35);
  const slippageBps = Math.max(1, 25 - args.liquidityScore * 0.2);
  const liquidityPenaltyPct = Number(((spreadBps + slippageBps) / 100).toFixed(3));
  
  let executionPenaltyPct = liquidityPenaltyPct;
  if (!tradableNow) executionPenaltyPct += 0.5; // Penalty for waiting for market open
  if (sessionState === 'extended') executionPenaltyPct += 0.15;

  const notes: string[] = [];
  if (args.liquidityScore < 40) notes.push('Low liquidity asset');
  if (!tradableNow) notes.push(`Market ${sessionState}`);
  if (sessionState === 'extended') notes.push('Extended hours execution');

  const realityScore = Math.max(0, Math.min(100, Math.round(
    args.liquidityScore * 0.4 
    + (tradableNow ? 40 : 10) 
    + (sessionState === 'open' ? 20 : 0)
  )));

  return {
    executionPenaltyPct,
    realityScore,
    sessionState,
    tradableNow,
    spreadBps,
    slippageBps,
    liquidityPenaltyPct,
    notes,
  };
}
