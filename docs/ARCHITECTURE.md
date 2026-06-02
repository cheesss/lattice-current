# Lattice Current — Architecture

Lattice Current is an evidence-first event-decision engine. It turns raw news into deduplicated, statistically-graded events, attaches a per-class evidence contract to each investigable mechanism, collects evidence through a read-only provider runtime, and refuses to surface any report as a candidate until a sequence of evidence gates closes and a human promotes it. The system spans five layers over a NAS Postgres database plus filesystem report artifacts.

**1. Ingestion & Canonical Event Resolution.** `article-ingestor.ts` ingests RSS/news articles into `articles` (deduped by title), generates an Ollama (`nomic-embed-text`) embedding, and auto-classifies a theme via pgvector nearest-neighbor against labeled anchors. `auto-pipeline.mjs` performs upstream enrichment (theme→symbol mapping, `labeled_outcomes`, sensitivity matrix) but never creates events. The wired `incremental-event-engine-fast.mjs` (Python-preferred, JS fallback) clusters same-day/same-theme articles by cosine similarity (≥0.7) into `canonical_events` with an `article_event_map` join, then computes `event_features`, `matched_controls`, and a date-matched-control `event_uplift` t-stat graded E0/E1/E2.

**2. Mechanism Seed + Evidence Contract.** `mechanism-seed-generator.mjs` deterministically expands a theme into a scored mechanism chain (Growth Driver → Real Activity → Physical Process → Required Input → Bottleneck → Supplier → Evidence/Counter-evidence) — read-only, zero DB writes. `seed-evidence-plan.mjs` routes each required evidence class via `evidence-provider-router.mjs` into source-query drafts; under `--apply` it persists `operator_research_seeds`, and only under explicit enqueue/API confirmation does it INSERT `source-query` rows into `approval_queue`. `universal-evidence-contract.mjs` supplies the shared evidence-class taxonomy (promotion-eligible vs negative-control/non-promotion) used at report time.

**3. Acceptance Lane + 8 Evidence Gates + Closure.** This is the honesty boundary. A pure acceptance lane (`seed-evidence-acceptance.mjs`) scores each raw row and forces `negative_control`, `provider_data_gap`, fixture-backed, and untiered `market_validation` into non-promotion supporting use. `evidence-gate-consolidator.mjs` folds accepted/promotion rows into per-seed state and evaluates **eight gates** — accepted_promotion_evidence, accepted_evidence, independent_source_breadth (≥2), issuer_bridge, negative_control, holdout, market_validation, valuation_bridge. A report stays **BLOCKED** until `missingGates` is empty, and even then is only *staged* for human review. Every output carries a self-declared `zeroBoundary()` (all write-counters = 0); `report-backfill-closure.mjs` reads Postgres read-only and fails safe to BLOCKED.

**4. Report Pipeline.** `generate-intelligence-report.mjs` loads a strict subject-bound bundle (`report-db-adapter.mjs`), synthesizes signal-cards → analyst synthesis → long-form narrative (`report-llm-analyst.mjs`, with an additive optional Codex overlay), then double-validates, compiles, and writes html/md/audit/csv artifacts under `data/reports/<id>/`. Source-query enqueue to `report_backfill_tasks` runs only on the `--db` path.

**5. Surfaces, Providers & Autonomous Runtime.** Five operator surfaces (Home / Decision Inbox / Investigate / Geo Lens / Ops) in `event-dashboard.html` are progressively enhanced by `src/dashboard/surfaces/*` and call read-only JSON endpoints. The provider router maps evidence classes to collectors; `staged-provider-live-executor.mjs` runs `*-readonly` collectors (DART/EDINET/TDnet/MOPS/IR — fixture-first, `ZERO_MUTATION_BOUNDARY`) and live adapters (SEC/FRED/EIA/FMP/Polygon). Daemons and bursts default to dry-run/plan-only; the only operator-triggered DB write is a confirm-gated seed-scoped source-query draft.

