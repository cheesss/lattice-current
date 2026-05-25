import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildAutomationFeedbackCodeRepairPrompt,
  buildParallelAutomationFeedbackCodeRepairBatch,
  buildAutomationFeedbackCodeRepairRequests,
  buildAutomationFeedbackCodeRepairSkippedRequests,
  classifyCodeRepairEvidenceEffect,
  runAutomationFeedbackCodeRepair,
} from '../scripts/_shared/automation-feedback-code-repair.mjs';
import {
  runAutomationFeedbackCodeRepairCli,
} from '../scripts/run-automation-feedback-code-repair.mjs';

function sampleRemediation() {
  return {
    version: 'automation-feedback-remediation-v1',
    providerFixtureRequirements: [
      {
        providerName: 'edinet',
        evidenceClass: 'issuer_exposure',
        priority: 1,
        requiredFixtures: ['positive_operating_bridge_fixture'],
      },
      {
        providerName: 'taiwan_mops',
        evidenceClass: 'holdout_validation',
        priority: 2,
      },
      {
        providerName: 'backfill-queue-executor',
        evidenceClass: 'issuer_exposure',
        priority: 3,
      },
    ],
    providerGapProposals: [
      {
        providerName: 'tdnet',
        fillsEvidenceClass: 'issuer_exposure',
      },
    ],
  };
}

const EMPTY_COLLECTOR_REGISTRY = Object.freeze({ collectors: [] });

async function writeWorkerFile(workspacePath, relFile, contents) {
  const target = path.join(workspacePath, relFile);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

test('automation feedback code repair builds bounded Codex CLI requests from remediation artifact', () => {
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation: sampleRemediation(),
    maxRepairs: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].providerName, 'edinet');
  assert.equal(requests[0].evidenceClass, 'issuer_exposure');
  assert.equal(requests[0].allowedFiles.includes('scripts/_shared/staged-provider-live-executor.mjs'), true);
  assert.equal(requests[0].allowedFiles.includes('scripts/_shared/external-data/edinet-readonly.mjs'), true);
  assert.equal(requests.some((request) => request.providerName === 'backfill-queue-executor'), false);
});

test('automation feedback code repair skips non-provider runtime remediation targets', () => {
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation: sampleRemediation(),
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'backfill-queue-executor'), true);
  assert.equal(skipped.find((request) => request.providerName === 'backfill-queue-executor').reason, 'not_a_provider_collector_repair_target');
});

test('automation feedback code repair does not invent collectors for abstract source routes', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'issuer_filing_transcript_or_contract', evidenceClass: 'issuer_exposure', priority: 1 },
      { providerName: 'technical_or_company_source', evidenceClass: 'technical_qualification', priority: 2 },
      { providerName: 'local-market-validation', evidenceClass: 'market_validation', priority: 3 },
      { providerName: 'source_query_negative_control', evidenceClass: 'negative_control', priority: 4 },
      { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 5 },
    ],
  };
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation,
    maxRepairs: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.deepEqual(requests.map((request) => request.providerName), ['edinet']);
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'issuer_filing_transcript_or_contract' && request.reason === 'not_a_provider_collector_repair_target'), true);
  assert.equal(skipped.some((request) => request.providerName === 'technical_or_company_source' && request.reason === 'not_a_provider_collector_repair_target'), true);
  assert.equal(skipped.some((request) => request.providerName === 'local-market-validation' && request.reason === 'not_a_provider_collector_repair_target'), true);
  assert.equal(skipped.some((request) => request.providerName === 'source_query_negative_control' && request.reason === 'not_a_provider_collector_repair_target'), true);
});

test('automation feedback code repair maps provider names to stable collector file conventions', () => {
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation: {
      providerFixtureRequirements: [
        { providerName: 'taiwan_mops', evidenceClass: 'issuer_exposure', priority: 1 },
        { providerName: 'company-ir-readonly', evidenceClass: 'holdout_validation', priority: 2 },
      ],
    },
    maxRepairs: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(requests[0].allowedFiles.includes('scripts/_shared/external-data/taiwan-mops-readonly.mjs'), true);
  assert.equal(requests[0].allowedFiles.includes('config/provider-collectors/taiwan_mops.json'), true);
  assert.equal(requests[1].allowedFiles.includes('scripts/_shared/external-data/company-ir-readonly.mjs'), true);
  assert.equal(requests[1].allowedFiles.includes('config/provider-collectors/company_ir_direct_pdf.json'), true);
});

