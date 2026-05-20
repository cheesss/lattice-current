# Cross-Theme Research OS Plan

Date: 2026-05-03

Status: implementation + hardening in progress

Scope: make Lattice autonomously discover research questions, cross-theme bottlenecks, components, materials, suppliers, companies, and evidence-backed candidate signals without polluting canonical data.

## 0. Implementation Checkpoint - 2026-05-03

Implemented durable slices:

- Policy-driven Research OS config with local override support.
- Candidate/private/canonical boundary document and forbidden write-path tests.
- Research question generation from autonomous triggers.
- Candidate industrial graph tables and seed import.
- Evidence bundle collection from current NAS evidence sources.
- Deterministic relation extraction plus optional budget-gated API LLM provider.
- Cross-theme scorer with seed-dependence cap, research backlog separation, and graph-frontier themes.
- Source expansion planner that writes approval-gated source queries only.
- Human review, private tracking, and source-query API routes.
- Trusted-promotion gate that promotes only reviewed/evidence-backed candidates and queues canonical proposals instead of mutating canonical taxonomy.
- Autoresearch harness with append-only journal and no live-pollution default.
- Dashboard section for Cross-Theme Research with visible boundary, pathway names, caveats, and evidence backlog toggle.
- Master daemon tasks for foundation, evidence collection, relation extraction, candidate refresh, source expansion, trusted promotion, policy advisor, and adjacency autoresearch.

Current measured state:

```text
canonical_pollution_count = 0
autonomous_question_rate = 1.00
main_surface_seed_dependence_ratio = 0.333 <= configured cap 0.35
research_backlog_candidates = evidence-expansion pool, not main surface
source expansion = approval_queue only
API LLM extraction = available but disabled by default until provider/model/key policy is set
trusted promotion = installed; no candidates currently eligible because direct evidence is still thin
```

Remaining convergence work:

- Approve or execute source-query proposals, collect new evidence, and rerun evidence/relation/candidate refresh until `needs_evidence` candidates gain direct evidence.
- Enable an LLM provider in policy/env only when token budget and credentials are ready.
- Add Korean labels for the new Cross-Theme section.
- Run repeated scheduled cycles and confirm S-tier criteria across multiple snapshots, not one run.

## 1. Product Goal

Lattice should evolve from a theme-led signal dashboard into an evidence-first research operating system.

The target behavior:

```text
Live signals
-> autonomous research questions
-> evidence collection
-> relation extraction
-> industrial knowledge graph
-> cross-theme connector scoring
-> candidate briefing
-> human feedback
-> source expansion
-> autoresearch improvement loop
```

Example:

```text
Space Economy and Quantum Computing are both rising
-> system asks what physical bottlenecks connect them
-> discovers cryogenic cooling, helium-3, liquid hydrogen, dilution refrigeration
-> links possible suppliers such as Linde, Air Liquide, Bluefors, Chart Industries
-> attaches evidence and caveats
-> shows candidate in Cross-Theme Connectors
-> user can Accept, Watch, Reject, Track privately, or open investigation
```

The final product should not require the user to continuously provide seeds. Initial seeds are only calibration anchors. The system must generate new research directions from live data.

## 2. Non-Negotiable Boundaries

Automatic outputs must never directly mutate canonical product truth.

Required separation:

```text
private_tracking       user-specific preferences and targets
candidate_graph        machine-generated hypotheses
trusted_graph          evidence-backed and reviewed relationships
canonical_taxonomy     product-wide official themes and relationships
```

Forbidden direct writes:

- LLM output must not directly write to canonical taxonomy.
- LLM output must not directly write to model training tables or labeled outcomes.
- User private tracking must not auto-promote into canonical themes.
- Source expansion must not bypass approval queue.
- Autoresearch variants must not edit live dashboard/server core by default.
- Candidate graph must not create hidden database triggers into canonical/model tables.

Promotion path:

```text
candidate
-> watch
-> trusted
-> canonical proposal
-> human approval
-> canonical
```

## 3. Seed Anchoring Bias Controls

Risk: if early examples are `space + quantum -> cryogenic cooling -> Linde`, the system may overfit to industrial gas and cooling suppliers.

Required controls:

```text
seed_similarity_weight <= 10%
exploration_quota >= 30%
novelty_score required for every batch
unsupervised discovery path required
feedback decay required
candidate diversity constraints required
```

