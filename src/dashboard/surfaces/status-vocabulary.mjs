const STATUS_LABELS = {
  pending: '승인 대기',
  approved: '승인됨',
  running: '실행 중',
  blocked: '막힘',
  needs_fix: '수정 필요',
  'needs-fix': '수정 필요',
  exhausted: '탐색 소진',
  complete: '완료',
  draft: '초안',
  needs_evidence: '근거 필요',
  evidence_running: '근거 수집 중',
  review_ready: '검토 가능',
  'review-ready': '검토 가능',
  rejected: '거절',
  promoted: '승격됨',
  report_candidate: '보고서 후보',
  report_generated: '보고서 생성됨',
  promotion_collected: '강한 근거',
  context_collected: '맥락 근거',
  negative_collected: '반증 확인',
  weak_noise: '약한 신호',
  blocked_missing_issuer_universe: 'issuer 없음',
  market_validation_pending: '시장 검증 대기',
  negative_control_reject: '반증 거절',
  adapter_or_source_coverage_review: '소스 보강 검토',
  blocked_missing_provider_gap_labels: 'provider gap 없음',
  provider_retry_deferred: 'provider 재시도 대기',
  direct_provider_backfill_required: 'provider 백필 필요',
  residual_provider_gap_review: '잔여 gap 검토',
  provider_backfill_complete: 'provider 완료',
  provider_backfill_exhausted: 'provider 소진',
  provider_backfill_deferred: 'provider 대기',
  direct_provider_exhausted: '직접 provider 소진',
  source_coverage_review: '소스 coverage 검토',
  no_provider_gap_review_needed: 'gap 검토 없음',
  decision_grade: 'Decision grade',
  screening_grade: 'Screening grade',
  weak_screen: 'Weak screen',
  missing: 'Missing',
  unknown: '상태 없음',
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
  draft: 'neutral',
  needs_evidence: 'pending',
  evidence_running: 'running',
  review_ready: 'review',
  'review-ready': 'review',
  rejected: 'reject',
  promoted: 'complete',
  report_candidate: 'review',
  report_generated: 'complete',
  promotion_collected: 'complete',
  context_collected: 'context',
  negative_collected: 'negative',
  weak_noise: 'weak',
  blocked_missing_issuer_universe: 'blocked',
  market_validation_pending: 'pending',
  negative_control_reject: 'reject',
  adapter_or_source_coverage_review: 'review',
  blocked_missing_provider_gap_labels: 'blocked',
  provider_retry_deferred: 'pending',
  direct_provider_backfill_required: 'pending',
  residual_provider_gap_review: 'review',
  provider_backfill_complete: 'complete',
  provider_backfill_exhausted: 'exhausted',
  provider_backfill_deferred: 'pending',
  direct_provider_exhausted: 'exhausted',
  source_coverage_review: 'review',
  no_provider_gap_review_needed: 'neutral',
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
  const state = normalizeToken(row.state || row.visualStatus || row.reviewState);
  const evidenceClass = String(row.evidenceClass || row.className || '').trim();
  if (state === 'blocked_missing_issuer_universe') return 'issuer universe를 먼저 해결';
  if (state === 'needs_fix') return 'provider/query 수정 후 재시도';
  if (state === 'exhausted' || state === 'provider_backfill_exhausted') return '탐색 소진 원인 검토';
  if (state === 'adapter_or_source_coverage_review') return 'provider gap 또는 소스 coverage 검토';
  if (state === 'running') return '현재 실행 완료 대기';
  if (state === 'promotion_collected') return '승격 후보 근거 검토';
  if (state === 'negative_collected') return 'negative-control lane 검토';
  if (evidenceClass === 'market_validation') return 'controlled market validation 실행';
  if (evidenceClass === 'negative_control') return 'negative-control query 별도 실행';
  return 'targeted backfill route 검토';
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
