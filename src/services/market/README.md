# Market Client Services

This domain normalizes quote and market snapshots for the client.

## Responsibilities

- equity, crypto, commodity, and ETF data shaping
- market context for replay and current decisions
- quote-family fallback behavior

## Common risks

- stale quote reuse after provider cooldowns
- symbol normalization mismatch between providers and panels