test('automation feedback code repair does not repeat recently patched request ids', () => {
  const previousCodeRepair = {
    runs: [
      {
        status: 'patched',
        request: {
          requestId: 'code-repair-edinet-issuer_exposure',
          providerName: 'edinet',
          evidenceClass: 'issuer_exposure',
        },
      },
      {
        status: 'patched',
        request: {
          requestId: 'code-repair-provider-gap-tdnet-issuer_exposure',
          providerName: 'tdnet',
          evidenceClass: 'issuer_exposure',
        },
      },
    ],
  };
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation: sampleRemediation(),
    previousCodeRepair,
    maxRepairs: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(requests.some((request) => request.providerName === 'edinet'), false);
  assert.equal(requests.some((request) => request.providerName === 'tdnet'), false);
  assert.equal(requests[0].providerName, 'taiwan_mops');
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation: sampleRemediation(),
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'edinet' && request.reason === 'recently_patched_by_codex_cli'), true);
  assert.equal(skipped.some((request) => request.providerName === 'tdnet' && request.reason === 'recently_patched_by_codex_cli'), true);
});

test('automation feedback code repair cools down weak or ineffective patches instead of treating them as success', () => {
  const previousCodeRepair = {
    runs: [
      {
        status: 'patched_weak_effect',
        effectStatus: 'weak_effect',
        request: {
          requestId: 'code-repair-edinet-issuer_exposure',
          providerName: 'edinet',
          evidenceClass: 'issuer_exposure',
        },
      },
    ],
  };
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation: sampleRemediation(),
    previousCodeRepair,
    maxRepairs: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(requests.some((request) => request.providerName === 'edinet'), false);
  assert.equal(requests[0].providerName, 'taiwan_mops');
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation: sampleRemediation(),
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'edinet' && request.reason === 'recently_ineffective_codex_repair'), true);
});

test('automation feedback code repair preserves ineffective cooldown through plan-only artifacts', () => {
  const previousCodeRepair = {
    mode: 'plan_only',
    priorIneffectiveRepairIds: ['code-repair-edinet-issuer_exposure'],
    runs: [
      {
        status: 'patched_weak_effect',
        effectStatus: 'weak_effect',
        request: {
          requestId: 'code-repair-taiwan_mops-holdout_validation',
          providerName: 'taiwan_mops',
          evidenceClass: 'holdout_validation',
        },
      },
    ],
  };
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation: sampleRemediation(),
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'edinet' && request.reason === 'recently_ineffective_codex_repair'), true);
  assert.equal(skipped.some((request) => request.providerName === 'taiwan_mops' && request.reason === 'recently_ineffective_codex_repair'), true);
});

test('automation feedback code repair cools down sibling requests from ineffective provider', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'lbnl_interconnection_queue', evidenceClass: 'engineering_process', priority: 1 },
      { providerName: 'lbnl_interconnection_queue', evidenceClass: 'permitting_regulatory', priority: 2 },
      { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 3 },
    ],
  };
  const previousCodeRepair = {
    priorIneffectiveRepairIds: ['code-repair-lbnl_interconnection_queue-engineering_process'],
    runs: [],
  };
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation,
    maxRepairs: 2,
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.deepEqual(requests.map((request) => request.providerName), ['edinet']);
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation,
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => (
    request.providerName === 'lbnl_interconnection_queue'
    && request.evidenceClass === 'permitting_regulatory'
    && request.reason === 'provider_recently_ineffective_codex_repair'
  )), true);
});