### Lattice Current — System Architecture & Data Flow

End-to-end Lattice Current architecture across all five layers. Raw news becomes deduplicated canonical events with matched-control uplift (Layer 1), mechanism seeds carry per-class evidence contracts (Layer 2), the provider runtime collects evidence read-only/fixture-first (Layer 5), an acceptance lane plus eight evidence gates keep every report BLOCKED until a human promotes it (Layer 3), and only then is an evidence-bound memo compiled (Layer 4). All autonomous paths default to read-only/dry-run; the single operator-triggered DB write is a confirm-gated source-query draft.

```mermaid
flowchart TB
  subgraph ING["1 - Ingestion & Canonical Event Resolution"]
    direction TB
    RSS["RSS / news fetchers"] --> AI["article-ingestor.ts<br/>ingest + Ollama embed<br/>pgvector NN theme"]
    AI --> ART[(articles)]
    AI --> PEND[(pending_outcomes)]
    APP["auto-pipeline.mjs<br/>steps 1-5 enrichment"] --> ATS[(auto_theme_symbols)]
    PEND -->|"checkPendingOutcomes"| LO[(labeled_outcomes)]
    APP --> LO
    ART -->|"cosine sim >= 0.7<br/>same day + theme"| EE["incremental-event-engine-fast.mjs<br/>(Python-preferred, JS fallback)"]
    EE --> CE[(canonical_events)]
    EE --> AEM[(article_event_map)]
    EE --> MC[(matched_controls)]
    LO --> UP[(event_uplift<br/>t-stat, grade E0/E1/E2)]
    MC --> UP
  end

  subgraph SEED["2 - Mechanism Seed + Evidence Contract"]
    direction TB
    DISCO["Theme / discovery inputs"] --> MSG["mechanism-seed-generator.mjs<br/>chain fill + score (read-only)"]
    MSG --> RAP["buildRouteAwareSeedEvidencePlan<br/>seed-evidence-plan.mjs"]
    UEC["universal-evidence-contract.mjs<br/>EVIDENCE_CLASS_PROFILES<br/>promotion-eligible vs negative-control"] -.shared vocab.-> RAP
    ROUTER["evidence-provider-router.mjs<br/>routeEvidenceProvider"] --> RAP
    RAP -->|"--apply"| ORS[(operator_research_seeds)]
    RAP -->|"--enqueue / API<br/>confirm-gated"| AQ[(approval_queue<br/>source-query)]
  end

  subgraph PROV["5 - Surfaces, Providers & Autonomous Runtime"]
    direction TB
    ROUTER --> CAP["collector-capability-matrix<br/>supported / collector_not_available"]
    EXEC["staged-provider-live-executor.mjs<br/>discover live allowlist or fixtures"]
    ROUTER --> EXEC
    EXEC --> RO["*-readonly collectors<br/>DART/EDINET/TDnet/MOPS/IR<br/>ZERO_MUTATION_BOUNDARY, fixture-first"]
    EXEC --> LIVEAD["live adapters<br/>SEC/FRED/EIA/FMP/Polygon...<br/>safeFetchJson"]
    BURST["master-daemon / research-burst<br/>dry-run default, --apply bounded"] --> EXEC
    BURST -.rejects unsafe boundary keys.-> ROUTER
  end

  subgraph GATE["3 - Acceptance Lane + 8 Evidence Gates + Closure"]
    direction TB
    ACC["acceptSeedEvidenceRows<br/>seed-evidence-acceptance.mjs<br/>(pure, no I/O)"] --> GC["buildEvidenceGateConsolidation<br/>per-seed state, 8 gates"]
    GC --> GATES{"missingGates == 0 ?"}
    GATES -->|"no"| BLOCKED["BLOCKED<br/>whyNotReportCandidate"]
    GATES -->|"yes"| STAGE["reportCandidateAllowed<br/>human-review staging"]
    GC -.->|"zeroBoundary()<br/>all write-counters = 0"| MB["mutation boundary"]
    LEDGER["buildReportBackfillClosureLedger<br/>visualStatus / primaryBlocker / nextAction"]
    STAGE --> LEDGER
  end

  subgraph RPT["4 - Report Pipeline (evidence-first DB-to-memo)"]
    direction TB
    GEN["generate-intelligence-report.mjs"] --> ADAPT["report-db-adapter<br/>buildDbReportBundle (strict fidelity)"]
    ADAPT --> BUN["report-evidence-bundle + deep-research-pack"]
    BUN --> ANL["report-llm-analyst<br/>signal-cards -> synthesis -> narrative<br/>(+ optional Codex overlay)"]
    ANL --> STORE["report-local-store<br/>validate x2 -> compile -> manifest"]
    STORE --> VALID["report-validator gates"]
    STORE --> DISK[("data/reports/<id>/<br/>html, md, audit, csv, registry")]
  end

  subgraph DATA["Data Layer (NAS Postgres + FS artifacts)"]
    direction LR
    PG[(Postgres signal tables<br/>articles, canonical_events,<br/>event_uplift, theme_trend_aggregates,<br/>operator_research_seeds, approval_queue,<br/>report_backfill_tasks)]
    FS[(data/reports artifacts<br/>evidence-gate-consolidation.json)]
  end

  ATS -.theme->symbol hints.-> SEED
  CE --> ADAPT
  AEM --> ADAPT
  UP --> ADAPT
  ORS --> EXEC
  AQ --> EXEC
  RO --> ACC
  LIVEAD --> ACC
  STORE -->|"--db only, enqueue"| RBT[(report_backfill_tasks)]
  RBT --> LEDGER
  LEDGER --> OPAPI["event-dashboard-api<br/>closure endpoint"]
  OPAPI --> OPSURF["event-dashboard.html surfaces<br/>Home / Inbox / Investigate / Geo / Ops"]
  OPSURF -->|"human promote<br/>BLOCKED vs review-ready"| DECISION{"Human review"}
  DECISION -->|"promote"| ORS
  DECISION -->|"reject / re-research"| BLOCKED

  PG --- DATA
  FS --- DATA
  ING --> DATA
  SEED --> DATA
  GATE --> DATA
  RPT --> DATA
```

