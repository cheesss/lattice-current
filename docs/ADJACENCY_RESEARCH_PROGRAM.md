# Adjacency Research Program

This program constrains Research OS autoresearch rounds.

Allowed targets:

- relation extraction prompt or deterministic cue policy
- candidate scoring weights in `config/research-os.defaults.json` or local shadow policy
- source expansion query templates
- novelty and exploration policy values through policy proposals only

Forbidden targets:

- canonical taxonomy writers
- model training tables
- labeled outcomes
- source approval bypass
- live dashboard/server core outside reviewable API contracts

Acceptance gates:

- `canonical_pollution_count` must stay `0`
- `seed_dependence_ratio` must stay under policy cap
- `autonomous_question_rate` must stay above target
- evidence precision must not regress
- negative connector hits must stay `0`

Seed examples are format calibration only. Autoresearch must report both gold recall and non-seed discovery metrics.