test('automation feedback code repair treats timed out Codex workers as provider cooldown', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'taiwan_mops', evidenceClass: 'issuer_exposure', priority: 1 },
      { providerName: 'taiwan_mops', evidenceClass: 'holdout_validation', priority: 2 },
      { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 3 },
    ],
  };
  const previousCodeRepair = {
    runs: [
      {
        status: 'failed',
        codexResult: { timedOut: true, code: 124 },
        request: {
          requestId: 'code-repair-taiwan_mops-issuer_exposure',
          providerName: 'taiwan_mops',
        },
      },
    ],
  };
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation,
    maxRepairs: 2,
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.deepEqual(requests.map((request) => request.providerName), ['edinet']);
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation,
    previousCodeRepair,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(skipped.some((request) => request.providerName === 'taiwan_mops' && request.reason === 'recently_ineffective_codex_repair'), true);
  assert.equal(skipped.some((request) => request.providerName === 'taiwan_mops' && request.reason === 'provider_recently_ineffective_codex_repair'), true);
});

test('automation feedback code repair classifies accepted/promotion evidence delta as effective', () => {
  assert.equal(classifyCodeRepairEvidenceEffect({
    rawEvidenceDelta: 3,
    acceptedEvidenceDelta: 1,
    acceptedPromotionEvidenceDelta: 0,
  }).effectStatus, 'effective');
  assert.equal(classifyCodeRepairEvidenceEffect({
    rawEvidenceDelta: 3,
    acceptedEvidenceDelta: 0,
    acceptedPromotionEvidenceDelta: 0,
  }).effectStatus, 'weak_effect');
  assert.equal(classifyCodeRepairEvidenceEffect({
    rawEvidenceDelta: 0,
    acceptedEvidenceDelta: 0,
    acceptedPromotionEvidenceDelta: 0,
  }).effectStatus, 'ineffective');
});

test('automation feedback code repair prompt forbids readiness and report candidate writes', () => {
  const request = buildAutomationFeedbackCodeRepairRequests({
    remediation: sampleRemediation(),
    maxRepairs: 1,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  })[0];
  const prompt = buildAutomationFeedbackCodeRepairPrompt(request);
  assert.match(prompt, /Do not enable automatic investment readiness/);
  assert.match(prompt, /Raw evidence must never auto-promote/);
  assert.match(prompt, /Allowed write scope/);
  assert.match(prompt, /Return JSON only/);
});

test('automation feedback code repair dry-run plans requests without executing Codex', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: false,
      maxRepairs: 1,
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      writeArtifact: true,
      artifactPath: path.join(tmp, 'automation-feedback-code-repair.latest.json'),
    });
    assert.equal(payload.mode, 'plan_only');
    assert.equal(payload.requestCount, 1);
    assert.equal(payload.executedCount, 0);
    assert.equal(payload.skippedRequestCount, 1);
    assert.deepEqual(payload.priorSuccessfulRepairIds, []);
    assert.equal(payload.runs[0].executed, false);
    assert.equal(payload.mutationBoundary.readinessPromotionWrites, 0);
    const saved = JSON.parse(await readFile(payload.artifactPath, 'utf8'));
    assert.equal(saved.version, 'automation-feedback-code-repair-v1');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair skips provider and evidence class already covered by a collector', () => {
  const requests = buildAutomationFeedbackCodeRepairRequests({
    remediation: sampleRemediation(),
    maxRepairs: 3,
    providerCollectorRegistry: {
      collectors: [
        {
          providerName: 'edinet',
          evidenceClasses: ['issuer_exposure'],
          valid: true,
        },
      ],
    },
  });
  assert.equal(requests.some((request) => request.providerName === 'edinet'), false);
  const skipped = buildAutomationFeedbackCodeRepairSkippedRequests({
    remediation: sampleRemediation(),
    providerCollectorRegistry: {
      collectors: [
        {
          providerName: 'edinet',
          evidenceClasses: ['issuer_exposure'],
          valid: true,
        },
      ],
    },
  });
  assert.equal(skipped.some((request) => request.providerName === 'edinet' && request.reason === 'collector_already_registered_for_evidence_class'), true);
});

