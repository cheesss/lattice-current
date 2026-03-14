# Historical Data Sources

Use these sources for point-in-time backfill. Do not mix revised data with unrevised data unless the run explicitly allows look-ahead.

## Conflict / geopolitical event history

| Source | Use | Historical depth | Point-in-time quality | Notes |
|---|---|---:|---|---|
| GDELT DOC 2.0 / event feeds | Global news/event backfill, entity/event extraction | Near real-time + expanding history | Medium | Official: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ and https://www.gdeltproject.org/data.html |
| ACLED API / export | Structured conflict, protest, violence events | Multi-year | High | Official: https://acleddata.com/knowledge-base/acled-api-documentation/ |
| UCDP API (GED) | Academic-quality conflict event history | Multi-year | High | Official: https://ucdpapi.pcr.uu.se/ |
| NASA FIRMS archive | Fire/thermal anomaly history | 2012-present for VIIRS archive | High | Official: https://firms.modaps.eosdis.nasa.gov/ and archive access via NASA firms download tools/docs. |

## Macro / economic history

| Source | Use | Historical depth | Point-in-time quality | Notes |
|---|---|---:|---|---|
| FRED API | Macro series history | Multi-decade | Medium | Official: https://fred.stlouisfed.org/docs/api/fred/ |
| ALFRED | Vintage macro data as known on past dates | Multi-decade | Very High | Official: https://alfred.stlouisfed.org/ and https://alfred.stlouisfed.org/help#api |
| World Bank Indicators API | Long-run global development data | 50+ years on many series | Medium | Official: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation |
| BIS SDMX / Data Portal API | Rates, banking, cross-border stats | Multi-year to multi-decade | High | Official: https://data.bis.org/ and BIS SDMX/Data API docs. |
| WTO Timeseries API | Trade and tariff history | Multi-year | Medium | Official: https://apiportal.wto.org/ |

## Market / asset price history

| Source | Use | Historical depth | Point-in-time quality | Notes |
|---|---|---:|---|---|
| Polygon aggregates | OHLCV, ETF/equity/futures backtests | Depends on plan | High | Official: https://polygon.io/docs |
| Alpha Vantage time series | Daily/intraday equity, commodity, FX history | 20+ years for many daily series | Medium | Official: https://www.alphavantage.co/documentation/ |
| Finnhub candles | Historical candles and ETF/fundamental coverage | Depends on plan | Medium/High | Official: https://finnhub.io/docs/api |
| CoinGecko market_chart / history | Crypto price / cap / volume history | 10+ years for major coins | Medium/High | Official: https://docs.coingecko.com/ |

## Cyber / sanctions history

| Source | Use | Historical depth | Point-in-time quality | Notes |
|---|---|---:|---|---|
| URLhaus / abuse.ch exports | Malware URL history, IOC backfill | Recent + export snapshots | Medium | Official: https://urlhaus.abuse.ch/api/ |
| AlienVault OTX pulses / STIX export | Cyber pulse, IOC and threat exchange history | Multi-year | Medium | Official: https://otx.alienvault.com/api and https://otx.alienvault.com/ |
| OpenSanctions exports | Sanctions / PEP / entity graph backfill | Snapshot-based | High | Official: https://www.opensanctions.org/docs/api/ |

## Recommended ingestion order

1. `raw_items`
   - GDELT / ACLED / UCDP / FRED / price API raw responses
2. `normalized_events`
   - Deduped event extraction from raw payloads
3. `entity_nodes` + `graph_edges`
   - Canonical entities, temporal relations, inferred edges
4. `idea_runs`
   - Generated ideas at each historical checkpoint
5. `forward_returns`
   - 1h / 4h / 1d / 3d / 7d outcomes
6. `mapping_stats` and `source_scores`
   - Learned priors updated from outcomes

## Point-in-time warnings

- Use `ALFRED` instead of revised `FRED` when macro revision bias matters.
- Use archived export snapshots or versioned datasets for conflict/cyber sources whenever available.
- Separate training, validation, and test windows chronologically.
- Never let forward returns or later ontology merges leak back into earlier checkpoints.
