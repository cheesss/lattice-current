#!/usr/bin/env node
/**
 * source-adapter-proposal.mjs
 * Phase 6 Codex Repair Loop - Source Adapter Proposal Generator.
 *
 * Probes a failing source URL and sends a structured repair prompt to Codex CLI,
 * producing a human-reviewable adapter proposal. This script does not use
 * Claude Code or Anthropic APIs.
 *
 * Usage:
 *   node scripts/source-adapter-proposal.mjs --url <url>
 *   node scripts/source-adapter-proposal.mjs --url <url> --theme <theme>
 *   node scripts/source-adapter-proposal.mjs --url <url> --send
 *   node scripts/source-adapter-proposal.mjs --url <url> --dry-run
 */

import { pathToFileURL } from 'node:url';

/**
 * Build a Codex repair prompt from a probe result.
 *
 * @param {string} url
 * @param {string} theme
 * @param {object} probe SourceProbeResult from source-probe.mjs
 * @returns {string}
 */
export function buildRepairPrompt(url, theme, probe) {
  const adapterList = probe.adapterTried.join(', ');
  const errorList =
    probe.errors.map((e) => `  - ${e.adapter}: ${e.message}`).join('\n') || '  (none)';
  const qualityStr = JSON.stringify(probe.qualityBreakdown, null, 2);

  return `You are Codex, acting as a source adapter specialist for Lattice Current, a news event analysis platform.
Do not use Claude Code or Anthropic tooling.

A URL has failed automated source ingestion and requires a custom adapter or manual connector.

URL: ${url}
Theme: ${theme}
Probe Status: ${probe.status}
Connector Kind Detected: ${probe.connectorKind}
Adapters Tried: ${adapterList}
Next Action: ${probe.nextAction}
Quality Score: ${probe.qualityScore}
Trace ID: ${probe.traceId}

Adapter Errors:
${errorList}

Quality Breakdown:
${qualityStr}

Sample Items Found (${probe.sampleItems.length}):
${
    probe.sampleItems
      .map((item, i) => `  ${i + 1}. "${item.title}" -> ${item.url || 'no URL'}`)
      .join('\n') || '  (none)'
  }

Warnings:
${probe.warnings.map((w) => `  - ${w}`).join('\n') || '  (none)'}

Your task:
1. Explain why this URL failed automated extraction. Be specific about which adapter failed and why.
2. Determine the most likely content extraction strategy for this domain: RSS feed, API endpoint, sitemap, HTML scraping, etc.
3. Propose a concrete feed URL or extraction approach. Examples:
   - "The RSS feed is at https://example.com/rss.xml, found via robots.txt reference."
   - "The site uses WordPress REST API at https://example.com/wp-json/wp/v2/posts."
   - "The site requires HTML scraping with selector: article.post h2 a."
4. If the site appears to be paywalled or blocked, state that clearly.
5. If robots.txt disallows crawling, state that clearly.
6. Produce a human-reviewable connector proposal in this JSON format:
\`\`\`json
{
  "proposalType": "source-adapter",
  "inputUrl": "${url}",
  "suggestedResolvedUrl": "...",
  "connectorKind": "rss|atom|wp-json|html-selector|manual",
  "extractionDetails": "...",
  "selectorHint": "...",
  "confidence": 0.0,
  "requiresManualReview": true,
  "warnings": [],
  "reasoning": "..."
}
\`\`\`

IMPORTANT: Do not suggest registering the source automatically. This is a proposal for human review only.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { probeSource } = await import('./_shared/source-probe.mjs');
  const { loadOptionalEnvFile } = await import('./_shared/nas-runtime.mjs');

  loadOptionalEnvFile();

  const args = process.argv.slice(2);
  function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  }
  const url = getArg('--url');
  const theme = getArg('--theme') || 'general';
  const sendToApi = args.includes('--send');
  const dryRun = args.includes('--dry-run');

  if (!url) {
    console.error(
      'Usage: node scripts/source-adapter-proposal.mjs --url <url> [--theme <theme>] [--send] [--dry-run]',
    );
    process.exit(1);
  }

  console.error(`Probing: ${url}`);
  const probe = await probeSource(url, { theme });
  console.error(
    `Probe complete: status=${probe.status}, connector=${probe.connectorKind}, quality=${probe.qualityScore}, nextAction=${probe.nextAction}`,
  );

  if (probe.nextAction === 'register' || probe.nextAction === 'review') {
    console.log(
      JSON.stringify(
        {
          message: 'Source probe passed - no repair needed',
          probe: {
            status: probe.status,
            resolvedUrl: probe.resolvedUrl,
            connectorKind: probe.connectorKind,
            qualityScore: probe.qualityScore,
            nextAction: probe.nextAction,
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const prompt = buildRepairPrompt(url, theme, probe);

  if (dryRun || !sendToApi) {
    console.log(
      JSON.stringify(
        {
          url,
          theme,
          probe: {
            status: probe.status,
            connectorKind: probe.connectorKind,
            qualityScore: probe.qualityScore,
            nextAction: probe.nextAction,
            adapterTried: probe.adapterTried,
            errors: probe.errors,
            warnings: probe.warnings,
            traceId: probe.traceId,
          },
          codexPrompt: prompt,
        },
        null,
        2,
      ),
    );
    if (!sendToApi) process.exit(0);
  }

  console.error('\nSending to Codex CLI...');
  const { runCodexJsonPrompt } = await import('./_shared/codex-json.mjs');
  const result = await runCodexJsonPrompt(
    prompt,
    Number(process.env.SOURCE_ADAPTER_CODEX_TIMEOUT_MS || 120_000),
    { label: 'source-adapter-proposal' },
  );
  const responseText = result.message || result.stdout || '';

  console.log('\n--- Codex Adapter Proposal ---\n');
  console.log(responseText);

  if (result.parsed) {
    console.error('\nExtracted proposal:', JSON.stringify(result.parsed, null, 2));
  }
}