test('automation feedback code repair CLI reads remediation artifact in plan mode', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-cli-'));
  try {
    await writeFile(path.join(tmp, 'automation-feedback-remediation.latest.json'), JSON.stringify(sampleRemediation()), 'utf8');
    const payload = await runAutomationFeedbackCodeRepairCli([
      '--runtime-root',
      tmp,
      '--max-repairs',
      '1',
    ]);
    assert.equal(payload.mode, 'plan_only');
    assert.equal(payload.requestCount, 1);
    assert.equal(payload.runs[0].request.providerName, 'taiwan_mops');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair selects a parallel batch without duplicate provider/class pairs', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 1 },
      { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 2 },
      { providerName: 'taiwan_mops', evidenceClass: 'holdout_validation', priority: 3 },
      { providerName: 'tdnet', evidenceClass: 'issuer_exposure', priority: 4 },
      { providerName: 'dart', evidenceClass: 'issuer_exposure', priority: 5 },
    ],
  };
  const batch = buildParallelAutomationFeedbackCodeRepairBatch({
    remediation,
    maxRepairs: 10,
    parallelWorkers: 3,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(batch.length, 1);
  assert.deepEqual(batch.map((request) => request.providerName), ['edinet']);
  assert.equal(new Set(batch.map((request) => `${request.providerName}:${request.evidenceClass}`)).size, 1);
});

test('automation feedback code repair parallel batch avoids same provider and collector file conflicts', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'iso_rto_interconnection_queue_report', evidenceClass: 'engineering_process', priority: 1 },
      { providerName: 'iso_rto_interconnection_queue_report', evidenceClass: 'permitting_regulatory', priority: 2 },
      { providerName: 'lbnl_interconnection_queue', evidenceClass: 'engineering_process', priority: 3 },
      { providerName: 'ferc_interconnection_reform', evidenceClass: 'permitting_regulatory', priority: 4 },
    ],
  };
  const batch = buildParallelAutomationFeedbackCodeRepairBatch({
    remediation,
    maxRepairs: 10,
    parallelWorkers: 3,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(batch.length, 1);
  assert.deepEqual(batch.map((request) => request.providerName), [
    'iso_rto_interconnection_queue_report',
  ]);
  assert.equal(batch.filter((request) => request.providerName === 'iso_rto_interconnection_queue_report').length, 1);
  const providerFiles = batch.flatMap((request) => request.allowedFiles.filter((file) => file.includes('/external-data/')));
  assert.equal(new Set(providerFiles).size, providerFiles.length);
});

test('automation feedback code repair can intentionally exercise merge conflict handling when requested', () => {
  const remediation = {
    providerFixtureRequirements: [
      { providerName: 'iso_rto_interconnection_queue_report', evidenceClass: 'engineering_process', priority: 1 },
      { providerName: 'lbnl_interconnection_queue', evidenceClass: 'engineering_process', priority: 2 },
    ],
  };
  const batch = buildParallelAutomationFeedbackCodeRepairBatch({
    remediation,
    maxRepairs: 2,
    parallelWorkers: 2,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
    avoidSharedIntegrationConflicts: false,
  });
  assert.equal(batch.length, 2);
});

test('automation feedback code repair parallel batch respects max repairs below worker count', () => {
  const batch = buildParallelAutomationFeedbackCodeRepairBatch({
    remediation: {
      providerFixtureRequirements: [
        { providerName: 'edinet', evidenceClass: 'issuer_exposure', priority: 1 },
        { providerName: 'taiwan_mops', evidenceClass: 'holdout_validation', priority: 2 },
        { providerName: 'tdnet', evidenceClass: 'issuer_exposure', priority: 3 },
      ],
    },
    maxRepairs: 1,
    parallelWorkers: 3,
    providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
  });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].providerName, 'edinet');
});