Rules:

- Seeds are calibration anchors, not complete truth.
- Seed overlap can boost confidence slightly, but cannot dominate ranking.
- Every batch must include exploration candidates that are dissimilar to seed examples.
- Rejected candidates receive a decaying penalty, not a permanent ban.
- Strong new evidence can revive a previously rejected candidate.
- The system must report seed-similarity dependence in evaluation.

Anti-patterns to avoid:

```text
"Find more things like Linde"
"Use the seed examples as the target pattern"
"Only reward candidates that match the initial gold set"
"Hide weird-but-rising candidates because they are not in known seeds"
```

Preferred prompt framing:

```text
The examples are output-format calibration only. Do not copy their industry, material, or supplier pattern unless the evidence independently supports it. Prefer newly observed shared bottlenecks, components, materials, and suppliers.
```

## 4. Automation Level Requirements

Risk: the feature can degrade into a manual keyword tool if the user must provide every next seed.

Required automation triggers:

- `hot_theme`: one theme shows rising heat or momentum.
- `theme_pair`: two hot themes rise together.
- `explanation_gap`: theme is hot but related entities/suppliers are sparse or repetitive.
- `novel_phrase`: new taxonomy-external phrase appears across sources.
- `source_divergence`: OpenAlex, GitHub, SEC, or news moves before other sources.
- `user_interest`: followed themes or private targets imply a research area.
- `stale_brief_gap`: theme brief repeatedly has empty related entities or adjacent pathways.
- `low_supplier_diversity`: same tickers keep appearing while the theme is broad.
- `high_validation_gap`: many events are pending validation but lack explanatory pathways.

Automation success metric:

```text
autonomous_question_rate = research questions created without direct user seed / all research questions
```

Target:

```text
autonomous_question_rate >= 0.80
```

Manual seed use should be limited to:

- calibration examples
- occasional correction
- user-specific private tracking
- explicit investigation requests

## 5. Phase 0: Guardrails And Data Boundaries

Deliverables:

- `docs/CROSS_THEME_DATA_BOUNDARIES.md`
- `config/research-os.defaults.json`
- `config/research-os.local.json` or `research_os_policy` table
- pollution guard tests
- database write-path audit for new tables
- release check integration

Acceptance criteria:

```text
canonical_pollution_count = 0
candidate/trusted/canonical/private boundaries documented
forbidden write-path test passes
no database trigger path from candidate/private tables into canonical/model tables
```

Policy values in this plan are guardrail defaults, not magic numbers to hard-code in implementation. Every threshold, quota, score weight, and schedule must be loaded from config or policy tables and exposed through Ops diagnostics.

Required policy storage:

```text
research_os_policy
or
config/research-os.defaults.json + config/research-os.local.json
```

Required policy audit:

```text
policy_key
old_value
new_value
changed_by
reason
shadow_result
rollback_rule
created_at
approved_at
```

## 6. Phase 1: Research Question Generator

Goal: make the system create research questions without waiting for user-provided seeds.

New module:

```text
scripts/_shared/research-question-generator.mjs
scripts/generate-research-questions.mjs
```

New table:

