import { loadFromStorage, saveToStorage } from '@/utils';
import { resolveWorkspaceId } from '@/config/workspaces';
import type { MapView, TimeRange } from '@/components/MapContainer';
import type { OperatorContext, OperatorContextPatch } from '@/types/operator-context';

export const OPERATOR_CONTEXT_STORAGE_KEY = 'lattice-current-operator-context';

const MAP_VIEWS: MapView[] = ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'];
const TIME_RANGES: TimeRange[] = ['1h', '6h', '24h', '48h', '7d', 'all'];

const BASE_OPERATOR_CONTEXT: OperatorContext = {
  workspaceId: 'signals',
  selectedThemeId: null,
  selectedGeoEntityId: null,
  selectedCountryCode: null,
  selectedEventId: null,
  selectedAlertId: null,
  selectedReplayRunId: null,
  mapView: 'global',
  timeRange: '7d',
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOperatorContext(
  raw: Partial<OperatorContext> | null | undefined,
  fallback: OperatorContext = BASE_OPERATOR_CONTEXT,
): OperatorContext {
  const input = raw ?? {};
  return {
    workspaceId: resolveWorkspaceId(typeof input.workspaceId === 'string' ? input.workspaceId : fallback.workspaceId),
    selectedThemeId: normalizeOptionalString(input.selectedThemeId),
    selectedGeoEntityId: normalizeOptionalString(input.selectedGeoEntityId),
    selectedCountryCode: normalizeOptionalString(input.selectedCountryCode)?.toUpperCase() ?? null,
    selectedEventId: normalizeOptionalString(input.selectedEventId),
    selectedAlertId: normalizeOptionalString(input.selectedAlertId),
    selectedReplayRunId: normalizeOptionalString(input.selectedReplayRunId),
    mapView: MAP_VIEWS.includes(input.mapView as MapView)
      ? (input.mapView as MapView)
      : fallback.mapView,
    timeRange: TIME_RANGES.includes(input.timeRange as TimeRange)
      ? (input.timeRange as TimeRange)
      : fallback.timeRange,
  };
}

export function createDefaultOperatorContext(overrides: OperatorContextPatch = {}): OperatorContext {
  return normalizeOperatorContext({ ...BASE_OPERATOR_CONTEXT, ...overrides }, BASE_OPERATOR_CONTEXT);
}

export function loadOperatorContext(preferred: OperatorContextPatch = {}): OperatorContext {
  const saved = loadFromStorage<Partial<OperatorContext>>(OPERATOR_CONTEXT_STORAGE_KEY, BASE_OPERATOR_CONTEXT);
  return normalizeOperatorContext(
    { ...saved, ...preferred },
    createDefaultOperatorContext(preferred),
  );
}

export function mergeOperatorContext(
  current: OperatorContext,
  patch: OperatorContextPatch,
): OperatorContext {
  return normalizeOperatorContext({ ...current, ...patch }, current);
}

export function persistOperatorContext(context: OperatorContext): void {
  saveToStorage(OPERATOR_CONTEXT_STORAGE_KEY, normalizeOperatorContext(context));
}
