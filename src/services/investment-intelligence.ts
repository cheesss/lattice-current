/**
 * Investment Intelligence — Re-export Facade
 *
 * This file has been split into modular components under src/services/investment/.
 * All public API is preserved here for backward compatibility.
 */

// Types
export type {
  InvestmentAssetKind,
  InvestmentDirection,
  InvestmentBias,
  WorkflowStatus,
  UniverseExpansionMode,
  ConfirmationState,
  InvestmentIntelligenceContext,
  InvestmentWorkflowStep,
  DirectAssetMapping,
  SectorSensitivityRow,
  HistoricalAnalog,
  PositionSizingRule,
  InvestmentIdeaSymbol,
  InvestmentIdeaCard,
  ThemeDiagnosticsRow,
  ThemeDiagnosticsSnapshot,
  IdeaCardExplanationPayload,
  CurrentDecisionSupportItem,
  CurrentDecisionSupportSnapshot,
  WorkflowDropoffStageSummary,
  WorkflowDropoffSummary,
  TrackedIdeaSymbolState,
  TrackedIdeaState,
  MappingPerformanceStats,
  EventBacktestRow,
  MarketHistoryPoint,
  FalsePositiveReasonStat,
  FalsePositiveStats,
  UniverseCoverageGap,
  CandidateExpansionReview,
  UniverseExpansionPolicy,
  UniverseCoverageSummary,
  AutonomyControlState,
  DatasetAutonomySummary,
  InvestmentIntelligenceSnapshot,
  InvestmentHistoryEntry,
  ConvictionFeatureSnapshot,
  ConvictionModelState,
  InvestmentLearningState,
  InvestmentThemeDefinition,
  CodexCandidateExpansionProposal,
} from './investment/types';

// Functions
export { recomputeInvestmentIntelligence } from './investment/orchestrator';
export {
  listBaseInvestmentThemes,
  listAutomatedInvestmentThemes,
  setAutomatedThemeCatalog,
} from './investment/theme-registry';
export {
  buildThemeDiagnosticsSnapshot,
  buildIdeaCardExplanationPayload,
  buildCurrentDecisionSupportSnapshot,
  buildWorkflowDropoffSummary,
} from './investment/diagnostics';
export {
  getInvestmentIntelligenceSnapshot,
  hydratePersistedExperimentRegistry,
  getUniverseExpansionPolicy,
  setUniverseExpansionPolicyMode,
  syncExperimentRegistrySnapshot,
  listCandidateExpansionReviews,
  setCandidateExpansionReviewStatus,
  getInvestmentThemeDefinition,
  ingestCodexCandidateExpansionProposals,
  requestCodexCandidateExpansion,
  listMappingPerformanceStats,
  exportInvestmentLearningState,
  resetInvestmentLearningState,
} from './investment/learning-state-io';
