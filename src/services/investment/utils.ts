import type {
  InvestmentDirection,
  ThemeAssetDefinition,
  InvestmentIdeaSymbol,
  InvestmentAssetKind,
} from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function logistic(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

export function asTs(value: string | null | undefined): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-/.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMatchable(value: string): string {
  return normalize(value)
    .replace(/[-/.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function paddedTokenMatch(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

export function themeTriggerVariants(trigger: string): string[] {
  const normalizedTrigger = normalizeMatchable(trigger);
  if (!normalizedTrigger) return [];
  if (normalizedTrigger.includes(' ') || normalizedTrigger.length < 4) {
    return [normalizedTrigger];
  }
  const variants = new Set([
    normalizedTrigger,
    `${normalizedTrigger}s`,
    `${normalizedTrigger}es`,
    `${normalizedTrigger}ed`,
    `${normalizedTrigger}ing`,
  ]);
  if (normalizedTrigger.endsWith('y')) {
    variants.add(`${normalizedTrigger.slice(0, -1)}ies`);
  }
  return Array.from(variants);
}

export function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = clamp(quantile, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

export function matchesThemeTrigger(text: string, trigger: string): boolean {
  const normalizedText = normalizeMatchable(text);
  if (!normalizedText) return false;
  return themeTriggerVariants(trigger).some((variant) => paddedTokenMatch(normalizedText, variant));
}

export function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function weightedAverage(values: number[], weights: number[]): number {
  const sampleSize = Math.min(values.length, weights.length);
  if (sampleSize <= 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = Number(values[index] ?? 0);
    const weight = Math.max(0, Number(weights[index] ?? 0));
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return weightedSum / totalWeight;
}

export function weightedStdDev(values: number[], weights: number[]): number {
  const sampleSize = Math.min(values.length, weights.length);
  if (sampleSize <= 1) return 0;
  const mean = weightedAverage(values, weights);
  let weightedVariance = 0;
  let totalWeight = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = Number(values[index] ?? 0);
    const weight = Math.max(0, Number(weights[index] ?? 0));
    if (!Number.isFinite(value) || !(weight > 0)) continue;
    weightedVariance += weight * Math.pow(value - mean, 2);
    totalWeight += weight;
  }
  if (!(totalWeight > 0)) return 0;
  return Math.sqrt(weightedVariance / totalWeight);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function temperatureSoftmax(values: number[], temperature = 1): number[] {
  if (!values.length) return [];
  const boundedTemperature = clamp(temperature, 0.08, 5);
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - maxValue) / boundedTemperature));
  const total = exps.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return values.map(() => 1 / values.length);
  }
  return exps.map((value) => value / total);
}

export function normalizeWeights(values: number[]): number[] {
  const clean = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = clean.reduce((acc, value) => acc + value, 0);
  if (!(total > 0)) {
    return clean.map(() => (clean.length > 0 ? 1 / clean.length : 0));
  }
  return clean.map((value) => value / total);
}

export function titleId(value: string): string {
  return normalize(value).replace(/\s+/g, '-').slice(0, 120);
}

export function themeAssetKey(asset: Pick<ThemeAssetDefinition, 'symbol' | 'direction' | 'role'>): string {
  return `${normalize(asset.symbol)}::${asset.direction}::${asset.role}`;
}

export function candidateReviewId(themeId: string, symbol: string, direction: InvestmentDirection, role: ThemeAssetDefinition['role']): string {
  return `${normalize(themeId)}::${normalize(symbol)}::${direction}::${role}`;
}

export function dedupeThemeAssets(assets: ThemeAssetDefinition[]): ThemeAssetDefinition[] {
  const seen = new Set<string>();
  const output: ThemeAssetDefinition[] = [];
  for (const asset of assets) {
    const key = themeAssetKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(asset);
  }
  return output;
}

export function uniqueId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function marketHistoryKey(point: Pick<{ symbol: string; timestamp: string }, 'symbol' | 'timestamp'>): string {
  return `${point.symbol}::${point.timestamp}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function elapsedDays(fromIso: string, toIso: string): number {
  const diff = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return diff / 86_400_000;
}

export function symbolRoleWeight(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 1;
  if (role === 'confirm') return 0.65;
  return 0.4;
}

export function pearsonCorrelation(left: number[], right: number[]): number {
  const samples = Math.min(left.length, right.length);
  if (samples < 3) return 0;
  const x = left.slice(-samples);
  const y = right.slice(-samples);
  const meanX = average(x);
  const meanY = average(y);
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let index = 0; index < samples; index += 1) {
    const dx = (x[index] ?? 0) - meanX;
    const dy = (y[index] ?? 0) - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denominator = Math.sqrt(denomX * denomY);
  if (!denominator) return 0;
  return clamp(numerator / denominator, -1, 1);
}

export function intersectionCount(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.reduce((count, item) => count + (rightSet.has(item) ? 1 : 0), 0);
}

export function normalizeSectorFamily(sector: string, assetKind?: InvestmentAssetKind | null): string {
  const normalizedSector = normalizeMatchable(sector || '');
  if (!normalizedSector) {
    if (assetKind === 'rate' || assetKind === 'fx') return 'defensive-macro';
    if (assetKind === 'commodity') return 'commodities';
    if (assetKind === 'crypto') return 'crypto';
    return assetKind || 'general';
  }
  if (/(gold|treasury|rates|volatility|fx|dollar|utilities)/.test(normalizedSector)) return 'defensive-macro';
  if (/(semiconductor|cybersecurity|network infrastructure|software|technology|compute)/.test(normalizedSector)) return 'technology';
  if (/(defense|surveillance|aerospace|drone|munitions)/.test(normalizedSector)) return 'defense';
  if (/(energy|shipping|airlines|transport|oil|gas)/.test(normalizedSector)) return 'energy-transport';
  if (/(fertilizer|agriculture|potash|phosphates|grain)/.test(normalizedSector)) return 'agri-inputs';
  if (/(rates|bond)/.test(normalizedSector)) return 'rates';
  return normalizedSector.replace(/\s+/g, '-');
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

export function scoreArrayOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}
