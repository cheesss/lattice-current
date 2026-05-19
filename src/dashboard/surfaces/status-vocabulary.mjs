const STATUS_LABELS = {
  pending: '승인 대기',
  approved: '승인됨',
  running: '실행 중',
  blocked: '막힘',
  needs_fix: '수정 필요',
  'needs-fix': '수정 필요',
  exhausted: '탐색 소진',
  complete: '완료',
  review_ready: '검토 가능',
  'review-ready': '검토 가능',
  rejected: '거절',
  promotion_collected: '승격 근거',
  context_collected: '맥락 근거',
  negative_collected: '반증 확인',
  weak_noise: '약한 신호',
  blocked_missing_issuer_universe: 'issuer 없음',
  market_validation_pending: '시장 검증 대기',
  negative_control_reject: '반증 거절',
  decision_grade: 'Decision grade',
  screening_grade: 'Screening grade',
  weak_screen: 'Weak screen',
  missing: 'Missing',
};

const STATUS_TONES = {
  pending: 'pending',
  approved: 'info',
  running: 'running',
  blocked: 'blocked',
  needs_fix: 'blocked',
  'needs-fix': 'blocked',
  exhausted: 'exhausted',
  complete: 'complete',
  review_ready: 'review',
  'review-ready': 'review',
  rejected: 'reject',
  promotion_collected: 'complete',
  context_collected: 'context',
  negative_collected: 'negative',
  weak_noise: 'weak',
  blocked_missing_issuer_universe: 'blocked',
  market_validation_pending: 'pending',
  negative_control_reject: 'reject',
};

const TIER_TONES = {
  decision_grade: 'complete',
  screening_grade: 'review',
  weak_screen: 'weak',
  promotion_candidate: 'complete',
  supporting_context: 'context',
  negative_control_candidate: 'negative',
  weak_noise: 'weak',
  missing: 'blocked',
};

const SHORT_TYPE_LABELS = {
  Appr: '승인',
  Prop: '제안',
  Disc: '발견',
  E2: 'E2 signal',
  HI: '고우선순위',
  FIX: '수정 필요',
};

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

export function toStatusLabel(status, context = {}) {
  const raw = String(status || '').trim();
  if (SHORT_TYPE_LABELS[raw]) return SHORT_TYPE_LABELS[raw];
  const key = normalizeToken(raw);
  if (context?.marketMissingReason && key === 'missing') {
    return `Missing: ${context.marketMissingReason}`;
  }
  return STATUS_LABELS[key] || STATUS_LABELS[raw] || raw || '상태 없음';
}

export function toStatusTone(status, context = {}) {
  const key = normalizeToken(status);
  if (context?.negativeControlStatus === 'invalidator') return 'reject';
  return STATUS_TONES[key] || STATUS_TONES[String(status || '')] || 'neutral';
}

export function toEvidenceTierTone(tier) {
  const key = normalizeToken(tier);
  return TIER_TONES[key] || 'neutral';
}

export function toNextActionCopy(row = {}) {
  const value = String(row.nextAction || '').trim();
  if (value) return value;
  const state = normalizeToken(row.state || row.visualStatus);
  const evidenceClass = String(row.evidenceClass || row.className || '').trim();
  if (state === 'blocked_missing_issuer_universe') return 'Resolve issuer universe';
  if (state === 'needs_fix') return 'Repair provider/query and retry';
  if (state === 'exhausted') return 'Review search exhaustion';
  if (state === 'running') return 'Wait for current run';
  if (state === 'promotion_collected') return 'Review for promotion';
  if (state === 'negative_collected') return 'Review negative-control lane';
  if (evidenceClass === 'market_validation') return 'Run controlled market validation';
  if (evidenceClass === 'negative_control') return 'Run separate negative-control query';
  return 'Route targeted backfill';
}

export function statusChip(status, options = {}) {
  const label = options.label || toStatusLabel(status, options);
  const tone = options.tone || toStatusTone(status, options);
  const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';
  return `<span class="modern-status-chip tone-${escapeHtml(tone)}"${title}>${escapeHtml(label)}</span>`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
