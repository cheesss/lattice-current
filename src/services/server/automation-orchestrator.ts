/**
 * Job orchestration, scheduler logic, and the main automation cycle runner.
 * Extracted from intelligence-automation.ts — this module re-exports the cycle
 * runner and worker entry point so consumers can import from either location.
 */

export {
  runIntelligenceAutomationCycle,
  runIntelligenceAutomationWorker,
  getIntelligenceAutomationStatus,
} from './intelligence-automation';

export type {
  IntelligenceAutomationCycleResult,
} from './intelligence-automation';
