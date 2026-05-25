import {
  buildHistoricalAnalogueBridge,
} from './historical-analogue-bridge.mjs';

const NO_RECOMMENDATION = 'No buy/sell/position-sizing recommendation is made.';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function evidenceIdsForIssuer(artifact = {}, issuer = '') {
  const upper = String(issuer || '').toUpperCase();
  return asArray(artifact.trackBIssuerEvidenceByIssuer?.[upper])
    .map((row) => row.evidenceId || row.id)
    .filter(Boolean);
}

function hasAnyMetric(row = {}, fields = []) {
  return fields.some((field) => row[field] !== null && row[field] !== undefined && row[field] !== '');
}

function normalizeIssuerUniverse(input = {}) {
  return uniqueStrings([
    input.issuerUniverse,
    input.dryRunReportSubject?.issuerUniverse,
    input.reportSubjectDryRun?.issuerUniverse,
    input.trackBIssuerCandidates,
  ], 6).map((issuer) => issuer.toUpperCase());
}

function localValuationRowFor(rows = [], issuer = '') {
  const upper = String(issuer || '').toUpperCase();
  return asArray(rows).find((row) => String(row.issuer || row.symbol || '').toUpperCase() === upper) || {};
}

function valuationCoverage(row = {}) {
  const fields = ['forwardPE', 'evToEbitda', 'evToSales', 'fcfYield', 'priceToSales', 'peerRelativeMultiple', 'historicalMultipleBand', 'marketCap', 'revenue', 'ebitda'];
  const covered = fields.filter((field) => row[field] !== null && row[field] !== undefined && row[field] !== '');
  if (covered.length >= 4) return { coverage: 'broad', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  if (covered.length >= 1) return { coverage: 'partial', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  return { coverage: 'missing', coveredFields: [], missingFields: fields };
}

function consensusCoverage(row = {}) {
  const fields = ['consensusRevenueRevision', 'consensusEpsRevision', 'consensusRevenueGrowth', 'consensusEPSGrowth', 'consensusEBITDAMargin', 'consensusRevisionDirection'];
  const covered = fields.filter((field) => row[field] !== null && row[field] !== undefined && row[field] !== '');
  if (covered.length >= 2) return { coverage: 'covered', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  if (covered.length === 1) return { coverage: 'partial', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  return { coverage: 'missing', coveredFields: [], missingFields: fields };
}

function peerCoverage(row = {}) {
  const fields = ['peerGroup', 'peerMedianForwardPE', 'peerMedianEVEBITDA', 'peerMedianEVSales', 'premiumDiscountToPeer', 'peerRelativeMultiple'];
  const covered = fields.filter((field) => {
    const value = row[field];
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
  if (covered.length >= 2) return { coverage: 'covered', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  if (covered.length === 1) return { coverage: 'partial', coveredFields: covered, missingFields: fields.filter((field) => !covered.includes(field)) };
  return { coverage: 'missing', coveredFields: [], missingFields: fields };
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentExcessMove90d(row = {}) {
  return finiteOrNull(
    row.localPriceWindow?.excessVsPeerBasket90d
    ?? row.localPriceWindow?.excessVsBenchmark90d
    ?? row.excessVsPeerBasket90d
    ?? row.excessVsBenchmark90d,
  );
}

function currentMultipleExpansion(row = {}) {
  return finiteOrNull(row.premiumDiscountToPeer ?? row.peerRelativeMove ?? row.peerContext?.peerRelativeMove);
}

function caveatedPriceExpectationCoverage(row = {}, peerMetric = {}) {
  const currentMove = currentExcessMove90d(row);
  const hasPeerContext = peerMetric.coverage !== 'missing';
  const hasExplicitCaveat = Boolean(compact(
    row.expectationContextCaveat
    || row.valuationContextSourceStatus
    || row.peerComparisonCaveat
    || row.fundamentalsCaveat,
  ));
  const hasTrustedLocalPriceContext = currentMove !== null
    && /^trusted_local_/i.test(compact(row.sourceProvenance || ''));
  return hasTrustedLocalPriceContext && (hasPeerContext || hasExplicitCaveat);
}

function buildPricedInRiskDiagnostic({ issuer, valuation = {}, acceptedIssuerPresent = false, historicalAnalogueBridge = null, consensusMetric = {} } = {}) {
  const bestAnalogueIds = asArray(historicalAnalogueBridge?.bestAnalogueIds);
  const analogueCount = Number(historicalAnalogueBridge?.usableAnalogueCount ?? bestAnalogueIds.length ?? 0);
  const currentMove = currentExcessMove90d(valuation);
  const analogueMedianMove = finiteOrNull(historicalAnalogueBridge?.analogueMedianExcessMove90d);
  const currentMultiple = currentMultipleExpansion(valuation);
  const analogueMedianMultiple = finiteOrNull(historicalAnalogueBridge?.analogueMedianMultipleExpansion);
  const estimateRevisionCoverage = consensusMetric.coverage === 'covered'
    ? 'covered'
    : consensusMetric.coverage === 'partial'
      ? 'partial'
      : 'missing';
  const caveats = uniqueStrings([
    historicalAnalogueBridge?.fixtureOnly ? 'historical_analogue_fixture_only_not_readiness_evidence' : null,
    currentMove === null ? 'current_excess_move_90d_missing' : null,
    analogueMedianMove === null ? 'analogue_median_excess_move_90d_missing' : null,
    analogueCount < 2 ? 'usable_historical_analogue_count_below_2' : null,
    acceptedIssuerPresent ? null : 'accepted_issuer_bridge_missing',
  ], 20);
  let reflectionStatus = 'insufficient_comparison_data';
  const rationale = [];
  if (valuation.pricedInRisk || valuation.contradictory || valuation.alreadyPricedInRisk) {
    reflectionStatus = 'priced_in_risk';
    rationale.push('local valuation cache marks priced-in or contradictory risk');
  } else if (!acceptedIssuerPresent || analogueCount < 2 || currentMove === null || analogueMedianMove === null) {
    reflectionStatus = 'insufficient_comparison_data';
    rationale.push('accepted issuer bridge, current price context, or usable analogue count is insufficient');
  } else if (currentMove >= analogueMedianMove || (currentMultiple !== null && analogueMedianMultiple !== null && currentMultiple >= analogueMedianMultiple)) {
    reflectionStatus = 'priced_in_risk';
    rationale.push('current excess move or multiple expansion is already at or above analogue median');
  } else if (currentMove <= analogueMedianMove - 0.05 && estimateRevisionCoverage !== 'missing') {
    reflectionStatus = 'under_reflected_candidate';
    rationale.push('current excess move trails analogue median while consensus/fundamental context exists');
  } else {
    reflectionStatus = 'partially_reflected';
    rationale.push('current excess move is below analogue median but comparison remains caveated');
  }
  return {
    issuer,
    analogueCount,
    bestAnalogueIds,
    currentExcessMove90d: currentMove,
    analogueMedianExcessMove90d: analogueMedianMove,
    currentMultipleExpansion: currentMultiple,
    analogueMedianMultipleExpansion: analogueMedianMultiple,
    estimateRevisionCoverage,
    reflectionStatus,
    rationale,
    caveats,
  };
}

function buildIssuerValuationRow({ issuer, artifact = {}, valuationRows = [], historicalAnalogueBridge = null } = {}) {
  const valuation = localValuationRowFor(valuationRows, issuer);
  const issuerEvidenceIds = uniqueStrings([
    evidenceIdsForIssuer(artifact, issuer),
    valuation.acceptedIssuerBridgeEvidenceIds,
  ], 50);
  const issuerMatrixRow = asArray(artifact.evidenceContractMatrix || artifact.evidenceContractMatrixSummary)
    .find((row) => row.evidenceClass === 'issuer_exposure' || row.evidenceClass === 'issuer_commentary_or_official_issuer_bridge') || {};
  const matrixIssuerAccepted = Number(issuerMatrixRow.acceptedCount || issuerMatrixRow.promotionEligibleCount || 0);
  const acceptedIssuerEvidenceCount = Number(
    valuation.acceptedIssuerEvidenceCount
    ?? (issuerEvidenceIds.length || (Number(artifact.trackBAcceptedIssuerEvidenceCount || 0) > 0 || matrixIssuerAccepted > 0 ? 1 : 0))
    ?? 0,
  );
  const acceptedIssuerPresent = acceptedIssuerEvidenceCount > 0
    || Number(artifact.trackBAcceptedIssuerEvidenceCount || 0) > 0
    || matrixIssuerAccepted > 0;
  const valuationMetric = valuationCoverage(valuation);
  const consensusMetric = consensusCoverage(valuation);
  const peerMetric = peerCoverage(valuation);
  const caveatedPriceExpectation = caveatedPriceExpectationCoverage(valuation, peerMetric);
  const pricedInRiskDiagnostic = buildPricedInRiskDiagnostic({
    issuer,
    valuation,
    acceptedIssuerPresent,
    historicalAnalogueBridge,
    consensusMetric,
  });
  const backlogOrGuidanceEvidence = acceptedIssuerPresent
    ? (valuation.backlogOrGuidanceEvidence || valuation.backlogToRevenueCommentary || 'accepted issuer bridge links backlog, guidance, capacity, demand, or project execution')
    : null;
  const operatingExposure = acceptedIssuerPresent
    ? (valuation.operatingExposure || valuation.powerDeliveryExposure || valuation.utilityInfrastructureExposure || valuation.transmissionSubstationExposure || 'accepted operating exposure tied to the selected bottleneck')
    : null;
  let expectationBridgeStatus = acceptedIssuerPresent
    ? (consensusMetric.coverage === 'covered' ? 'expectation_bridge_closed' : 'expectation_bridge_caveated')
    : 'expectation_bridge_missing';
  let valuationBridgeStatus = 'valuation_bridge_missing';
  if (valuation.contradictory === true || valuation.alreadyPricedInRisk === true) {
    valuationBridgeStatus = 'valuation_bridge_contradictory';
    expectationBridgeStatus = 'expectation_bridge_contradictory';
  } else if (acceptedIssuerPresent && valuationMetric.coverage === 'broad' && consensusMetric.coverage === 'covered' && peerMetric.coverage !== 'missing') {
    valuationBridgeStatus = 'valuation_bridge_closed';
  } else if (acceptedIssuerPresent && (valuationMetric.coverage !== 'missing' || consensusMetric.coverage !== 'missing' || caveatedPriceExpectation)) {
    valuationBridgeStatus = 'valuation_bridge_caveated';
  }
  const missingFields = uniqueStrings([
    valuationMetric.missingFields,
    consensusMetric.missingFields,
    peerMetric.missingFields,
    acceptedIssuerPresent ? [] : ['accepted issuer evidence'],
    valuation.segmentRevenueExposure ? [] : ['segment revenue exposure'],
    valuation.backlogConversionTiming ? [] : ['backlog-to-revenue conversion timing'],
    valuation.peerRelativeMultiple ? [] : ['peer relative multiple'],
  ], 40);
  return {
    issuer,
    roleClass: valuation.roleClass || 'issuer_operating_bridge_candidate',
    operatingExposure,
    acceptedIssuerEvidenceCount,
    backlogOrGuidanceEvidence,
    valuationMetricCoverage: valuationMetric.coverage,
    valuationMetricFields: valuationMetric.coveredFields,
    consensusMetricCoverage: consensusMetric.coverage,
    consensusMetricFields: consensusMetric.coveredFields,
    peerMetricCoverage: peerMetric.coverage,
    peerMetricFields: peerMetric.coveredFields,
    expectationBridgeStatus,
    valuationBridgeStatus,
    pricedInRisk: Boolean(valuation.pricedInRisk || valuation.alreadyPricedInRisk || valuation.contradictory),
    pricedInRiskDiagnostic,
    localPriceWindow: valuation.localPriceWindow || null,
    peerContext: valuation.peerContext || null,
    fundamentalsContext: valuation.fundamentalsContext || null,
    thesisUpsideCondition: valuation.thesisUpsideCondition || 'Backlog converts into revenue and margin without being fully reflected in expectations.',
    thesisFailureCondition: valuation.thesisFailureCondition || 'The operating bridge weakens, margins compress, or expectations already reflect the thesis.',
    caveats: uniqueStrings([
      valuation.caveats,
      valuationMetric.coverage === 'missing' ? 'valuation_metrics_missing' : null,
      consensusMetric.coverage === 'missing' ? 'consensus_metrics_missing' : null,
      peerMetric.coverage === 'missing' ? 'peer_metrics_missing' : null,
      caveatedPriceExpectation ? 'fundamentals_or_consensus_context_caveated' : null,
      valuation.pricedInRisk ? 'priced_in_risk_flag' : null,
      'diagnostic_only_not_investment_readiness',
    ], 20),
    missingFields,
    sourceProvenance: valuation.sourceProvenance || null,
    asOfDate: valuation.asOfDate || valuation.multipleAsOfDate || valuation.consensusAsOfDate || null,
    acceptedEvidenceIds: issuerEvidenceIds,
  };
}

function aggregateValuationStatus(rows = []) {
  const statuses = rows.map((row) => row.valuationBridgeStatus);
  if (statuses.some((status) => status === 'valuation_bridge_contradictory')) return 'valuation_bridge_contradictory';
  const closedOrCaveated = statuses.filter((status) => status === 'valuation_bridge_closed' || status === 'valuation_bridge_caveated').length;
  const closed = statuses.filter((status) => status === 'valuation_bridge_closed').length;
  if (closed >= 2) return 'valuation_bridge_closed';
  if (closedOrCaveated >= 2) return 'valuation_bridge_caveated';
  if (closedOrCaveated === 1) return 'valuation_bridge_caveated';
  return 'valuation_bridge_missing';
}

function aggregateExpectationStatus(rows = []) {
  const statuses = rows.map((row) => row.expectationBridgeStatus);
  if (statuses.some((status) => status === 'expectation_bridge_contradictory')) return 'expectation_bridge_contradictory';
  const closedOrCaveated = statuses.filter((status) => status === 'expectation_bridge_closed' || status === 'expectation_bridge_caveated').length;
  const closed = statuses.filter((status) => status === 'expectation_bridge_closed').length;
  if (closed >= 2) return 'expectation_bridge_closed';
  if (closedOrCaveated >= 1) return 'expectation_bridge_caveated';
  return 'expectation_bridge_missing';
}

function applyAnalogueStatusAdjustment({ valuationBridgeStatus, rows = [], historicalAnalogueBridge = null, requireHistoricalAnalogueBridge = false } = {}) {
  if (!historicalAnalogueBridge && !requireHistoricalAnalogueBridge) return valuationBridgeStatus;
  const diagnostics = rows.map((row) => row.pricedInRiskDiagnostic).filter(Boolean);
  if (diagnostics.some((diagnostic) => diagnostic.reflectionStatus === 'priced_in_risk' || diagnostic.reflectionStatus === 'contradictory')) {
    return 'valuation_bridge_contradictory';
  }
  if (!requireHistoricalAnalogueBridge) return valuationBridgeStatus;
  if (valuationBridgeStatus === 'valuation_bridge_missing') return valuationBridgeStatus;
  if (diagnostics.length && diagnostics.every((diagnostic) => diagnostic.reflectionStatus === 'insufficient_comparison_data')) {
    return 'valuation_bridge_caveated';
  }
  if (valuationBridgeStatus === 'valuation_bridge_closed' && diagnostics.some((diagnostic) => diagnostic.reflectionStatus === 'under_reflected_candidate')) {
    return 'valuation_bridge_closed';
  }
  return valuationBridgeStatus === 'valuation_bridge_closed' ? 'valuation_bridge_caveated' : valuationBridgeStatus;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values = []) {
  const nums = values.map(finiteNumber).filter((value) => value !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function classifyVolatilityRegime(row = {}) {
  if (row.volatilityRegime) return String(row.volatilityRegime);
  const vix = finiteNumber(row.vix || row.vixEvent || row.vix_event);
  if (vix !== null) {
    if (vix < 15) return 'low_vol';
    if (vix >= 25) return 'high_vol';
    return 'normal_vol';
  }
  const vol = finiteNumber(row.controlStddev || row.realizedVolatility || row.volatility);
  if (vol !== null) {
    if (vol < 0.75) return 'low_vol';
    if (vol > 2.5) return 'high_vol';
    return 'normal_vol';
  }
  return 'unknown';
}

function classifyRateRegime(row = {}) {
  if (row.rateRegime) return String(row.rateRegime);
  const change = finiteNumber(row.rateChange || row.yieldChange || row.tenYearYieldChange || row.rate_delta);
  if (change !== null) {
    if (change <= -0.05) return 'falling_rate';
    if (change >= 0.05) return 'rising_rate';
    return 'stable_rate';
  }
  return 'unknown';
}

function classifySectorRegime(row = {}) {
  if (row.sectorRegime) return String(row.sectorRegime);
  const sectorAdjusted = finiteNumber(row.sectorAdjustedReturn);
  const sectorMinusBenchmark = finiteNumber(row.sectorMinusBenchmark);
  const value = sectorAdjusted ?? sectorMinusBenchmark;
  if (value !== null) {
    if (value >= 0.25) return 'industrial_outperforming';
    if (value <= -0.25) return 'industrial_underperforming';
    return 'industrial_neutral';
  }
  return 'unknown';
}

function classifyMarketRegime(row = {}) {
  if (row.marketRegime) return String(row.marketRegime);
  const benchmarkReturn = finiteNumber(row.benchmarkReturn ?? row.benchmarkAdjustedReturn);
  if (benchmarkReturn !== null) {
    if (benchmarkReturn >= 0.5) return 'risk_on';
    if (benchmarkReturn <= -0.5) return 'risk_off';
    return 'neutral';
  }
  return 'unknown';
}

function enrichRegimeWindow(row = {}) {
  const volatilityRegime = classifyVolatilityRegime(row);
  const rateRegime = classifyRateRegime(row);
  const sectorRegime = classifySectorRegime(row);
  const marketRegime = classifyMarketRegime(row);
  const regimeBucket = row.regimeBucket || row.regime || [marketRegime, volatilityRegime, rateRegime, sectorRegime].join('/');
  const abnormalReturn = finiteNumber(row.abnormalReturn ?? row.eventMinusControl ?? row.benchmarkAdjustedReturn);
  const eventMinusControl = finiteNumber(row.eventMinusControl ?? row.abnormalReturn);
  const directionValue = eventMinusControl ?? abnormalReturn;
  const direction = directionValue === null
    ? 'unknown'
    : directionValue > 0
      ? 'supportive'
      : directionValue < 0
        ? 'contradictory'
        : 'neutral';
  return {
    ...row,
    volatilityRegime,
    rateRegime,
    sectorRegime,
    marketRegime,
    regimeBucket,
    abnormalReturn,
    eventMinusControl,
    direction,
    controlSampleSize: finiteNumber(row.controlSampleSize) ?? 0,
    tStat: finiteNumber(row.tStat ?? row.tstat ?? row.t),
    eventId: row.eventId || row.sourceEvidenceId || row.issuer || row.evidenceId || null,
    window: row.window || row.windowLabel || 'event_window',
  };
}

function countBy(values = [], keyFn = (value) => value) {
  return values.reduce((acc, value) => {
    const key = keyFn(value) || 'unknown';
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
}

function summarizeByRegime(windows = []) {
  const groups = new Map();
  for (const row of windows) {
    const key = row.regimeBucket || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const eventCountByRegime = {};
  const controlCountByRegime = {};
  const directionSupportByRegime = {};
  const abnormalReturnByRegime = {};
  const hitRateByRegime = {};
  for (const [key, rows] of groups.entries()) {
    const supportive = rows.filter((row) => row.direction === 'supportive').length;
    const contradictory = rows.filter((row) => row.direction === 'contradictory').length;
    eventCountByRegime[key] = rows.length;
    controlCountByRegime[key] = rows.reduce((sum, row) => sum + Number(row.controlSampleSize || 0), 0);
    directionSupportByRegime[key] = supportive > contradictory
      ? 'supportive'
      : contradictory > supportive
        ? 'contradictory'
        : supportive > 0
          ? 'mixed'
          : 'unknown';
    abnormalReturnByRegime[key] = average(rows.map((row) => row.abnormalReturn));
    hitRateByRegime[key] = rows.length ? supportive / rows.length : null;
  }
  return {
    eventCountByRegime,
    controlCountByRegime,
    directionSupportByRegime,
    abnormalReturnByRegime,
    hitRateByRegime,
  };
}

export function buildMarketValidationRegimeSupport(input = {}) {
  const warnings = uniqueStrings([input.marketValidationWarnings, input.marketValidationCaveats, input.warnings, input.caveats], 40);
  const marketValidationStatus = input.marketValidationStatus || 'missing';
  const sampleSize = Number(input.marketValidationSampleSize || input.sampleSize || 0);
  const windowResults = asArray(input.marketValidationWindowResults || input.windowResults).map(enrichRegimeWindow);
  const explicitRegimeScore = input.regimeConsistencyScore;
  const zeroRegimeWarning = warnings.includes('DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT')
    || /zero regime support/i.test(warnings.join(' '));
  const extremeTstatWarning = warnings.includes('sanity_check_extreme_tstat')
    || windowResults.some((row) => Math.abs(Number(row.tStat || 0)) >= 20);
  const benchmarkMissing = !input.marketValidationBenchmarkUsed && !input.benchmarkUsed;
  const controlMissing = !(input.marketValidationControlUsed ?? input.controlUsed);
  const inferredEventAnchorCount = new Set(windowResults.map((row) => row.eventId).filter(Boolean)).size;
  const configuredEventAnchorCount = Number(input.marketValidationEventAnchorCount || input.eventAnchorCount || 0);
  const eventAnchorCount = configuredEventAnchorCount || inferredEventAnchorCount;
  const windowControlTotal = windowResults.reduce((sum, row) => sum + Number(row.controlSampleSize || 0), 0);
  const singleEventDominated = Boolean(input.singleEventDominated)
    || eventAnchorCount <= 1;
  const regimeBucket = input.regimeBucket || windowResults[0]?.regimeBucket || 'unclassified';
  const volatilityRegime = input.volatilityRegime || 'unknown';
  const rateRegime = input.rateRegime || 'unknown';
  const sectorRegime = input.sectorRegime || 'unknown';
  const marketRegime = input.marketRegime || 'unknown';
  const summary = summarizeByRegime(windowResults);
  const eventCountByRegime = input.eventCountByRegime || summary.eventCountByRegime || {
    [regimeBucket]: Number(input.marketValidationEventAnchorCount || input.eventAnchorCount || sampleSize || 0),
  };
  const controlCountByRegime = input.controlCountByRegime || summary.controlCountByRegime || {};
  const directionSupportByRegime = input.directionSupportByRegime || summary.directionSupportByRegime || {
    [regimeBucket]: input.marketValidationDirection || input.direction || 'unknown',
  };
  const abnormalReturnByRegime = input.abnormalReturnByRegime || summary.abnormalReturnByRegime || {};
  const hitRateByRegime = input.hitRateByRegime || summary.hitRateByRegime || {};
  const regimeKeys = Object.keys(eventCountByRegime).filter((key) => Number(eventCountByRegime[key]) > 0);
  const knownRegimeKeys = regimeKeys.filter((key) => !String(key).includes('unknown'));
  const sampleRegimeCoverage = Number(input.sampleRegimeCoverage ?? knownRegimeKeys.length);
  const knownWindowCount = windowResults.filter((row) => !String(row.regimeBucket || '').includes('unknown')).length;
  const unknownRegimeShare = windowResults.length ? (windowResults.length - knownWindowCount) / windowResults.length : 1;
  const supportingRegimeCount = Object.values(directionSupportByRegime).filter((value) => value === 'supportive').length;
  const contradictoryRegimeCount = Object.values(directionSupportByRegime).filter((value) => value === 'contradictory').length;
  const directionalRegimeCount = supportingRegimeCount + contradictoryRegimeCount;
  const computedConsistency = directionalRegimeCount
    ? supportingRegimeCount / directionalRegimeCount
    : 'not_computable';
  const regimeConsistencyScore = explicitRegimeScore !== undefined
    ? Number(explicitRegimeScore)
    : zeroRegimeWarning
      ? 0
      : computedConsistency;
  const regimeCoverageScore = input.regimeCoverageScore !== undefined
    ? Number(input.regimeCoverageScore)
    : windowResults.length
      ? Math.min(1, knownRegimeKeys.length / 2) * (1 - unknownRegimeShare)
      : 'not_computable';
  const regimeSupportSampleSize = Number(input.regimeSupportSampleSize ?? (windowResults.length ? windowControlTotal : sampleSize) ?? 0);
  const largestRegimeCount = Math.max(0, ...Object.values(eventCountByRegime).map((value) => Number(value || 0)));
  const singleRegimeDominance = windowResults.length ? largestRegimeCount / windowResults.length : 1;
  const eventIdCounts = countBy(windowResults, (row) => row.eventId || 'unknown_event');
  const largestEventAnchorCount = Math.max(0, ...Object.values(eventIdCounts).map((value) => Number(value || 0)));
  const eventAnchorConcentration = windowResults.length ? largestEventAnchorCount / windowResults.length : 1;
  const duplicateAnchorCount = Object.values(eventIdCounts).filter((value) => Number(value || 0) > 1).reduce((sum, value) => sum + Number(value || 0) - 1, 0);
  const overlappingWindowCount = duplicateAnchorCount;
  const tStats = windowResults.map((row) => row.tStat).filter((value) => Number.isFinite(value));
  const tstatRaw = tStats.length ? tStats.reduce((max, value) => (Math.abs(value) > Math.abs(max) ? value : max), 0) : null;
  const tstatCapped = tstatRaw === null ? null : Math.max(-12, Math.min(12, tstatRaw));
  const effectiveSampleSize = Math.max(0, regimeSupportSampleSize - duplicateAnchorCount - overlappingWindowCount);
  const tstatSanityStatus = extremeTstatWarning
    ? (effectiveSampleSize < 30 || overlappingWindowCount > 0 ? 'caveated_extreme_tstat_not_decision_usable' : 'caveated_extreme_tstat')
    : tstatRaw === null
      ? 'not_computable'
      : 'within_sanity_bounds';
  const tstatWarningReason = extremeTstatWarning
    ? uniqueStrings([
      Math.abs(Number(tstatRaw || 0)) >= 20 ? 'extreme_abs_tstat' : null,
      effectiveSampleSize < 30 ? 'effective_sample_too_small' : null,
      overlappingWindowCount > 0 ? 'overlapping_or_duplicate_event_windows' : null,
    ], 10)
    : [];
  const missingRegimeInputs = uniqueStrings([
    windowResults.every((row) => row.volatilityRegime === 'unknown') ? 'volatilityRegime' : null,
    windowResults.every((row) => row.rateRegime === 'unknown') ? 'rateRegime' : null,
    windowResults.every((row) => row.sectorRegime === 'unknown') ? 'sectorRegime' : null,
    windowResults.every((row) => row.marketRegime === 'unknown') ? 'marketRegime' : null,
    benchmarkMissing ? 'benchmark_returns' : null,
    controlMissing ? 'matched_controls' : null,
  ], 20);
  let marketValidationRegimeStatus = 'regime_missing';
  if (/contradict/i.test(String(input.marketValidationRegimeStatus || ''))) {
    marketValidationRegimeStatus = 'regime_contradictory';
  } else if (contradictoryRegimeCount >= 2 && contradictoryRegimeCount > supportingRegimeCount && Number(regimeCoverageScore) > 0) {
    marketValidationRegimeStatus = 'regime_contradictory';
  } else if (!/^controlled_ready|market_validation_caveated/i.test(String(marketValidationStatus))) {
    marketValidationRegimeStatus = 'regime_missing';
  } else if (!windowResults.length || sampleRegimeCoverage <= 0) {
    marketValidationRegimeStatus = zeroRegimeWarning || extremeTstatWarning || sampleSize > 0 ? 'regime_caveated' : 'regime_missing';
  } else if (
    !zeroRegimeWarning
    && !extremeTstatWarning
    && !benchmarkMissing
    && !controlMissing
    && !singleEventDominated
    && Number(regimeConsistencyScore) >= 0.67
    && Number(regimeCoverageScore) >= 0.5
    && unknownRegimeShare <= 0.35
    && supportingRegimeCount >= 2
    && regimeSupportSampleSize >= 30
  ) {
    marketValidationRegimeStatus = 'regime_supported';
  } else {
    marketValidationRegimeStatus = 'regime_caveated';
  }
  let investmentReadinessMarketStatus = marketValidationStatus;
  if (zeroRegimeWarning || regimeConsistencyScore <= 0) {
    investmentReadinessMarketStatus = 'market_validation_caveated_for_investment_readiness';
  } else if (extremeTstatWarning) {
    investmentReadinessMarketStatus = 'controlled_ready_with_sanity_caveat';
  }
  const caveats = uniqueStrings([
    warnings,
    zeroRegimeWarning ? 'zero_regime_support_blocks_decision_grade' : null,
    extremeTstatWarning ? 'sanity_check_extreme_tstat' : null,
    benchmarkMissing ? 'benchmark_missing' : null,
    controlMissing ? 'control_missing' : null,
    singleEventDominated ? 'single_event_dominated_result' : null,
    regimeSupportSampleSize < 30 ? 'sample_too_small_for_regime_support' : null,
    unknownRegimeShare > 0.35 ? 'unknown_regime_share_high' : null,
    singleRegimeDominance > 0.75 ? 'single_regime_dominance' : null,
  ], 40);
  return {
    regimeBucket,
    volatilityRegime,
    rateRegime,
    sectorRegime,
    marketRegime,
    sampleRegimeCoverage,
    regimeConsistencyScore,
    regimeCoverageScore,
    regimeSupportSampleSize,
    unknownRegimeShare,
    singleRegimeDominance,
    eventAnchorConcentration,
    eventCountByRegime,
    controlCountByRegime,
    directionSupportByRegime,
    abnormalReturnByRegime,
    hitRateByRegime,
    tstatRaw,
    tstatCapped,
    tstatSanityCapped: extremeTstatWarning,
    tstatSanityStatus,
    tstatWarningReason,
    sampleSize,
    effectiveSampleSize,
    eventCount: windowResults.length,
    controlCount: regimeSupportSampleSize,
    duplicateAnchorCount,
    overlappingWindowCount,
    missingRegimeInputs,
    extremeTstatWarning,
    marketValidationRegimeStatus,
    investmentReadinessMarketStatus,
    marketValidationResearchUseAllowed: ['regime_supported', 'regime_caveated'].includes(marketValidationRegimeStatus),
    marketValidationInvestmentUseAllowed: marketValidationRegimeStatus === 'regime_supported',
    marketValidationDecisionUseAllowed: false,
    marketValidationDecisionGradeAllowed: false,
    caveats,
  };
}

function diagnosticFor({ valuationBridgeStatus, expectationBridgeStatus, marketRegimeSupport } = {}) {
  const missing = [];
  if (valuationBridgeStatus === 'valuation_bridge_missing') missing.push('valuation_or_expectation_bridge');
  if (expectationBridgeStatus === 'expectation_bridge_missing') missing.push('issuer_expectation_context');
  if (marketRegimeSupport.marketValidationRegimeStatus !== 'regime_supported') missing.push('market_validation_regime_support');
  let status = 'not_ready';
  if (valuationBridgeStatus === 'valuation_bridge_contradictory' || expectationBridgeStatus === 'expectation_bridge_contradictory') status = 'blocked_priced_in_or_contradictory_valuation';
  else if (valuationBridgeStatus === 'valuation_bridge_missing') status = 'blocked_missing_valuation_bridge';
  else if (expectationBridgeStatus === 'expectation_bridge_missing') status = 'blocked_expectation_bridge_missing';
  else if (marketRegimeSupport.marketValidationRegimeStatus === 'regime_missing') status = 'blocked_market_validation_regime_missing';
  else if (marketRegimeSupport.marketValidationRegimeStatus === 'regime_contradictory') status = 'blocked_market_validation_contradictory';
  else if (marketRegimeSupport.marketValidationRegimeStatus === 'regime_caveated') status = 'blocked_market_validation_regime_caveat';
  else if (valuationBridgeStatus === 'valuation_bridge_closed') status = 'ready_for_human_investment_memo_review';
  return {
    status,
    missingForInvestmentMemo: uniqueStrings(missing, 20),
    readyForInvestmentMemoReview: status === 'ready_for_human_investment_memo_review',
    notDecisionReadyReason: missing.length
      ? missing.join(', ')
      : 'human review required; diagnostic only; readiness promotion remains disabled',
    portfolioActionAllowed: false,
  };
}

export function buildValuationExpectationBridgeDryRun(input = {}) {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const issuerUniverse = normalizeIssuerUniverse(input);
  const valuationRows = asArray(input.localValuationRows || input.valuationRows || input.trustedFundamentalRows);
  const historicalAnalogueBridge = input.historicalAnalogueBridge
    || (input.historicalAnalogueCases || input.useHistoricalAnalogueBridge === true || input.requireHistoricalAnalogueBridge === true
      ? buildHistoricalAnalogueBridge({
        ...input,
        localValuationRows: valuationRows,
      })
      : null);
  const requireHistoricalAnalogueBridge = Boolean(
    input.requireHistoricalAnalogueBridge
    || input.historicalAnalogueBridge
    || input.historicalAnalogueCases,
  );
  const issuerValuationBridgeTable = issuerUniverse.map((issuer) => buildIssuerValuationRow({
    issuer,
    artifact: input,
    valuationRows,
    historicalAnalogueBridge,
  }));
  const baseValuationBridgeStatus = aggregateValuationStatus(issuerValuationBridgeTable);
  const valuationBridgeStatus = applyAnalogueStatusAdjustment({
    valuationBridgeStatus: baseValuationBridgeStatus,
    rows: issuerValuationBridgeTable,
    historicalAnalogueBridge,
    requireHistoricalAnalogueBridge,
  });
  const expectationBridgeStatus = aggregateExpectationStatus(issuerValuationBridgeTable);
  const marketRegimeSupport = buildMarketValidationRegimeSupport(input);
  const investmentMemoReadinessDiagnostic = diagnosticFor({
    valuationBridgeStatus,
    expectationBridgeStatus,
    marketRegimeSupport,
  });
  const missingValuationFields = uniqueStrings([
    issuerValuationBridgeTable.flatMap((row) => row.missingFields || []),
    requireHistoricalAnalogueBridge && (historicalAnalogueBridge?.usableAnalogueCount || 0) < 2 ? 'usable historical analogue count >= 2' : null,
    requireHistoricalAnalogueBridge && historicalAnalogueBridge?.analogueMedianExcessMove90d === null ? 'analogue median excess move 90d' : null,
    requireHistoricalAnalogueBridge && issuerValuationBridgeTable.some((row) => row.pricedInRiskDiagnostic?.currentExcessMove90d === null) ? 'issuer local excess move 90d' : null,
  ], 60);
  const caveats = uniqueStrings([
    issuerValuationBridgeTable.flatMap((row) => row.caveats || []),
    marketRegimeSupport.caveats,
    valuationBridgeStatus !== 'valuation_bridge_closed' ? 'valuation_bridge_not_closed' : null,
    'diagnostic_only_no_readiness_promotion',
  ], 60);
  return {
    ok: true,
    version: 'valuation-expectation-bridge-dry-run-v1',
    generatedAt,
    thesis: input.thesis || 'Selected cross-theme bottleneck operating bridge and valuation context',
    issuerUniverse,
    issuerValuationBridgeTable,
    historicalAnalogueBridge,
    pricedInRiskDiagnostics: issuerValuationBridgeTable.map((row) => row.pricedInRiskDiagnostic).filter(Boolean),
    expectationReflectionStatus: issuerValuationBridgeTable.some((row) => row.pricedInRiskDiagnostic?.reflectionStatus === 'priced_in_risk')
      ? 'priced_in_risk'
      : issuerValuationBridgeTable.some((row) => row.pricedInRiskDiagnostic?.reflectionStatus === 'under_reflected_candidate')
        ? 'under_reflected_candidate'
        : issuerValuationBridgeTable.some((row) => row.pricedInRiskDiagnostic?.reflectionStatus === 'partially_reflected')
          ? 'partially_reflected'
          : 'insufficient_comparison_data',
    localValuationCache: input.localValuationCache || null,
    sourceProvenance: input.localValuationCache?.sourceProvenance || uniqueStrings(issuerValuationBridgeTable.map((row) => row.sourceProvenance), 20),
    asOfDates: input.localValuationCache?.asOfDates || uniqueStrings(issuerValuationBridgeTable.map((row) => row.asOfDate), 20),
    valuationBridgeStatus,
    expectationBridgeStatus,
    missingValuationFields,
    remainingCaveats: caveats,
    marketRegimeSupport,
    marketValidationRegimeStatus: marketRegimeSupport.marketValidationRegimeStatus,
    regimeConsistencyScore: marketRegimeSupport.regimeConsistencyScore,
    regimeCoverageScore: marketRegimeSupport.regimeCoverageScore,
    eventCountByRegime: marketRegimeSupport.eventCountByRegime,
    directionSupportByRegime: marketRegimeSupport.directionSupportByRegime,
    unknownRegimeShare: marketRegimeSupport.unknownRegimeShare,
    extremeTstatWarning: marketRegimeSupport.extremeTstatWarning,
    tstatSanityStatus: marketRegimeSupport.tstatSanityStatus,
    marketValidationResearchUseAllowed: marketRegimeSupport.marketValidationResearchUseAllowed,
    marketValidationInvestmentUseAllowed: marketRegimeSupport.marketValidationInvestmentUseAllowed,
    marketValidationDecisionUseAllowed: marketRegimeSupport.marketValidationDecisionUseAllowed,
    investmentMemoReadinessDiagnostic,
    readyForHumanInvestmentMemoReview: investmentMemoReadinessDiagnostic.readyForInvestmentMemoReview,
    investmentMemoReady: false,
    decisionReady: false,
    portfolioActionAllowed: false,
    noRecommendationStatement: NO_RECOMMENDATION,
    caveats,
    nextRecommendedAction: investmentMemoReadinessDiagnostic.readyForInvestmentMemoReview
      ? 'human_investment_memo_review_required'
      : marketRegimeSupport.marketValidationRegimeStatus === 'regime_missing'
        ? 'repair_controlled_market_validation_regime_support'
        : 'collect_missing_valuation_expectation_context',
    boundaries: {
      providerActivationWrites: 0,
      readinessPromotionWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      approvalQueueWrites: 0,
      reportCandidateWrites: 0,
    },
  };
}

export function marketValidationRegimeMatrixFields(bridge = {}) {
  const support = bridge.marketRegimeSupport || bridge;
  const status = support.marketValidationRegimeStatus || bridge.marketValidationRegimeStatus || 'regime_missing';
  return {
    regimeSupportStatus: status,
    regimeConsistencyScore: support.regimeConsistencyScore ?? 'not_computable',
    regimeCoverageScore: support.regimeCoverageScore ?? 'not_computable',
    marketValidationResearchUseAllowed: Boolean(support.marketValidationResearchUseAllowed),
    marketValidationInvestmentUseAllowed: Boolean(support.marketValidationInvestmentUseAllowed),
    marketValidationDecisionUseAllowed: false,
    extremeTstatWarning: Boolean(support.extremeTstatWarning),
    tstatSanityStatus: support.tstatSanityStatus || 'not_computable',
    missingRegimeInputs: support.missingRegimeInputs || [],
    caveats: uniqueStrings([support.caveats, bridge.caveats], 60),
    blockingForInvestmentReadiness: status !== 'regime_supported',
    blockingForDecisionReadiness: true,
  };
}

export function valuationMatrixRowFromBridge(bridge = {}) {
  const closed = bridge.valuationBridgeStatus === 'valuation_bridge_closed';
  const caveated = bridge.valuationBridgeStatus === 'valuation_bridge_caveated';
  return {
    evidenceClass: 'valuation_or_expectation_bridge',
    required: false,
    acceptedCount: closed || caveated ? 1 : 0,
    promotionEligibleCount: 0,
    issuerCoverage: bridge.issuerUniverse || [],
    metricCoverage: bridge.issuerValuationBridgeTable?.map((row) => ({
      issuer: row.issuer,
      valuationMetricCoverage: row.valuationMetricCoverage,
      consensusMetricCoverage: row.consensusMetricCoverage,
      peerMetricCoverage: row.peerMetricCoverage,
    })) || [],
    consensusCoverage: bridge.expectationBridgeStatus || 'expectation_bridge_missing',
    peerCoverage: bridge.issuerValuationBridgeTable?.map((row) => ({
      issuer: row.issuer,
      peerMetricCoverage: row.peerMetricCoverage,
    })) || [],
    expectationCoverage: bridge.expectationBridgeStatus || 'expectation_bridge_missing',
    sourceGroups: ['local_valuation_expectation_diagnostic'],
    status: bridge.valuationBridgeStatus || 'valuation_bridge_missing',
    evidenceIds: closed || caveated
      ? (bridge.issuerUniverse || ['portfolio'])
        .map((issuer) => `accepted-valuation-bridge:${String(issuer || 'issuer').toLowerCase()}`)
      : [],
    blockingForInvestmentReadiness: bridge.valuationBridgeStatus !== 'valuation_bridge_closed',
    blockingForDecisionReadiness: true,
    blockingForThesisValidation: false,
    caveats: bridge.caveats || [],
    acceptedUse: 'investment_readiness_diagnostic',
    nextActionIfMissing: 'collect_local_fundamentals_consensus_peer_multiple_context',
  };
}

export function validateValuationExpectationBridgeDryRun(bridge = {}) {
  const blockers = [];
  const body = JSON.stringify(bridge);
  const boundaries = bridge.boundaries || {};
  const rows = asArray(bridge.issuerValuationBridgeTable);
  const add = (type, message) => blockers.push({ type, message });
  if (bridge.investmentMemoReady !== false) add('investment_memo_ready_not_allowed', 'investmentMemoReady must remain false in dry-run.');
  if (bridge.decisionReady !== false) add('decision_ready_not_allowed', 'decisionReady must remain false in dry-run.');
  if (bridge.portfolioActionAllowed !== false) add('portfolio_action_not_allowed', 'portfolioActionAllowed must remain false in dry-run.');
  for (const field of ['providerActivationWrites', 'readinessPromotionWrites', 'reportCandidateWrites', 'canonicalWrites', 'sourceRegistryWrites', 'approvalQueueWrites']) {
    if (Number(boundaries[field] || 0) !== 0) add(`${field}_must_be_zero`, `${field} must be zero.`);
  }
  if (/\b(buy|sell|position[-\s]?sizing|target price|overweight|underweight)\b/i.test(body.replace(NO_RECOMMENDATION, ''))) {
    add('portfolio_action_language', 'Valuation bridge dry-run cannot contain buy/sell/position-sizing language.');
  }
  if (/\b(cheap|expensive|undervalued|overvalued)\b/i.test(body)) {
    add('valuation_conclusion_language', 'Cheap/expensive valuation conclusions are not allowed in dry-run.');
  }
  for (const row of rows) {
    if (row.consensusMetricCoverage !== 'covered' && /consensus (expects|implies|supports|confirms)/i.test(JSON.stringify(row))) {
      add('unsupported_consensus_claim', `Consensus claim is not allowed without consensus evidence for ${row.issuer}.`);
    }
  }
  if (bridge.marketRegimeSupport?.regimeConsistencyScore === 0 && bridge.marketRegimeSupport?.marketValidationDecisionGradeAllowed === true) {
    add('zero_regime_support_decision_grade', 'Zero regime support cannot allow decision-grade market validation.');
  }
  if (bridge.marketRegimeSupport?.extremeTstatWarning && !asArray(bridge.caveats).includes('sanity_check_extreme_tstat')) {
    add('missing_extreme_tstat_caveat', 'Extreme t-stat warning must remain caveated.');
  }
  return {
    ok: blockers.length === 0,
    blockers,
  };
}
