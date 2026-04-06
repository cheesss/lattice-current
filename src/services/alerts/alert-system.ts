/**
 * Alert System — Phase 12
 *
 * Rule-based alerting for operational visibility.
 * Supports severity levels, delivery channels, cooldown periods,
 * and runtime-configurable model parameters loaded from config.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'ui' | 'log' | 'webhook';

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  channels: AlertChannel[];
  /** Minimum seconds between consecutive firings of this rule. */
  cooldownSeconds: number;
  /** Evaluate the rule against the system context. */
  condition: (ctx: SystemContext) => boolean;
  /** Build the alert message from the context. */
  message: (ctx: SystemContext) => string;
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  channels: AlertChannel[];
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface SystemContext {
  sourceFailureStreak: number;
  weightChangePct: number;
  convictionCalibrationBiasPct: number;
  isAbstaining: boolean;
  portfolioDrawdownPct: number;
  dataPipelineDelayMinutes: number;
  modelStaleness: number;
  recentHitRatePct: number;
}

export type AlertListener = (alert: Alert) => void;

// ---------------------------------------------------------------------------
// Model Parameters Config
// ---------------------------------------------------------------------------

export interface ModelParamsConfig {
  hmm: {
    transitionPriorStrength: number;
    onlineDiscount: number;
    stabilityBias?: { base: number; scale: number; floor: number; cap: number };
    switchBias?: { base: number; scale: number; floor: number; cap: number };
    blendWeights?: { stability: number; switch: number };
    confidence?: { w1: number; w2: number; w3: number; w4: number; w5: number; floor: number; cap: number };
    onlineWeightScale?: number;
    onlineWeightExponent?: number;
  };
  conviction: { discountFactor: number; learningRate: number };
  bandit: { discountFactor: number; explorationScale: number };
  risk: { maxGrossExposurePct: number; maxNetExposurePct: number; maxSinglePositionPct: number };
  degradation: { minDataSufficiency: number; maxModelStaleness: number };
  portfolioOptimizer?: {
    regime?: {
      riskOff?: { maxClusters?: number; budgetPct?: number; grossCapPct?: number };
      balanced?: { maxClusters?: number; budgetPct?: number; grossCapPct?: number };
      riskOn?: { maxClusters?: number; budgetPct?: number; grossCapPct?: number };
      budgetBaseHigh?: number;
    };
    thresholds?: {
      readinessBaseline?: number;
      defaultSampleSize?: number;
      hitRateNeutral?: number;
      defensiveTrigger?: number;
      percentileCap?: number;
    };
    weights?: {
      familyShare?: number;
      hedgeRole?: number;
      direction?: number;
      utilityShrinkageBase?: number;
      sampleReliabilityWeight?: number;
      robustGapPenalty?: number;
      hitPenaltyWeight?: number;
      flipRateWeight?: number;
      regimeDispersionWeight?: number;
      watchDirection?: number;
    };
    penalties?: {
      downsideMagnitude?: number;
      volatilityLossWeight?: number;
      driftLossMultiplier?: number;
      replayGapLoss?: number;
      concentrationBoost?: number;
      negativeDriftPenalty?: number;
      clusterFloor?: number;
      stressMultiplierHigh?: number;
    };
    maxCompositeReturnPoints?: number;
    minSampleSize?: number;
    defaultHitRate?: number;
    temperatureDefault?: number;
    defensiveMultipliers?: { familyShare: number; hedgeRole: number; direction: number };
    coreAssetKinds?: string[];
    onlineWeightScale?: number;
    onlineWeightExponent?: number;
  };
}