### Evidence-Gate Pipeline — Acceptance Lane to 8 Gates to BLOCKED/Promote

The honesty boundary in detail. Raw rows pass a pure acceptance lane that forces negative_control, provider_data_gap, fixture-backed, and untiered market_validation into non-promotion supporting use. Surviving rows are consolidated and judged against eight named gates; a report stays BLOCKED until every gate closes, and even then it is only staged for a human to promote. The consolidator writes nothing to the DB (zeroBoundary, self-declared), and the closure ledger reads Postgres read-only, failing safe to BLOCKED when artifacts or DB rows are missing.

```mermaid
flowchart TB
  RAW["Raw evidence rows<br/>(staged-provider-live-executor)"] --> ACC["Acceptance lane<br/>acceptSeedEvidenceRows (pure)"]

  ACC -->|"blockers empty<br/>& promotion_candidate"| PROMO["promotion lane<br/>promotionEligible"]
  ACC -->|"blockers empty<br/>(non-promotion use)"| ACCEPTED["acceptedEvidence"]
  ACC -->|"negative_control / provider_data_gap<br/>market_validation w/o local tier<br/>fixture-backed / stale / boilerplate"| SUPP["supporting_context<br/>(never promotable)"]

  PROMO --> CONS["buildEvidenceGateConsolidation<br/>per-seed state (in-memory artifacts)"]
  ACCEPTED --> CONS
  SUPP --> CONS

  CONS --> FINAL["finalizeState — evaluate 8 gates"]

  subgraph G8["The 8 Evidence Gates"]
    direction TB
    G1["accepted_promotion_evidence >= 1"]
    G2["accepted_evidence >= 1"]
    G3["independent_source_breadth >= 2"]
    G4["issuer_bridge (CLOSED_ISSUER_BRIDGE)"]
    G5["negative_control (CLOSED_NEGATIVE_CONTROL)"]
    G6["holdout (holdoutConfirmed)"]
    G7["market_validation (CLOSED_MARKET_VALIDATION)"]
    G8a["valuation_bridge (CLOSED_VALUATION_BRIDGE)"]
  end

  FINAL --> G8
  G8 --> SPLIT{"missingGates.length == 0 ?"}

  CONS -.->|"zeroBoundary(): all<br/>write-counters = 0"| MB["mutationBoundary (self-declared)"]
  CONS --> ISS["suppressForIssuerDiligence<br/>may re-open issuer_bridge"]
  ISS -.-> SPLIT

  SPLIT -->|"no"| BLOCKED["BLOCKED<br/>nextGateAction / whyNotReportCandidate"]
  SPLIT -->|"yes"| READY["reportCandidateAllowedDiagnostic = true<br/>humanReviewPending"]

  READY --> STAGE["human-review staging<br/>(separate step — not automated)"]
  STAGE --> LEDGER["buildReportBackfillClosureLedger"]
  PG[("Postgres (read-only)<br/>report_backfill_tasks, approval_queue,<br/>research_evidence_bundles,<br/>external_provider_backfill_runs")] -->|"SELECT only, fail-safe to BLOCKED"| LEDGER
  LEDGER --> VS["visualStatus / primaryBlocker / nextAction<br/>default: blocked"]
  VS -->|"BLOCKED vs review-ready"| OP["closure endpoint -> operator promotes"]
```