test('automation feedback code repair parallel mode creates snapshot workspaces and merges non-overlapping provider patches', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-parallel-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 2,
      maxRepairs: 2,
      verify: false,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      avoidSharedIntegrationConflicts: false,
      workerRunner: async ({ request, workspacePath }) => {
        const collectorFile = request.allowedFiles.find((file) => file.startsWith('scripts/_shared/external-data/'));
        await writeWorkerFile(workspacePath, collectorFile, `export const providerName = ${JSON.stringify(request.providerName)};\n`);
        return {
          codexResult: {
            code: 0,
            parsed: { status: 'patched', changedFiles: [collectorFile] },
            stdoutTail: '',
            stderrTail: '',
          },
          verificationResults: [],
        };
      },
    });
    assert.equal(payload.mode, 'execute_codex_cli_parallel');
    assert.equal(payload.parallel, true);
    assert.equal(payload.executedCount, 2);
    assert.equal(payload.parallelExecution.workerStatuses.length, 2);
    assert.equal(payload.parallelExecution.patchesApplied.length, 2);
    assert.equal(payload.parallelExecution.patchesRejected.length, 0);
    assert.equal(payload.mutationBoundary.providerActivationWrites, 0);
    assert.match(
      await readFile(path.join(tmp, 'scripts/_shared/external-data/edinet-readonly.mjs'), 'utf8'),
      /edinet/,
    );
    assert.match(
      await readFile(path.join(tmp, 'scripts/_shared/external-data/taiwan-mops-readonly.mjs'), 'utf8'),
      /taiwan_mops/,
    );
    for (const worker of payload.parallelExecution.workerStatuses) {
      const resultPath = path.join(worker.workerArtifactDir, 'worker-result.json');
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      assert.equal(result.isolated, true);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair parallel mode rejects overlapping common-file patches', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-conflict-'));
  try {
    const commonFile = 'scripts/_shared/staged-provider-live-executor.mjs';
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 2,
      maxRepairs: 2,
      verify: false,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      avoidSharedIntegrationConflicts: false,
      workerRunner: async ({ request, workspacePath }) => {
        await writeWorkerFile(workspacePath, commonFile, `export const patchedBy = ${JSON.stringify(request.providerName)};\n`);
        return {
          codexResult: {
            code: 0,
            parsed: { status: 'patched', changedFiles: [commonFile] },
            stdoutTail: '',
            stderrTail: '',
          },
          verificationResults: [],
        };
      },
    });
    assert.equal(payload.parallelExecution.patchesApplied.length, 0);
    assert.equal(payload.parallelExecution.mergeConflicts.length, 2);
    assert.equal(payload.parallelExecution.patchesRejected.every((patch) => patch.reason === 'operator_review_required_merge_conflict'), true);
    await assert.rejects(readFile(path.join(tmp, commonFile), 'utf8'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair parallel mode rejects forbidden runtime changes from workers', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-forbidden-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 1,
      maxRepairs: 1,
      verify: false,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      workerRunner: async ({ workspacePath }) => {
        await writeWorkerFile(workspacePath, 'data/runtime/unsafe-generated-output.json', '{"unsafe":true}\n');
        return {
          codexResult: {
            code: 0,
            parsed: { status: 'patched', changedFiles: ['data/runtime/unsafe-generated-output.json'] },
            stdoutTail: '',
            stderrTail: '',
          },
          verificationResults: [],
        };
      },
    });
    assert.equal(payload.parallelExecution.patchesApplied.length, 0);
    assert.equal(payload.parallelExecution.patchesRejected.length, 1);
    assert.equal(payload.parallelExecution.patchesRejected[0].reason, 'forbidden_patch_path');
    await assert.rejects(readFile(path.join(tmp, 'data/runtime/unsafe-generated-output.json'), 'utf8'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair accepts structured patched worker output when coordinator verification passes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-exit-code-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 1,
      maxRepairs: 1,
      verify: false,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      workerRunner: async ({ request, workspacePath }) => {
        const collectorFile = request.allowedFiles.find((file) => file.startsWith('scripts/_shared/external-data/'));
        await writeWorkerFile(workspacePath, collectorFile, `export const providerName = ${JSON.stringify(request.providerName)};\n`);
        return {
          codexResult: {
            code: 1,
            parsed: { status: 'patched', changedFiles: [collectorFile] },
            stdoutTail: '',
            stderrTail: 'nonzero wrapper exit after successful structured patch',
          },
          verificationResults: [
            { command: 'fake-targeted-test', code: 0 },
          ],
        };
      },
    });
    assert.equal(payload.ok, true);
    assert.equal(payload.runs[0].status, 'patched');
    assert.equal(payload.parallelExecution.patchesApplied.length, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair marks merged patch effective only after accepted evidence delta', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-effect-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 1,
      maxRepairs: 1,
      verify: false,
      verifyEvidenceDelta: true,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      workerRunner: async ({ request, workspacePath }) => {
        const collectorFile = request.allowedFiles.find((file) => file.startsWith('scripts/_shared/external-data/'));
        await writeWorkerFile(workspacePath, collectorFile, `export const providerName = ${JSON.stringify(request.providerName)};\n`);
        return {
          codexResult: {
            code: 0,
            parsed: { status: 'patched', changedFiles: [collectorFile] },
            stdoutTail: '',
            stderrTail: '',
          },
          verificationResults: [],
        };
      },
      evidenceDeltaVerifier: async () => ({
        before: { rawEvidenceCount: 10, acceptedEvidenceCount: 1, acceptedPromotionEvidenceCount: 0 },
        after: { rawEvidenceCount: 12, acceptedEvidenceCount: 2, acceptedPromotionEvidenceCount: 1 },
        delta: {
          rawEvidenceDelta: 2,
          acceptedEvidenceDelta: 1,
          acceptedPromotionEvidenceDelta: 1,
          sourceQualityTerminalBlockerDelta: 0,
          providerQualityRecordDelta: 0,
          remediationNextActionChanged: false,
        },
        effectStatus: 'effective',
        strongEffect: true,
        weakEffect: false,
        reason: 'accepted_or_promotion_evidence_increased',
      }),
    });
    assert.equal(payload.runs[0].status, 'patched_effective');
    assert.equal(payload.runs[0].effectStatus, 'effective');
    assert.equal(payload.parallelExecution.evidenceDeltaAfterMerge.effectStatus, 'effective');
    assert.equal(payload.parallelExecution.patchesRolledBack.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('automation feedback code repair rolls back ineffective patches after no evidence or blocker delta', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-code-repair-ineffective-'));
  try {
    const payload = await runAutomationFeedbackCodeRepair({
      remediation: sampleRemediation(),
      execute: true,
      parallel: true,
      parallelWorkers: 1,
      maxRepairs: 1,
      verify: false,
      verifyEvidenceDelta: true,
      writeArtifact: false,
      cwd: tmp,
      workspaceRoot: path.join(tmp, 'runtime', 'workspaces'),
      providerCollectorRegistry: EMPTY_COLLECTOR_REGISTRY,
      workerRunner: async ({ request, workspacePath }) => {
        const collectorFile = request.allowedFiles.find((file) => file.startsWith('scripts/_shared/external-data/'));
        await writeWorkerFile(workspacePath, collectorFile, `export const providerName = ${JSON.stringify(request.providerName)};\n`);
        return {
          codexResult: {
            code: 0,
            parsed: { status: 'patched', changedFiles: [collectorFile] },
            stdoutTail: '',
            stderrTail: '',
          },
          verificationResults: [],
        };
      },
      evidenceDeltaVerifier: async () => ({
        before: { rawEvidenceCount: 10, acceptedEvidenceCount: 1, acceptedPromotionEvidenceCount: 0 },
        after: { rawEvidenceCount: 10, acceptedEvidenceCount: 1, acceptedPromotionEvidenceCount: 0 },
        delta: {
          rawEvidenceDelta: 0,
          acceptedEvidenceDelta: 0,
          acceptedPromotionEvidenceDelta: 0,
          sourceQualityTerminalBlockerDelta: 0,
          providerQualityRecordDelta: 0,
          remediationNextActionChanged: false,
        },
        effectStatus: 'ineffective',
        strongEffect: false,
        weakEffect: false,
        reason: 'no_evidence_or_blocker_delta',
      }),
    });
    const collectorFile = 'scripts/_shared/external-data/edinet-readonly.mjs';
    assert.equal(payload.runs[0].status, 'ineffective_rolled_back');
    assert.equal(payload.runs[0].effectStatus, 'ineffective');
    assert.equal(payload.parallelExecution.patchesRolledBack.includes(collectorFile), true);
    await assert.rejects(readFile(path.join(tmp, collectorFile), 'utf8'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