export const DEFAULT_MODEL_PARAMS: ModelParamsConfig = {
  hmm: {
    transitionPriorStrength: 12,
    onlineDiscount: 0.992,
    stabilityBias: { base: 0.55, scale: 260, floor: 0.55, cap: 0.86 },
    switchBias: { base: 0.22, scale: 320, floor: 0.18, cap: 0.48 },
    blendWeights: { stability: 0.58, switch: 0.42 },
    confidence: { w1: 34, w2: 52, w3: 28, w4: 9, w5: 10, floor: 28, cap: 96 },
    onlineWeightScale: 24,
    onlineWeightExponent: 0.6,
  },
  conviction: { discountFactor: 0.995, learningRate: 0.08 },
  bandit: { discountFactor: 0.995, explorationScale: 0.7 },
  risk: { maxGrossExposurePct: 150, maxNetExposurePct: 80, maxSinglePositionPct: 12 },
  degradation: { minDataSufficiency: 0.3, maxModelStaleness: 0.7 },
  portfolioOptimizer: {
    regime: {
      riskOff: { maxClusters: 2, budgetPct: 12, grossCapPct: 16 },
      balanced: { maxClusters: 3, budgetPct: 24, grossCapPct: 20 },
      riskOn: { maxClusters: 4, budgetPct: 36, grossCapPct: 30 },
      budgetBaseHigh: 44,
    },
    thresholds: {
      readinessBaseline: 45,
      defaultSampleSize: 48,
      hitRateNeutral: 50,
      defensiveTrigger: 55,
      percentileCap: 100,
    },
    weights: {
      familyShare: 0.5,
      hedgeRole: 0.3,
      direction: 0.2,
      utilityShrinkageBase: 0.35,
      sampleReliabilityWeight: 0.65,
      robustGapPenalty: 0.7,
      hitPenaltyWeight: 0.62,
      flipRateWeight: 0.95,
      regimeDispersionWeight: 0.72,
      watchDirection: 0.55,
    },
    penalties: {
      downsideMagnitude: 0.26,
      volatilityLossWeight: 0.42,
      driftLossMultiplier: 0.78,
      replayGapLoss: 1.05,
      concentrationBoost: 1.35,
      negativeDriftPenalty: 1.45,
      clusterFloor: 0.82,
      stressMultiplierHigh: 0.76,
    },
    maxCompositeReturnPoints: 48,
    minSampleSize: 8,
    defaultHitRate: 50,
    temperatureDefault: 1,
    defensiveMultipliers: { familyShare: 0.5, hedgeRole: 0.3, direction: 0.2 },
    coreAssetKinds: ['etf', 'rate', 'commodity', 'fx'],
    onlineWeightScale: 24,
    onlineWeightExponent: 0.6,
  },
};

// ---------------------------------------------------------------------------
// Config Manager (runtime-changeable)
// ---------------------------------------------------------------------------

export interface ConfigChangeRecord {
  timestamp: string;
  path: string;
  previousValue: unknown;
  newValue: unknown;
  source: 'file' | 'api' | 'manual';
}

export class ConfigManager {
  private params: ModelParamsConfig;
  private history: ConfigChangeRecord[] = [];

  constructor(initial: ModelParamsConfig = DEFAULT_MODEL_PARAMS) {
    this.params = JSON.parse(JSON.stringify(initial)) as ModelParamsConfig;
  }

  /** Get the current config (deep copy). */
  getParams(): ModelParamsConfig {
    return JSON.parse(JSON.stringify(this.params)) as ModelParamsConfig;
  }

  /** Update a config value by dot path (e.g., 'conviction.learningRate'). */
  updateParam(path: string, value: unknown, source: 'file' | 'api' | 'manual' = 'manual'): boolean {
    const parts = path.split('.');
    if (parts.length !== 2) return false;

    const section = parts[0] as keyof ModelParamsConfig;
    const key = parts[1]!;

    if (!(section in this.params)) return false;
    const sectionObj = this.params[section] as Record<string, unknown>;
    if (!(key in sectionObj)) return false;

    const prev = sectionObj[key];
    sectionObj[key] = value;

    this.history.push({
      timestamp: new Date().toISOString(),
      path,
      previousValue: prev,
      newValue: value,
      source,
    });

    return true;
  }