### Core Data Model — Events, Uplift, Seeds & Closure

Core relational backbone. Articles are clustered (cosine >= 0.7, same day + theme) into canonical_events via the article_event_map join; each event gets a single event_uplift row (matched-control t-stat graded E0/E1/E2) computed against matched_controls. labeled_outcomes carry forward returns for both event and control samples and are backfilled with a canonical_event_id link. theme_trend_aggregates feeds the report subject row. On the operator side, operator_research_seeds (idempotent by seed_hash, with route-aware evidence_plan) spawn confirm-gated approval_queue source-query drafts and are audited by operator_research_seed_runs, while report_backfill_tasks track per-evidence-class closure for reports.

```mermaid
erDiagram
  articles ||--o{ article_event_map : "clustered into"
  canonical_events ||--o{ article_event_map : "groups"
  canonical_events ||--o| event_uplift : "graded by"
  canonical_events ||--o{ matched_controls : "compared against"
  articles ||--o{ labeled_outcomes : "forward returns"
  labeled_outcomes }o--o| canonical_events : "backfilled link"
  matched_controls ||--o{ labeled_outcomes : "control-date returns"
  theme_trend_aggregates ||--o{ articles : "theme subject of"
  operator_research_seeds ||--o{ operator_research_seed_runs : "audited by"
  operator_research_seeds ||--o{ approval_queue : "enqueues source-query"
  report_backfill_tasks }o--|| canonical_events : "backfills evidence for"

  articles {
    text title PK
    text theme
    vector embedding
    timestamp published_at
  }
  canonical_events {
    text event_id PK
    date event_date
    text theme
  }
  article_event_map {
    text article_id FK
    text event_id FK
  }
  event_uplift {
    text event_id FK
    float uplift
    float t_stat
    text evidence_grade
  }
  matched_controls {
    text event_id FK
    date control_date
    float distance
  }
  theme_trend_aggregates {
    text theme PK
    float acceleration
    float share
  }
  operator_research_seeds {
    text seed_hash PK
    text theme
    text status
    jsonb evidence_plan
  }
  report_backfill_tasks {
    text task_id PK
    text report_id
    text evidence_class
    text status
  }
```

