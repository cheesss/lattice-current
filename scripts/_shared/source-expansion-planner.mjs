import { normalizeKnowledgeKey, stableResearchOsId } from './adjacency-graph.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';

function compact(value) {
  return String(value || '').trim();
}

function quoted(value) {
  const text = compact(value).replace(/"/g, '');
  return text.includes(' ') ? `"${text}"` : text;
}

export function buildSourceExpansionQueries(candidate = {}, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const node = candidate.node || {};
  const connector = compact(node.canonicalName || candidate.connector || candidate.connectorName);
  const supplier = compact(candidate.supplierName || candidate.supplier || '');
  const themes = Array.isArray(candidate.themes) ? candidate.themes.map(compact).filter(Boolean) : [];
  const connectorKey = normalizeKnowledgeKey(connector);
  const supplierKey = normalizeKnowledgeKey(supplier);
  const primary = connector || supplier;
  const terms = [
    supplier && connector && supplierKey !== connectorKey ? `${quoted(supplier)} ${quoted(connector)}` : '',
    primary && themes[0] ? `${quoted(primary)} ${quoted(themes[0])} supplier evidence` : '',
    primary && themes[1] ? `${quoted(primary)} ${quoted(themes[1])} bottleneck evidence` : '',
    supplier && themes[0] ? `${quoted(supplier)} ${quoted(themes[0])}` : '',
    primary ? `${quoted(primary)} manufacturer supply chain evidence` : '',
  ].filter(Boolean);
  const maxQueries = Math.max(1, Number(options.limit || requirePolicyNumber(policy, 'sourceExpansion.maxQueriesPerCandidate')));
  const unique = [...new Set(terms)].slice(0, maxQueries);
  return unique.map((query) => ({
    id: stableResearchOsId(['source-query', candidate.id || connector, query]),
    query,
    reason: `Evidence expansion for ${connector || supplier || 'cross-theme candidate'}`,
    approvalRequired: true,
    source: 'cross-theme-research-os',
  }));
}

export function planSourceExpansion(candidates = [], options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const minEvidenceQuality = Number(options.minEvidenceQuality ?? requirePolicyNumber(policy, 'sourceExpansion.minEvidenceQuality'));
  const plans = [];
  for (const candidate of candidates || []) {
    const evidenceQuality = Number(candidate?.evidenceSummary?.evidenceQuality || 0);
    if (evidenceQuality >= minEvidenceQuality && !options.includeStrongEvidence) continue;
    const queries = buildSourceExpansionQueries(candidate, options);
    if (!queries.length) continue;
    plans.push({
      candidateId: candidate.id,
      status: 'approval_required',
      queries,
      writePath: 'codex_proposals_or_approval_queue_only',
      bypassAllowed: false,
    });
  }
  return {
    ok: true,
    plans,
    approvalRequired: true,
  };
}