  /** Load full config (e.g., from JSON file). */
  loadConfig(config: ModelParamsConfig, source: 'file' | 'api' | 'manual' = 'file'): void {
    const old = this.params;
    this.params = JSON.parse(JSON.stringify(config)) as ModelParamsConfig;

    // Record each changed field
    for (const section of Object.keys(config) as Array<keyof ModelParamsConfig>) {
      const newSection = config[section] as Record<string, unknown>;
      const oldSection = old[section] as Record<string, unknown>;
      for (const key of Object.keys(newSection)) {
        if (JSON.stringify(newSection[key]) !== JSON.stringify(oldSection[key])) {
          this.history.push({
            timestamp: new Date().toISOString(),
            path: `${section}.${key}`,
            previousValue: oldSection[key],
            newValue: newSection[key],
            source,
          });
        }
      }
    }
  }

  /** Get change history. */
  getHistory(): ConfigChangeRecord[] {
    return this.history.slice();
  }

  /** Get change history for a specific config path. */
  getHistoryForPath(path: string): ConfigChangeRecord[] {
    return this.history.filter((r) => r.path === path);
  }
}

// ---------------------------------------------------------------------------
// Default Alert Rules (6+)
// ---------------------------------------------------------------------------

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'source-failure-streak',
    name: 'Source Failure Streak',
    description: 'Consecutive source failures >= 3',
    severity: 'warning',
    channels: ['ui', 'log'],
    cooldownSeconds: 300,
    condition: (ctx) => ctx.sourceFailureStreak >= 3,
    message: (ctx) => `Source pipeline has failed ${ctx.sourceFailureStreak} consecutive times.`,
  },
  {
    id: 'weight-change-spike',
    name: 'Model Weight Spike',
    description: 'Single update changed weights > 20%',
    severity: 'warning',
    channels: ['ui', 'log'],
    cooldownSeconds: 600,
    condition: (ctx) => ctx.weightChangePct > 20,
    message: (ctx) => `Model weights changed by ${ctx.weightChangePct.toFixed(1)}% in a single update.`,
  },
  {
    id: 'conviction-bias',
    name: 'Conviction Calibration Bias',
    description: 'Conviction calibration bias > 15%',
    severity: 'warning',
    channels: ['ui', 'log'],
    cooldownSeconds: 1800,
    condition: (ctx) => ctx.convictionCalibrationBiasPct > 15,
    message: (ctx) => `Conviction model shows ${ctx.convictionCalibrationBiasPct.toFixed(1)}% calibration bias.`,
  },
  {
    id: 'abstention-entered',
    name: 'Abstention State',
    description: 'System entered abstention mode',
    severity: 'critical',
    channels: ['ui', 'log', 'webhook'],
    cooldownSeconds: 3600,
    condition: (ctx) => ctx.isAbstaining,
    message: () => 'System has entered abstention mode — new idea generation halted.',
  },
  {
    id: 'drawdown-breach',
    name: 'Portfolio Drawdown Breach',
    description: 'Portfolio drawdown exceeds threshold',
    severity: 'critical',
    channels: ['ui', 'log', 'webhook'],
    cooldownSeconds: 1800,
    condition: (ctx) => ctx.portfolioDrawdownPct > 15,
    message: (ctx) => `Portfolio drawdown reached ${ctx.portfolioDrawdownPct.toFixed(1)}%, exceeding 15% threshold.`,
  },
  {
    id: 'pipeline-delay',
    name: 'Data Pipeline Delay',
    description: 'Data pipeline delayed > 30 minutes',
    severity: 'warning',
    channels: ['ui', 'log'],
    cooldownSeconds: 900,
    condition: (ctx) => ctx.dataPipelineDelayMinutes > 30,
    message: (ctx) => `Data pipeline delayed by ${ctx.dataPipelineDelayMinutes} minutes.`,
  },
  {
    id: 'model-staleness-high',
    name: 'Model Staleness High',
    description: 'Model staleness exceeds 60%',
    severity: 'warning',
    channels: ['ui', 'log'],
    cooldownSeconds: 3600,
    condition: (ctx) => ctx.modelStaleness > 0.6,
    message: (ctx) => `Model staleness is ${(ctx.modelStaleness * 100).toFixed(0)}%. Consider triggering retraining.`,
  },
  {
    id: 'hit-rate-collapse',
    name: 'Hit Rate Collapse',
    description: 'Recent hit rate below 30%',
    severity: 'critical',
    channels: ['ui', 'log', 'webhook'],
    cooldownSeconds: 3600,
    condition: (ctx) => ctx.recentHitRatePct < 30,
    message: (ctx) => `Recent hit rate collapsed to ${ctx.recentHitRatePct.toFixed(1)}%. Model performance review needed.`,
  },
];