## What these diagrams deliberately do not claim

Lattice is an evidence-first tool; in that spirit, here is what the architecture above does **not** assert:

- The 'matched-control uplift' (event_uplift) is coarse: controls are matched on DATE (same day-of-week, |Δvix|<=3, |Δyieldspread|<=0.2), NOT on matched symbols or true non-event days for the same symbol. Evidence grades cap at E2 in the engine (E3/E4 referenced by the report adapter are not produced here). The diagrams do not claim this is rigorous matched-control causal inference.
- abnormal_return is a single-factor market model (forward_return minus SPY forward_return). The 'fast' engine hard-codes vix_zscore/vix_momentum/hawkes_momentum to 0 — features shown are a reduced subset, not the full standalone feature set.
- 'Hawkes' intensity is a placeholder counter incremented +1 per article, not a fitted Hawkes process. The naming overstates the math actually present.
- The two cited engine scripts (build-canonical-events.mjs, incremental-event-engine.mjs) are standalone/legacy and NOT wired into automation; the diagrams depict the wired -fast / Python-preferred variants. The destructive full-rebuild (DELETE article_event_map + canonical_events) is the legacy path, not live behavior.
- The zeroBoundary / ZERO_MUTATION_BOUNDARY mutation guards are self-declared assertions (constant objects of zeros), not runtime interceptors of DB writes. Correctness depends on callers respecting them; the acceptance lane is genuinely pure and the consolidator only writes a JSON artifact.
- Autonomous loops keep readiness-promotion, report-candidate, and portfolio-action writes at 0. master-daemon and research-burst default to dry-run/--no-write; --apply enables only bounded execution and still cannot cross provider-activation/canonical/readiness/report-candidate/portfolio boundaries. The single operator DB write is a confirm-gated approval_queue source-query draft plus a seed status flip.
- market_validation is NOT promotable from a source-query and is not durable alpha: it requires local controlled-market data of an accepted tier (decision_grade/screening_grade/weak_screen) and is otherwise demoted to supporting_context. Controlled market validation is a separate, non-source-query step.
- Backtesting / forward returns run on legacy/backtest labeled_outcomes samples (forward_return_pct), not live trading; nothing here claims realized P&L.
- Promotion is never automated by this system. Gates closing only makes a seed eligible (reportCandidateAllowedDiagnostic=true, humanReviewPending); a human reads BLOCKED-vs-review-ready at the closure endpoint and promotes manually.
- The *-readonly collectors are fixture-first by default (DEFAULT_*_FIXTURES) and do not perform their own network fetch; live official-source extraction only happens when the staged executor supplies a discovered live allowlist. They are not live API integrations by default.
- Cold-start fragility: theme auto-classification depends on labeled_outcomes anchors (horizon='2w'); with no anchors theme='unknown', which is filtered out everywhere and never becomes a canonical_event.
- The closure ledger depends heavily on artifact-provided fields; if absent it defaults to evidenceState 'under_researched' / visualStatus 'blocked', and a 'review-ready' shown with a degraded dbContext (db_unreachable/db_access_denied) was computed from artifact data alone.
- The seed-side and report-side evidence contracts are parallel, not a single call chain: the Universal Evidence Contract operates on report bundles (consumed by report-deep-research-pack), while the seed path builds its own per-class plan via the provider router. Two overlapping COMMON_EVIDENCE_CLASSES lists coexist.
- Local source-query enqueue (_source-query-queue.jsonl) is intentionally artifact-only — every draft carries 'canonical source queue integration is intentionally deferred'; there are no live source-registry writes from the report pipeline.
- src/dashboard/surfaces/ contains only shell/decision-inbox/report-backfill/research-seeds enhancers — there are no per-surface home/investigate/geo/ops modules; the five surfaces are nav states in event-dashboard.html, and Geo Lens is a lightweight 2D map iframe, not a primary analytic surface.