```sql
CREATE TABLE IF NOT EXISTS research_questions (
  id BIGSERIAL PRIMARY KEY,
  question_type TEXT NOT NULL,
  themes TEXT[] NOT NULL DEFAULT '{}',
  seed_terms TEXT[] NOT NULL DEFAULT '{}',
  prompt TEXT NOT NULL,
  trigger_reason TEXT,
  novelty_score NUMERIC,
  heat_score NUMERIC,
  gap_score NUMERIC,
  priority_score NUMERIC,
  status TEXT NOT NULL DEFAULT 'new',
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Input sources:

- `theme_trend_aggregates`
- `event_hawkes_intensity`
- `articles`
- `discovery_topics`
- followed themes
- tracked targets
- empty related entity / adjacent pathway states
- OpenAlex, GitHub, SEC, and news divergence summaries

Example generated questions:

```json
{
  "questionType": "theme_pair",
  "themes": ["space", "quantum-computing"],
  "prompt": "Find shared physical bottlenecks, components, materials, and suppliers connecting Space Economy and Quantum Computing.",
  "triggerReason": "both themes show rising momentum"
}
```

```json
{
  "questionType": "explanation_gap",
  "themes": ["cloud-infrastructure"],
  "prompt": "Current coverage overuses hyperscalers and chips. Find upstream physical infrastructure suppliers, bottlenecks, and materials.",
  "triggerReason": "high heat but low supplier diversity"
}
```

Acceptance criteria:

- daily generation of research questions from non-user-seed triggers
- duplicate questions are deduped
- question priority is explainable
- stale/answered questions cool down
- autonomous question rate is tracked

## 7. Phase 2: Industrial Knowledge Graph

Goal: move beyond `theme -> stock` into `theme -> technology -> component -> material/process/infrastructure -> supplier/company/ticker`.

New modules:

```text
scripts/_shared/adjacency-graph.mjs
scripts/migrations/create-adjacency-graph.mjs
scripts/import-theme-seeds-to-graph.mjs
```

Tables:

```sql
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id BIGSERIAL PRIMARY KEY,
  node_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_type, normalized_key)
);
```

```sql
CREATE TABLE IF NOT EXISTS knowledge_edges (
  id BIGSERIAL PRIMARY KEY,
  source_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
  target_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
  relation_type TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  evidence_count INT NOT NULL DEFAULT 0,
  source_diversity INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_node_id, target_node_id, relation_type)
);
```

```sql
CREATE TABLE IF NOT EXISTS knowledge_edge_evidence (
  id BIGSERIAL PRIMARY KEY,
  edge_id BIGINT NOT NULL REFERENCES knowledge_edges(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  quote TEXT,
  evidence_strength TEXT NOT NULL DEFAULT 'weak',
  url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(edge_id, source_type, source_id)
);
```

Node types:

```text
theme
technology
component
material
process
infrastructure
supplier
company
symbol
source
```

Relation types:

```text
requires
supplies
bottleneck
beneficiary
substitute
adjacent_to
exposed_to
enables
risk_to
uses
manufactures
depends_on
```

Acceptance criteria:

- existing theme taxonomy becomes graph nodes
- existing theme entity seeds become graph nodes and edges
- `LIN/Linde` exists as company/symbol node but is not over-promoted
- candidate/approved/rejected states remain separate
- graph write-path audit passes

## 8. Phase 3: Evidence Collector

Goal: collect evidence bundles for each research question.

New modules:

```text
scripts/_shared/evidence-collector.mjs
scripts/collect-research-evidence.mjs
```

Table:

```sql
CREATE TABLE IF NOT EXISTS research_evidence_bundles (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES research_questions(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  text_excerpt TEXT,
  url TEXT,
  published_at TIMESTAMPTZ,
  relevance_score NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(question_id, source_type, source_id)
);
```

Sources:

- articles
- OpenAlex
- GitHub evidence
- SEC snippets
- RSS/source registry
- theme brief evidence
- tracked target hits
- source metadata
- later: patents and company pages

Acceptance criteria:

- question-level bundles are created
- source diversity is measurable
- duplicate evidence is removed
- excerpts are bounded
- evidence provenance is preserved

## 9. Phase 4: API LLM Relation Extractor

Goal: use API LLMs for relationship extraction without training a custom model first.

New modules:

```text
scripts/_shared/relation-extractor.mjs
scripts/extract-research-relations.mjs
```

Output schema:

```json
{
  "relations": [
    {
      "subject": "space launch",
      "subjectType": "theme",
      "relation": "requires",
      "object": "cryogenic propellant",
      "objectType": "component",
      "confidence": 0.81,
      "evidenceQuote": "short quote",
      "evidenceStrength": "direct",
      "caveat": "supplier link not proven"
    }
  ]
}
```

Validation rules:

- no quote means confidence max 0.45
- single-source relationships cannot become approved
- company/ticker must pass resolver before trusted promotion
- relation type must be whitelisted
- unsupported causal wording is rejected
- malformed JSON is discarded
- generic terms get a penalty

Acceptance criteria:

- schema validation passes
- quote-less high-confidence relations are blocked
- extracted relations write only to candidate graph
- LLM calls are budgeted and logged

## 10. Phase 5: Cross-Theme Connector Scorer

Goal: score shared bottlenecks, materials, components, and suppliers across themes.

New modules:

```text
scripts/_shared/cross-theme-adjacency.mjs
scripts/refresh-cross-theme-candidates.mjs
```

Table:

```sql
CREATE TABLE IF NOT EXISTS cross_theme_candidates (
  id BIGSERIAL PRIMARY KEY,
  themes TEXT[] NOT NULL,
  connector_node_id BIGINT REFERENCES knowledge_nodes(id),
  supplier_node_id BIGINT REFERENCES knowledge_nodes(id),
  score NUMERIC,
  lane TEXT NOT NULL DEFAULT 'exploration',
  status TEXT NOT NULL DEFAULT 'new',
  reason TEXT,
  evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Score model:

```text
score =
  evidence_quality * 0.25
+ source_diversity * 0.20
+ cross_theme_overlap * 0.15
+ recency_momentum * 0.15
+ novelty * 0.10
+ supplier_centrality * 0.10
+ user_interest_boost * 0.05
+ seed_similarity_capped * 0.05
- weak_relation_penalty
- generic_noise_penalty
```

Lanes:

```text
validated
watch
exploration
weird_but_rising
rejected
cooling
```

Diversity constraints:

- max same supplier family per batch
- max same component family per theme pair
- at least 30% exploration lane candidates
- report seed-similarity distribution per batch

Acceptance criteria:

- `space + quantum-computing` can produce cryogenic/cooling candidates
- hot theme pairs can produce non-seed candidates
- each candidate has reason, evidence, and caveat
- scorer output is deterministic for the same snapshot

## 11. Phase 6: Feedback System

Goal: let humans correct candidates with low-friction buttons and feed that back into ranking.

Table:

```sql
CREATE TABLE IF NOT EXISTS adjacency_feedback (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT REFERENCES cross_theme_candidates(id),
  decision TEXT NOT NULL,
  relation_override TEXT,
  priority TEXT,
  evidence_quality TEXT,
  reason TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Actions:

```text
Accept
Watch
Reject
Wrong relation
Weak evidence
Good supplier
Track privately
Open investigation
Add source query
```

Feedback behavior:

- accept increases trusted promotion eligibility
- watch increases monitoring frequency
- reject adds a decaying penalty
- weak evidence triggers source expansion
- wrong relation penalizes that relation type
- track privately writes only to `tracked_targets`
- new strong evidence can revive rejected candidates

Acceptance criteria:

- reviewed candidates do not repeatedly appear as unreviewed actionable items
- feedback changes ranking
- reject decay works
- private/candidate/trusted/canonical boundaries remain intact

## 12. Phase 7: Dashboard Surface

Goal: make cross-theme research understandable in 30 seconds.

Files:

```text
event-dashboard.html
scripts/event-dashboard-api.mjs
```

APIs:

```text
GET  /api/cross-theme-connectors
GET  /api/research-questions
POST /api/cross-theme-connectors/:id/review
POST /api/cross-theme-connectors/:id/track
POST /api/cross-theme-connectors/:id/investigate
POST /api/cross-theme-connectors/:id/source-query
```

UI surfaces:

```text
Cross-Theme Connectors
Hidden Bottlenecks
Weird But Rising
Research Questions
Evidence Drawer
```

Candidate card:

```text
Connector: Cryogenic Infrastructure
Themes: Space x Quantum x Fusion
Pathway: space -> cryogenic propellant -> liquid hydrogen -> industrial gas supplier -> Linde
Suppliers: Linde, Air Liquide, Bluefors, Chart Industries
Confidence: Medium
Evidence: 12 refs / 6 sources
Caveat: Linde relation currently indirect
Actions: Accept / Watch / Reject / Track / Investigate
```

Acceptance criteria:

- candidate, pathway, evidence, caveat, and action are visible in one card
- hover/click evidence drawer works
- review action persists after refresh
- Korean/English labels are available
- candidates are separated by lane

## 13. Phase 8: Source Expansion Agent

Goal: when evidence is weak but candidate is interesting, generate source/query proposals.

Modules:

```text
scripts/_shared/source-expansion-planner.mjs
scripts/codex-curate-proposals.mjs
scripts/proposal-executor.mjs
```

Query templates:

```text
"{supplier}" "{component}" "{theme}"
"{material}" "{process}" supplier
"{component}" bottleneck manufacturer
"{technology}" "{material}" SEC
"{component}" OpenAlex
```

Examples:

```text
"Linde" "cryogenic cooling" quantum
"helium-3" "dilution refrigerator" supplier
"solid rocket motor" bottleneck supplier
"vacuum systems" fusion semiconductor supplier
```

Rules:

- source proposals go through approval queue
- untrusted RSS needs human approval
- automation budget required
- kill switch respected
- no source auto-approval

Acceptance criteria:

- weak evidence candidates generate source queries
- approval queue is not bypassed
- source budget is respected
- source expansion outcome is logged

## 14. Phase 9: Autoresearch Harness

Goal: adapt the Karpathy autoresearch pattern to improve prompts, weights, and extraction settings safely.

Modules:

```text
scripts/_shared/autoresearch-harness.mjs
scripts/run-adjacency-autoresearch.mjs
docs/ADJACENCY_RESEARCH_PROGRAM.md
data/eval/adjacency-goldset.json
data/automation/autoresearch-rounds.jsonl
```

Harness responsibilities:

```text
snapshot
isolation
budget enforcement
execute
measure
decide
journal
```

Allowed experiment targets:

- relation extraction prompt
- candidate scoring weights
- source expansion query template
- novelty threshold
- exploration quota
- generic supplier penalty
- feedback decay curve

Forbidden experiment targets at first:

- live dashboard API core
- canonical taxonomy writer
- model training tables
- source approval logic
- production daemon scheduling

Metrics:

```text
connector_hit@10
supplier_hit@20
evidence_precision
novel_candidate_rate
human_watch_rate
human_reject_rate
hallucination_rate
canonical_pollution_count
seed_dependence_ratio
autonomous_question_rate
```

Accept gate:

```text
canonical_pollution_count = 0
hallucination_rate must not worsen
evidence_precision must not worsen
novel_candidate_rate must meet floor
seed_dependence_ratio must stay below cap
autonomous_question_rate must stay above target
```

Acceptance criteria:

- fixed budget execution
- baseline comparison
- append-only journal
- rejected variants do not affect live behavior
- accepted variants are reviewable and reproducible

## 15. Phase 10: Evaluation Dataset

Goal: evaluate without trapping the system inside initial seeds.

Files:

```text
data/eval/adjacency-goldset.json
data/eval/adjacency-negative-set.json
data/eval/adjacency-discovery-review.jsonl
```

Gold examples:

```json
[
  {
    "themes": ["space", "quantum-computing"],
    "expectedConnectors": ["cryogenic cooling", "helium-3", "dilution refrigerator"],
    "expectedSuppliers": ["Linde", "Air Liquide", "Bluefors", "Chart Industries"]
  },
  {
    "themes": ["fusion-energy", "quantum-computing"],
    "expectedConnectors": ["superconducting magnets", "cryogenics", "vacuum systems"],
    "expectedSuppliers": ["Oxford Instruments", "Bluefors", "Linde"]
  },
  {
    "themes": ["ai-ml", "cloud-infrastructure"],
    "expectedConnectors": ["data center power", "liquid cooling", "transformers"],
    "expectedSuppliers": ["Vertiv", "Eaton", "Schneider Electric"]
  }
]
```

Negative examples:

```json
[
  {
    "themes": ["space", "quantum-computing"],
    "wrongConnectors": ["social media advertising", "consumer streaming"]
  }
]
```

Discovery metrics:

```text
new_component_count
new_supplier_count
source_diversity
human_watch_rate
human_reject_rate
novelty_without_seed_similarity
```

Acceptance criteria:

- known examples are recovered
- non-seed examples are surfaced
- negative examples are penalized
- seed anchoring is measured and capped

## 16. Phase 11: Policy Advisor

Goal: prevent the user from manually tuning thresholds while also preventing unsafe fully automatic policy changes.

The system must ship with sensible default policy values, observe runtime outcomes, propose changes with evidence, and require explicit approval or bounded shadow testing before policy changes affect production.

New modules:

```text
scripts/_shared/research-os-policy.mjs
scripts/_shared/policy-advisor.mjs
scripts/propose-research-os-policy-changes.mjs
```

Policy table:

```sql
CREATE TABLE IF NOT EXISTS research_os_policy (
  policy_key TEXT PRIMARY KEY,
  policy_value JSONB NOT NULL,
  default_value JSONB NOT NULL,
  description TEXT,
  bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Policy proposal table:

```sql
CREATE TABLE IF NOT EXISTS research_os_policy_proposals (
  id BIGSERIAL PRIMARY KEY,
  policy_key TEXT NOT NULL,
  current_value JSONB NOT NULL,
  proposed_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  expected_effect JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_summary TEXT,
  shadow_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT 'policy-advisor',
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
```

Policy values that must not be hard-coded:

```text
seed_similarity_weight_max
exploration_quota_min
autonomous_question_rate_target
seed_dependence_ratio_max
min_source_diversity_for_trusted
min_direct_evidence_for_trusted
max_candidates_per_run
max_new_graph_nodes_per_day
llm_token_budget_daily
source_expansion_budget_daily
research_question_schedule_hours
relation_extraction_schedule_hours
candidate_refresh_schedule_hours
reject_penalty_decay_days
```

Policy Advisor loop:

```text
1. collect runtime metrics
2. detect threshold stress or drift
3. simulate or shadow-test candidate policy value
4. generate policy proposal
5. user approves, rejects, or tries for bounded window
6. system records audit entry
7. rollback if guardrail metric worsens
```

Example proposal:

```text
Current exploration quota is 30%.
Novel candidate rate is healthy, but human reject rate is 82%.
Proposal: lower exploration quota to 20% for 7 days.
Expected effect: reduce noise while preserving non-seed discovery.
Rollback: restore 30% if novel_candidate_rate falls below target or seed_dependence_ratio rises above cap.
```

Another example:

```text
Current seed similarity cap is 10%.
Known connector recall is weak, but seed dependence remains low.
Proposal: shadow-test 15% for 3 runs.
Expected effect: recover known industrial connectors.
Rollback: reject if seed_dependence_ratio exceeds cap or exploration diversity falls.
```

User role:

```text
Approve
Reject
Try for 7 days
Shadow only
Rollback now
```

The user should not have to manually choose raw numbers during normal operation. The system suggests policy changes with measured tradeoffs; the user approves the risk posture.

Acceptance criteria:

```text
all thresholds are config/policy-driven
no policy magic numbers are embedded in scorer/generator code
policy proposals include expected effect and rollback rule
policy changes are audit-logged
shadow tests can run without production impact
user can approve/reject without editing config files
```

## 17. Phase 12: Trusted Graph Promotion

Goal: promote good candidates to trusted graph without skipping review.

Promotion criteria:

```text
source_diversity >= 3
direct_evidence >= 2
human accept/watch threshold met
reject rate below threshold
no unresolved critical caveat
company/ticker resolver passed
```

State flow:

```text
candidate
-> watch
-> trusted
-> canonical proposal
-> canonical approved
```

Acceptance criteria:

- enough evidence required before trusted
- canonical proposal still needs approval
- promotion and demotion audit trail exists
- trusted graph is explainable

## 18. Phase 13: Production Automation

Daemon tasks:

```text
generate-research-questions      every 6h
collect-research-evidence        every 6h
extract-research-relations       every 12h, budgeted
refresh-cross-theme-candidates   every 3h
source-expansion-planner         daily
adjacency-autoresearch           nightly, isolated
policy-advisor                   daily
```

Guardrails:

```text
AUTOMATION_KILL_SWITCH
AUTOMATION_DRY_RUN
daily LLM token budget
source proposal budget
max candidates per run
max new graph nodes per day
max source expansion proposals per day
max seed-similar candidates per batch
min exploration candidates per batch
policy changes require approval or bounded shadow mode
```

Acceptance criteria:

- 24h daemon stability
- no budget overrun
- ops dashboard exposes status
- automation rate is measurable
- manual seed dependency is measurable
- policy drift is measurable

## 19. Phase 14: Final Product Experience

Main output should look like this:

```text
This Week's Hidden Bottlenecks

1. Cryogenic Infrastructure
   Themes: Space x Quantum x Fusion
   Suppliers: Linde, Air Liquide, Bluefors
   Confidence: Medium-high
   Why now: launch cadence + quantum hardware + fusion cryostat activity
   Action: Watch

2. Grid Transformers
   Themes: AI Data Centers x Electrification x Defense
   Suppliers: Eaton, Schneider, GE Vernova
   Confidence: High
   Action: Investigate

3. Solid Rocket Motors
   Themes: Defense x Space
   Suppliers: Northrop, L3Harris/Aerojet, Avio
   Confidence: Medium
   Action: Add sources
```

Each candidate must include:

```text
What changed
Why it matters
Pathway
Evidence
Counter-evidence
Unknowns
Watch next
Action
```

Acceptance criteria:

- user understands why a candidate matters within 30 seconds
- evidence and caveats are visible
- action is clear
- weird-but-rising candidates are visible but not over-trusted
- private tracking remains separate from canonical product truth

## 20. S-Tier Completion Criteria

The feature reaches S-tier when all are true:

```text
1. Daily research questions are generated without user seeds.
2. Hot theme, theme pair, explanation gap, novel phrase, source divergence, and user interest triggers work.
3. Theme -> component -> material/process/infrastructure -> supplier -> company -> ticker graph works.
4. Every candidate has evidence, caveat, and source provenance.
5. Cross-theme shared bottlenecks are discovered automatically.
6. Supplier/company candidates are linked with evidence.
7. Exploration lane prevents seed anchoring bias.
8. Human feedback changes ranking and source expansion.
9. Source expansion generates approval-gated proposals.
10. Autoresearch harness improves prompts/weights without live pollution.
11. canonical_pollution_count = 0.
12. autonomous_question_rate >= 0.80.
13. seed_dependence_ratio stays below configured cap.
14. Dashboard explains why a candidate matters within 30 seconds.
15. User does not manually tune policy numbers during normal operation.
16. Policy Advisor proposes threshold changes with shadow result and rollback rule.
```

## 21. Recommended Implementation Order

PR 1: Foundation

```text
research_questions schema
knowledge_nodes / knowledge_edges / knowledge_edge_evidence schema
research_os_policy schema
theme taxonomy import
theme entity seed import
pollution guard test
policy magic-number guard test
basic read API
```

PR 2: Autonomous Questions MVP

```text
hot_theme trigger
theme_pair trigger
explanation_gap trigger
novel_phrase trigger
autonomous_question_rate metric
question dedupe/cooldown
```

PR 3: Deterministic Cross-Theme MVP

```text
graph 1-2 hop expansion
intersection score
cross_theme_candidates table
space + quantum fixture test
non-seed hot pair fixture test
seed dependence report
```

PR 4: Dashboard Surface

```text
Cross-Theme Connectors card
Hidden Bottlenecks lane
Weird But Rising lane
Evidence drawer
Accept/Watch/Reject
Track privately
```

PR 5: LLM Extractor

```text
relation extractor
JSON schema validation
quote enforcement
candidate graph write
LLM budget logging
```

PR 6: Source Expansion

```text
source query planner
approval queue integration
weak evidence trigger
source budget checks
```

PR 7: Feedback And Promotion

```text
adjacency_feedback
ranking feedback integration
reject decay
trusted graph promotion criteria
canonical proposal path
```

PR 8: Policy Advisor

```text
policy advisor module
policy proposals table
shadow-test result envelope
approval/reject/try flow
ops diagnostics for current policy
```

PR 9: Autoresearch Harness

```text
harness module
gold/negative/discovery eval sets
prompt/weight experiment loop
journal
accept/reject gate
```

## 22. Implementation Continuity Rules

The MVP targets below are validation checkpoints, not stopping points.

The implementation must continue past the first working demo until the S-tier completion criteria in Section 20 are met. A successful MVP only proves that the current layer is safe enough to build on.

Progression rules:

```text
1. After PR 1 passes guardrails, continue to PR 2.
2. After PR 2 proves autonomous question generation, continue to PR 3.
3. After PR 3 produces deterministic candidates, continue to PR 4.
4. After PR 4 exposes review UI, continue to PR 5.
5. After PR 5 extracts LLM relations safely, continue to PR 6.
6. After PR 6 creates approval-gated source expansion, continue to PR 7.
7. After PR 7 closes the feedback loop, continue to PR 8.
8. After PR 8 adds policy advisory, continue to PR 9.
9. After PR 9 adds autoresearch, continue operational hardening until Section 20 is satisfied.
```

Allowed reasons to pause:

```text
canonical pollution risk detected
forbidden write path detected
LLM/source budget cannot be enforced
approval queue bypass detected
credentials or external API access missing
test suite cannot prove data boundary safety
user explicitly asks to stop or redirect
```

Not allowed as stopping reasons:

```text
first MVP demo works
space + quantum example works
dashboard card renders
one LLM extraction run succeeds
one source expansion proposal is generated
one autoresearch round is accepted
```

Each phase must leave a next-step artifact:

```text
passing tests
known gaps
next PR target
data-boundary result
ops metric to watch
rollback note
```

If a phase hits its checkpoint but the next phase is not started, the implementation should be treated as incomplete.

## 23. Continuous Test, Re-Test, And Improvement Loop

Every phase must run as an explicit improvement loop, not a one-time implementation pass.

Required loop:

```text
1. implement the smallest durable slice for the current phase
2. run unit and contract tests
3. run data-boundary and pollution tests
4. run at least one integration or API smoke test
5. compare metrics against the previous baseline
6. record failures, regressions, and ambiguous results
7. fix issues or narrow the phase scope without weakening S-tier criteria
8. re-run the same tests that failed
9. update the next target if evidence shows the bottleneck moved
10. continue to the next phase only after the current slice is stable
```

This loop is mandatory for every PR and every daemon-facing change.

Minimum test matrix by layer:

```text
schema layer:
  migration idempotency
  forbidden foreign keys/triggers
  insert/update/read contract

research question layer:
  hot_theme trigger
  theme_pair trigger
  explanation_gap trigger
  dedupe/cooldown
  autonomous_question_rate

graph layer:
  node normalization
  edge upsert
  evidence provenance
  candidate/trusted/canonical separation

scoring layer:
  deterministic snapshot replay
  seed_similarity cap
  exploration quota
  negative example penalty
  feedback decay

LLM extraction layer:
  JSON schema validation
  quote enforcement
  confidence cap for unsupported claims
  malformed output rejection
  budget logging

source expansion layer:
  approval queue path
  budget enforcement
  kill switch
  no auto-approval

dashboard/API layer:
  endpoint contract
  action persistence after refresh
  evidence drawer availability
  English/Korean labels
  stale/empty state clarity

autoresearch layer:
  budget timeout
  isolated variant execution
  append-only journal
  accept/reject decision reproducibility
  no live pollution
```

Continuous metric review:

```text
canonical_pollution_count
autonomous_question_rate
seed_dependence_ratio
novel_candidate_rate
evidence_precision
human_watch_rate
human_reject_rate
source_diversity
hallucination_rate
policy_change_success_rate
```

After each phase, produce a short phase report:

```text
implemented
tests_run
tests_failed
tests_re_run
metric_before
metric_after
remaining_bottleneck
next_target_adjustment
rollback_plan
```

Next-target adjustment rules:

```text
adjust the next target when a measured bottleneck moved
do not lower S-tier criteria to make progress look complete
do not skip a failed boundary test
do not skip retesting after a fix
do not mark a phase complete if the dashboard/API action cannot survive refresh
do not mark a phase complete if the result only works for the seed example
```

Allowed target refinements:

```text
split a large PR into smaller durable slices
move a high-risk LLM feature behind dry-run
add a new guardrail discovered by testing
raise evidence requirements when hallucination rises
increase exploration when seed dependence rises
slow automation when budget pressure rises
```

Disallowed target refinements:

```text
remove exploration requirements
remove seed-dependence measurement
remove canonical pollution checks
make source approval optional
hard-code policy numbers to pass tests
count manual seed expansion as autonomous discovery
```

Final completion requires repeated convergence:

```text
S-tier criteria satisfied in one run is not enough.
The system must satisfy them across repeated runs or snapshots, with no boundary regression.
```

Recommended final validation:

```text
3 consecutive successful scheduled runs
0 canonical pollution incidents
autonomous_question_rate above target
seed_dependence_ratio below cap
dashboard review actions persist after refresh
policy advisor proposals include rollback rules
autoresearch variants remain isolated
```

## 24. First Validation Checkpoint

The first working demo should be:

```text
system generates a research question for space + quantum
-> graph/scorer creates cryogenic-related connector candidates
-> candidate includes helium-3/liquid hydrogen/dilution refrigerator and supplier candidates
-> dashboard shows evidence/caveat
-> user can Watch/Reject/Track privately
-> no canonical table is mutated
```

The second demo must prove autonomy:

```text
system generates a non-seed research question from hot themes or explanation gap
-> surfaces a non-seed connector
-> marks it exploration or weird-but-rising
-> collects feedback without requiring user-provided seed
```

If the second demo fails, the feature is still just a manual seed-expansion tool and should not be considered complete.

Passing both demos still does not mean the feature is complete. It only authorizes moving from deterministic MVP to LLM extraction, source expansion, feedback integration, policy advisory, and autoresearch hardening.
