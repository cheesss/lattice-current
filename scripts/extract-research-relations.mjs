#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import {
  ensureResearchOsSchema,
  upsertKnowledgeNode,
  upsertKnowledgeEdge,
  upsertKnowledgeEdgeEvidence,
} from './_shared/adjacency-graph.mjs';
import { buildRelationsFromEvidenceBundle } from './_shared/relation-extractor.mjs';
import { extractRelationsWithApiLlm, shouldUseApiLlm } from './_shared/llm-relation-provider.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './_shared/research-os-policy.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const llmLimitArg = argv.find((arg) => arg.startsWith('--llm-limit='))?.split('=')[1];
  return {
    dryRun: args.has('--dry-run'),
    useLlm: args.has('--use-llm'),
    limit: limitArg ? Number(limitArg) : undefined,
    llmLimit: llmLimitArg ? Number(llmLimitArg) : undefined,
  };
}

async function loadEvidenceBundles(client, limit) {
  const { rows } = await client.query(
    `SELECT b.id,
            b.question_id,
            b.source_type,
            b.source_id,
            b.title,
            b.text_excerpt,
            b.url,
            b.published_at,
            b.relevance_score,
            b.metadata,
            q.question_type,
            q.themes,
            q.seed_terms,
            q.prompt
       FROM research_evidence_bundles b
       JOIN research_questions q ON q.id = b.question_id
      ORDER BY b.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

async function loadCompanyNodes(client) {
  const { rows } = await client.query(
    `SELECT id, node_type, canonical_name, normalized_key, aliases
       FROM knowledge_nodes
      WHERE node_type = 'company'
      ORDER BY updated_at DESC
      LIMIT 2000`,
  );
  return rows;
}

async function persistRelation(client, relation, bundle) {
  const subject = await upsertKnowledgeNode(client, {
    nodeType: relation.subjectType,
    canonicalName: relation.subject,
    status: 'candidate',
    createdBy: 'relation-extractor',
    metadata: { source: 'research-os-relation-extractor' },
  }, { skipEnsure: true });
  const object = await upsertKnowledgeNode(client, {
    nodeType: relation.objectType,
    canonicalName: relation.object,
    status: 'candidate',
    createdBy: 'relation-extractor',
    metadata: { source: 'research-os-relation-extractor' },
  }, { skipEnsure: true });
  const edge = await upsertKnowledgeEdge(client, {
    sourceNodeId: subject.id,
    targetNodeId: object.id,
    relationType: relation.relation,
    confidence: relation.confidence,
    evidenceCount: 1,
    sourceDiversity: 1,
    status: 'candidate',
    createdBy: 'relation-extractor',
    metadata: {
      caveat: relation.caveat,
      extractionMode: relation.metadata?.extractionMode || 'deterministic',
      questionId: bundle.question_id,
    },
  }, new Map(), { skipEnsure: true });
  await upsertKnowledgeEdgeEvidence(client, {
    edgeId: edge.id,
    sourceType: bundle.source_type,
    sourceId: bundle.source_id,
    quote: relation.evidenceQuote,
    evidenceStrength: relation.evidenceStrength,
    url: bundle.url,
    metadata: {
      bundleId: bundle.id,
      questionId: bundle.question_id,
      caveat: relation.caveat,
    },
  }, { skipEnsure: true });
}

export async function runExtractResearchRelations(options = {}) {
  loadOptionalEnvFile();
  const policy = options.policy || loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    const bundles = await loadEvidenceBundles(client, options.limit || 120);
    const companyNodes = await loadCompanyNodes(client);
    const useLlm = shouldUseApiLlm(policy, options);
    const maxLlmBundles = Math.max(0, Number(options.llmLimit || requirePolicyNumber(policy, 'relationExtraction.maxLlmBundlesPerRun')));
    let relationCount = 0;
    let persisted = 0;
    let llmCalls = 0;
    let llmSkipped = 0;
    let llmRejected = 0;
    const byMode = {};
    for (const bundle of bundles) {
      const question = {
        id: bundle.question_id,
        questionType: bundle.question_type,
        themes: bundle.themes || [],
        seedTerms: bundle.seed_terms || [],
        prompt: bundle.prompt,
      };
      const relations = buildRelationsFromEvidenceBundle(bundle, question, {
        companyNodes,
        maxPhrases: options.maxPhrases || 6,
      });
      relationCount += relations.length;
      for (const relation of relations) {
        const mode = relation.metadata?.extractionMode || 'unknown';
        byMode[mode] = (byMode[mode] || 0) + 1;
        if (!options.dryRun) {
          await persistRelation(client, relation, bundle);
          persisted += 1;
        }
      }
      if (useLlm && llmCalls < maxLlmBundles) {
        const llmResult = await extractRelationsWithApiLlm({
          queryable: options.dryRun ? null : client,
          bundle,
          question,
          policy,
          llmExtractor: options.llmExtractor,
        });
        if (llmResult.skipped) {
          llmSkipped += 1;
        } else {
          llmCalls += 1;
          llmRejected += llmResult.rejected.length;
          relationCount += llmResult.accepted.length;
          for (const relation of llmResult.accepted) {
            const mode = relation.metadata?.extractionMode || 'api-llm';
            byMode[mode] = (byMode[mode] || 0) + 1;
            if (!options.dryRun) {
              await persistRelation(client, relation, bundle);
              persisted += 1;
            }
          }
        }
      }
    }
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      bundleCount: bundles.length,
      relationCount,
      persisted,
      byMode,
      llmCalls,
      llmSkipped,
      llmRejected,
      note: useLlm
        ? 'API LLM extraction was enabled behind validation and budget gates.'
        : 'API LLM extraction disabled by policy/env; deterministic extraction ran.',
    };
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
  runExtractResearchRelations(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
