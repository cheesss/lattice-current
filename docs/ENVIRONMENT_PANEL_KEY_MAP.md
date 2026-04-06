# Environment / Secret Key to Panel Map

Use this when setting up a new environment or auditing why a panel is empty.
The source of truth for key definitions is:

- [src/services/runtime-config.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime-config.ts)
- [src/services/settings-constants.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\settings-constants.ts)

## AI and Summarization

### Ollama
- Keys:
  - `OLLAMA_API_URL`
  - `OLLAMA_MODEL`
- Affects:
  - AI summarization fallback chain
  - local summarization paths in analysis/brief panels

### Groq
- Key:
  - `GROQ_API_KEY`
- Affects:
  - fast summarization provider

### OpenAI
- Key:
  - `OPENAI_API_KEY`
- Affects:
  - Codex-compatible chat completion summarization provider

### OpenRouter
- Key:
  - `OPENROUTER_API_KEY`
- Affects:
  - secondary LLM fallback provider

## Economic / Energy

### FRED
- Key:
  - `FRED_API_KEY`
- Affects:
  - economic indicators
  - supply-chain shipping analytics that depend on FRED series
  - replay datasets such as `fred-core-cpi`

### EIA
- Key:
  - `EIA_API_KEY`
- Affects:
  - oil and energy analytics cards

### WTO
- Key:
  - `WTO_API_KEY`
- Affects:
  - trade policy and barrier panels

## Security / Threat / Conflict

### ACLED
- Keys:
  - `ACLED_ACCESS_TOKEN`
  - optional recovery:
    - `ACLED_EMAIL`
    - `ACLED_PASSWORD`
- Affects:
  - conflict and protest overlays
  - ACLED-backed backtest datasets such as `acled-middle-east`
  - scheduler conflict ingestion

### Cloudflare Radar
- Key:
  - `CLOUDFLARE_API_TOKEN`
- Affects:
  - internet outages
  - outage-derived geopolitical risk overlays

### abuse.ch / ThreatFox
- Key:
  - `URLHAUS_AUTH_KEY`
- Affects:
  - IOC ingestion in cyber threat flows

### AlienVault OTX
- Key:
  - `OTX_API_KEY`
- Affects:
  - optional IOC enrichment

### AbuseIPDB
- Key:
  - `ABUSEIPDB_API_KEY`
- Affects:
  - IP reputation enrichment in cyber panels

## Tracking / Sensing

### OpenSky
- Keys:
  - `OPENSKY_CLIENT_ID`
  - `OPENSKY_CLIENT_SECRET`
  - optionally `VITE_OPENSKY_RELAY_URL`
- Affects:
  - military flight data
  - aviation-derived risk indicators

### AISStream
- Keys:
  - `AISSTREAM_API_KEY`
  - `WS_RELAY_URL`
- Affects:
  - vessel tracking
  - maritime chokepoint activity

### Wingbits
- Key:
  - `WINGBITS_API_KEY`
- Affects:
  - flight/operator enrichment for aviation panels

### NASA FIRMS
- Key:
  - `NASA_FIRMS_API_KEY`
- Affects:
  - wildfire / thermal anomaly overlays

### UCDP
- Key:
  - `UC_DP_KEY`
- Affects:
  - conflict history enrichment where UCDP is enabled

## Markets / Cross-Asset

### Finnhub
- Key:
  - `FINNHUB_API_KEY`
- Affects:
  - market quote panels
  - stock tickers
  - market-derived replay inputs where used

### OpenBB
- Keys:
  - `OPENBB_API_URL`
  - optional `OPENBB_API_KEY`
- Affects:
  - cross-asset tape
  - impact/exposure analytics

## Operator Notes

- Missing keys usually degrade a panel gracefully rather than crashing it.
- Some panels have partial public fallbacks. Examples:
  - supply-chain chokepoints/minerals have public paths
  - shipping analytics still need FRED
- Empty data can also come from rate limits or provider cooldowns, not just missing keys.
- For ACLED specifically, low coverage is different from auth failure:
  - auth issue -> token/credential failure
  - coverage issue -> auth succeeded but the resulting event corpus is still thin