// ---------------------------------------------------------------------------
// Alert Engine
// ---------------------------------------------------------------------------

let nextAlertId = 1;

export class AlertEngine {
  private rules: AlertRule[];
  private alerts: Alert[] = [];
  private lastFired = new Map<string, number>(); // ruleId → timestamp ms
  private listeners = new Set<AlertListener>();
  private maxAlerts: number;

  constructor(rules: AlertRule[] = DEFAULT_ALERT_RULES, maxAlerts = 500) {
    this.rules = rules.slice();
    this.maxAlerts = maxAlerts;
  }

  /** Add a custom rule at runtime. */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  /** Remove a rule by ID. */
  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === ruleId);
    if (idx < 0) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /** Evaluate all rules against the current system context. */
  evaluate(ctx: SystemContext): Alert[] {
    const now = Date.now();
    const fired: Alert[] = [];

    for (const rule of this.rules) {
      // Cooldown check
      const last = this.lastFired.get(rule.id);
      if (last && (now - last) < rule.cooldownSeconds * 1000) continue;

      if (rule.condition(ctx)) {
        const alert: Alert = {
          id: `alert-${nextAlertId++}`,
          ruleId: rule.id,
          severity: rule.severity,
          channels: rule.channels.slice(),
          message: rule.message(ctx),
          timestamp: new Date().toISOString(),
          acknowledged: false,
        };
        this.alerts.push(alert);
        this.lastFired.set(rule.id, now);
        fired.push(alert);

        // Notify listeners
        for (const listener of this.listeners) {
          try { listener(alert); } catch { /* swallow */ }
        }
      }
    }

    // Trim old alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(this.alerts.length - this.maxAlerts);
    }

    return fired;
  }

  /** Acknowledge an alert by ID. */
  acknowledge(alertId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  /** Get all unacknowledged alerts. */
  getUnacknowledged(): Alert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  /** Get alerts by severity. */
  getBySeverity(severity: AlertSeverity): Alert[] {
    return this.alerts.filter((a) => a.severity === severity);
  }

  /** Get all alerts. */
  getAll(): Alert[] {
    return this.alerts.slice();
  }

  /** Subscribe to new alerts. Returns unsubscribe function. */
  onAlert(listener: AlertListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Get rule count. */
  getRuleCount(): number {
    return this.rules.length;
  }

  /** Reset cooldowns (for testing). */
  resetCooldowns(): void {
    this.lastFired.clear();
  }
}

// ---------------------------------------------------------------------------
// Dashboard Panel Definitions
// ---------------------------------------------------------------------------

export interface DashboardPanel {
  id: string;
  title: string;
  description: string;
  category: 'health' | 'decision-flow' | 'performance';
  metrics: string[];
}

export const DASHBOARD_PANELS: DashboardPanel[] = [
  {
    id: 'system-health',
    title: 'System Health',
    description: 'Source status, model staleness, learning state summary',
    category: 'health',
    metrics: ['source_status', 'model_staleness', 'observations_count', 'last_update', 'drift_estimate'],
  },
  {
    id: 'decision-flow',
    title: 'Decision Flow',
    description: 'Real-time decision pipeline visualization: frame → idea → gate → deploy',
    category: 'decision-flow',
    metrics: ['frames_processed', 'ideas_generated', 'ideas_gated', 'ideas_deployed', 'ideas_shadowed'],
  },
  {
    id: 'performance',
    title: 'Performance',
    description: 'Baseline comparison, rolling returns, conviction calibration',
    category: 'performance',
    metrics: ['rolling_sharpe', 'rolling_return_pct', 'baseline_delta', 'conviction_calibration', 'hit_rate'],
  },
];
