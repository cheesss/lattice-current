import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertFiniteWeights,
  isWeightVector,
  type WeightVector,
} from './weight-learner.js';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

export function resolveWeightsPath(inputPath: string): string {
  const rawPath = String(inputPath || '').trim();
  if (!rawPath) {
    throw new Error('[weight-learner] weights path is required');
  }
  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(PROJECT_ROOT, rawPath);
}

export function loadWeightsSync(pathLike: string): WeightVector {
  const resolvedPath = resolveWeightsPath(pathLike);
  const raw = readFileSync(resolvedPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isWeightVector(parsed)) {
    throw new Error(`[weight-learner] invalid weights JSON: ${resolvedPath}`);
  }
  return assertFiniteWeights(parsed, 'load');
}

export async function loadWeights(pathLike: string): Promise<WeightVector> {
  const resolvedPath = resolveWeightsPath(pathLike);
  const raw = await readFile(resolvedPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isWeightVector(parsed)) {
    throw new Error(`[weight-learner] invalid weights JSON: ${resolvedPath}`);
  }
  return assertFiniteWeights(parsed, 'load');
}

export async function saveWeights(pathLike: string, weights: WeightVector): Promise<void> {
  const resolvedPath = resolveWeightsPath(pathLike);
  const validated = assertFiniteWeights(weights, 'save');
  await writeFile(resolvedPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}
