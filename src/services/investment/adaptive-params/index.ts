export type { AdaptiveParameterStore, AdaptiveParamsConfig, AdaptiveParamsInput } from './types';
export { DEFAULT_CONFIG } from './types';
export type {
  MetaWeights,
  CredibilityWeights,
  MetaTrainingExample,
  CredibilityTrainingExample,
} from './weight-learner';
export type { AdmissionThresholds } from './threshold-optimizer';
export {
  trainMetaWeights,
  trainCredibilityWeights,
  predictHitProbability,
  predictCredibility,
} from './weight-learner';
export { optimizeAdmissionThresholds } from './threshold-optimizer';
import type { AdaptiveParamsConfig, AdaptiveParamsInput } from './types';
import type { AdaptiveParameterStore } from './types';
import { AdaptiveParameterStoreImpl } from './store';

let globalStore: AdaptiveParameterStore | null = null;

export function getAdaptiveParamStore(): AdaptiveParameterStore {
  if (!globalStore) globalStore = new AdaptiveParameterStoreImpl();
  return globalStore;
}

export function initAdaptiveParamStore(config?: Partial<AdaptiveParamsConfig>): AdaptiveParameterStore {
  globalStore = new AdaptiveParameterStoreImpl(config);
  return globalStore;
}

export function computeAdaptiveParams(input: AdaptiveParamsInput): void {
  getAdaptiveParamStore().compute(input);
}
