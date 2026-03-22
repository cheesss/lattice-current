
export interface ResourceOperationMeta {
  label: string;
  kind: 'api' | 'backtest' | 'db' | 'compute';
  feature: string;
  inputCount?: number;
  sampleStorage?: boolean;
}

export interface ResourceOperationResult {
  outputCount: number;
  sampleStorage?: boolean;
}

/**
 * Measures and logs a resource-intensive operation.
 */
export async function measureResourceOperation<T>(
  id: string,
  meta: ResourceOperationMeta,
  op: () => Promise<T>,
  onDone: (result: T) => ResourceOperationResult,
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await op();
    const duration = performance.now() - t0;
    const stats = onDone(result);
    
    // In a real app, this would send telemetry to a server
    console.debug(`[telemetry:${id}] ${meta.label} took ${duration.toFixed(2)}ms, outputCount=${stats.outputCount}`);
    
    return result;
  } catch (error) {
    console.error(`[telemetry:${id}] ${meta.label} failed`, error);
    throw error;
  }
}
