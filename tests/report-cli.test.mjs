import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('generate-intelligence-report writes reproducible report artifacts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-'));
  try {
    const result = spawnSync(process.execPath, [
      'scripts/generate-intelligence-report.mjs',
      '--sample',
      '--type',
      'cross_theme_bottleneck_report',
      '--subject',
      'Linde cryogenic cooling',
      '--out-dir',
      tmp,
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(tmp, 'manifest.json'), 'utf8'));
    const bundle = JSON.parse(await readFile(path.join(tmp, 'bundle.json'), 'utf8'));
    const html = await readFile(path.join(tmp, 'report.html'), 'utf8');
    const audit = await readFile(path.join(tmp, 'audit_appendix.html'), 'utf8');
    const validation = JSON.parse(await readFile(path.join(tmp, 'validation.json'), 'utf8'));
    assert.equal(manifest.reportType, 'cross_theme_bottleneck_report');
    assert.equal(validation.status === 'passed' || validation.status === 'warning', true);
    assert.equal(bundle.figures.every((figure) => figure.renderAssetId), true);
    assert.match(html, /Linde cryogenic cooling/);
    assert.match(html, /<img class="figure-img"/);
    assert.doesNotMatch(html, /Metric Ledger|Query Manifest|\brefs\s+\d+\b/i);
    assert.match(audit, /Validation/);
    assert.match(audit, /Metric Ledger/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
