import type { WorkspaceId } from '@/config/workspaces';
import type { MapView, TimeRange } from '@/components/MapContainer';

export interface OperatorContext {
  workspaceId: WorkspaceId;
  selectedThemeId: string | null;
  selectedGeoEntityId: string | null;
  selectedCountryCode: string | null;
  selectedEventId: string | null;
  selectedAlertId: string | null;
  selectedReplayRunId: string | null;
  mapView: MapView;
  timeRange: TimeRange;
}

export type OperatorContextPatch = Partial<OperatorContext>;
