# Improvement Plan: 60 Concrete Areas

## 1-20. Math, inference, and model logic

1. Replace scalar Kalman updates with multivariate state for cross-asset coupling.
2. Add explicit process-noise adaptation under volatility regime shifts.
3. Move from heuristic posterior bonuses to calibrated likelihood ratios.
4. Separate source truth discovery by claim type instead of one blended score.
5. Add probability calibration for event-to-asset mapping outputs.
6. Introduce decay by regime age rather than fixed smoothing only.
7. Add outlier-robust estimators for realized-return learning.
8. Model direction confidence and asset confidence separately.
9. Split transmission strength into causal, coincident, and narrative components.
10. Add horizon-specific conviction instead of one global conviction.
11. Carry uncertainty through sizing rather than only point estimates.
12. Add regime transition confidence, not only regime classification.
13. Make Hawkes parameters domain-specific by event family.
14. Replace static bandit context vector with standardized and clipped inputs.
15. Add posterior shrinkage for low-sample mappings.
16. Penalize high-correlation asset ideas during sizing.
17. Add Bayesian model averaging across signal families.
18. Separate alpha signals from hedge signals in evaluation.
19. Add cost/slippage assumptions to replay scoring.
20. Add explicit false-negative analysis for under-triggered events.

## 21-40. Collection, cleaning, and normalization

21. Introduce source-specific parsers before generic fallback normalization.
22. Add stricter title/body decontamination for ad/boilerplate text.
23. Keep provider-specific timestamps in raw form before normalization.
24. Add feed-level latency measurement and publish-to-ingest gap tracking.
25. Use stronger near-duplicate detection across language variants.
26. Score extraction confidence for entities and locations per item.
27. Add HTML snapshot sampling for parser regression triage.
28. Normalize country and region names against a single canonical registry.
29. Add source-level language detection validation.
30. Detect archive or evergreen articles before they reach alert ranking.
31. Separate opinion/editorial content from factual event reporting.
32. Track revision history where providers update articles post-publication.
33. Add schema validation at importer boundaries.
34. Log normalization failures as typed error classes, not opaque strings.
35. Add redaction layer for secrets or private URLs in debug traces.
36. Build better claim extraction before truth-discovery iterations.
37. Add per-provider clock-skew correction.
38. Annotate ingestion provenance through every downstream object.
39. Split raw event payload from normalized replay payload more strictly.
40. Add data quality scorecards per provider and per dataset.

## 41-60. Storage, archival, and persistence

41. Add retention classes for hot, warm, and cold data.
42. Move large replay outputs to columnar formats where possible.
43. Partition historical raw items by provider and transaction date.
44. Index replay frames by transaction time and knowledge boundary.
45. Add deterministic run manifests for replay reproducibility.
46. Track schema version inside every stored replay artifact.
47. Add archive compaction and vacuum scheduling.
48. Use UPSERT consistently for run metadata and learning state.
49. Store forward returns separately from run summaries for queryability.
50. Add checksum validation for imported files.
51. Add resumable importer checkpoints for large backfills.
52. Write importer failure records to a dead-letter table.
53. Distinguish storage for raw evidence versus derived analytics.
54. Add per-table storage metrics and growth reporting.
55. Add row-count and range verification after bulk sync.
56. Make Postgres sync idempotent by dataset/run identifiers.
57. Add archival export to Parquet for offline analysis.
58. Store sanitized public screenshots and docs assets outside runtime data paths.
59. Add point-in-time reproducibility checks for backtest datasets.
60. Add explicit provenance tables for model state updates.
