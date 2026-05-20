#!/usr/bin/env node

import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAutoresearchHarnessRound } from './_shared/autoresearch-harness.mjs';
import { loadKnowledgeGraph, buildResearchOsDataPathAudit, normalizeKnowledgeKey } from './_shared/adjacency-graph.mjs';
import { scoreCrossThemeConnectors } from './_shared/cross-theme-adjacency.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './_shared/research-os-policy.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    dryRun: args.has('--dry-run'),
    budgetMs: Number(argv.find((arg) => arg.startsWith('--budget-ms='))?.split('=')[1] || 300_000),
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function candidateName(candidate) {
  return normalizeKnowledgeKey(candidate?.node?.canonicalName || candidate?.connector || candidate?.supplier || '');
}

function containsExpected(candidate, expected = []) {
  const name = candidateName(candidate);
  return expected.map(normalizeKnowledgeKey).some((term) => term && (name.includes(term) || term.includes(name)));
}

function measureGold(candidates, goldset) {
  let hits = 0;
  for (const example of goldset) {
    const scoped = candidates.filter((candidate) => {
      const candidateThemes = new Set((candidate.themes || []).map(normalizeKnowledgeKey));
      return (example.themes || []).every((theme) => candidateThemes.has(normalizeKnowledgeKey(theme)));
    }).slice(0, 10);
    const expected = [...(example.expectedConnectors || []), ...(example.expectedSuppliers || [])];
    if (scoped.some((candidate) => containsExpected(candidate, expected))) hits += 1;
  }
  return goldset.length ? hits / goldset.length : 0;
}

function measureNegative(candidates, negativeSet) {
  let hits = 0;
  for (const example of negativeSet) {
    const scoped = candidates.filter((candidate) => {
      const candidateThemes = new Set((candidate.themes || []).map(normalizeKnowledgeKey));
      return (example.themes || []).every((theme) => candidateThemes.has(normalizeKnowledgeKey(theme)));
    });
    const wrong = example.wrongConnectors || [];
    if (scoped.some((candidate) => containsExpected(candidate, wrong))) hits += 1;
  }
  return hits;
}

export async function runAdjacencyAutoresearch(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    const goldset = readJson(path.join(process.cwd(), 'data', 'eval', 'adjacency-goldset.json'));
    const negativeSet = readJson(path.join(process.cwd(), 'data', 'eval', 'adjacency-negative-set.json'));
    const graph = await loadKnowledgeGraph(client);
    const hotThemes = [...new Set(goldset.flatMap((item) => item.themes))].map((key) => ({ key, heat: 0.8, momentum: 0.8 }));
    const scored = scoreCrossThemeConnectors({ graph, hotThemes, seedExamples: goldset }, policy);
    const evaluationCandidates = [
      ...scored.candidates,
      ...(scored.backlogCandidates || []),
    ];
    const audit = await buildResearchOsDataPathAudit(client);
    return await runAutoresearchHarnessRound({
      name: 'adjacency-research-os-eval',
      budgetMs: options.budgetMs || 300_000,
      journalPath: path.join(process.cwd(), 'data', 'automation', 'autoresearch-rounds.jsonl'),
      baseline: {
        seedDependenceRatioCap: requirePolicyNumber(policy, 'seedDependenceRatioMax'),
        autonomousQuestionRateTarget: requirePolicyNumber(policy, 'autonomousQuestionRateTarget'),
      },
      variantGenerator: async () => ({
        variant: { mode: 'eval-only', liveMutation: false },
        rationale: 'Evaluate current adjacency policy without changing live behavior.',
      }),
      execute: async () => ({
        ok: true,
        candidates: evaluationCandidates,
        metrics: scored.metrics,
        audit,
      }),
      metric: async (result) => ({
        connectorHitAt10: measureGold(result.candidates, goldset),
        negativeHitCount: measureNegative(result.candidates, negativeSet),
        canonicalPollutionCount: result.audit.ok ? 0 : 1,
        seedDependenceRatio: result.metrics.seedDependenceRatio,
        novelCandidateRate: result.metrics.explorationRate,
      }),
      acceptanceGate: (metrics, baseline) => (
        metrics.canonicalPollutionCount === 0
        && metrics.negativeHitCount === 0
        && metrics.seedDependenceRatio <= baseline.seedDependenceRatioCap
      ),
      decision: () => false,
    });
  } finally {
    if (ownClient) await client.end();
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runAdjacencyAutoresearch(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
