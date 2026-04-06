export interface IntelligenceTableColumn {
  name: string;
  type: string;
  nullable?: boolean;
  description: string;
}

export interface IntelligenceTableContract {
  name: string;
  description: string;
  primaryKey: string[];
  columns: IntelligenceTableColumn[];
}

export interface IntelligenceApiContract {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  requestShape?: string;
  responseShape: string;
}

export const INTELLIGENCE_SERVER_TABLES: IntelligenceTableContract[] = [
  {
    name: 'historical_datasets',
    description: 'Bitemporal dataset registry for imported historical backfill batches.',
    primaryKey: ['dataset_id'],
    columns: [
      { name: 'dataset_id', type: 'text', description: 'Stable imported dataset id.' },
      { name: 'provider', type: 'text', description: 'Source provider name.' },
      { name: 'source_version', type: 'text', nullable: true, description: 'Provider/version tag used during import.' },
      { name: 'imported_at', type: 'timestamptz', description: 'Import completion timestamp.' },
      { name: 'raw_record_count', type: 'integer', description: 'Raw bitemporal records imported.' },
      { name: 'frame_count', type: 'integer', description: 'Materialized replay frames generated.' },
      { name: 'warmup_frame_count', type: 'integer', description: 'Frames reserved for burn-in only.' },
      { name: 'bucket_hours', type: 'integer', description: 'Replay materialization bucket size.' },
      { name: 'first_valid_time', type: 'timestamptz', nullable: true, description: 'Earliest real-world valid time in the dataset.' },
      { name: 'last_valid_time', type: 'timestamptz', nullable: true, description: 'Latest real-world valid time in the dataset.' },
      { name: 'first_transaction_time', type: 'timestamptz', nullable: true, description: 'Earliest transaction/ingest time in the dataset.' },
      { name: 'last_transaction_time', type: 'timestamptz', nullable: true, description: 'Latest transaction/ingest time in the dataset.' },
      { name: 'metadata', type: 'jsonb', description: 'Importer metadata and PiT notes.' },
    ],
  },
  {
    name: 'historical_raw_items',
    description: 'Append-only bitemporal raw ledger used to prevent look-ahead bias.',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'text', description: 'Stable imported raw row id.' },
      { name: 'dataset_id', type: 'text', description: 'Parent historical dataset id.' },
      { name: 'provider', type: 'text', description: 'Provider name.' },
      { name: 'source_kind', type: 'text', description: 'rss | api | playwright | manual.' },
      { name: 'source_id', type: 'text', description: 'Source key within the provider.' },
      { name: 'item_kind', type: 'text', description: 'news | market.' },
      { name: 'valid_time_start', type: 'timestamptz', description: 'When the event/value was true in the world.' },
      { name: 'valid_time_end', type: 'timestamptz', nullable: true, description: 'Optional end of validity interval.' },
      { name: 'transaction_time', type: 'timestamptz', description: 'When WorldMonitor learned the item.' },
      { name: 'knowledge_boundary', type: 'timestamptz', description: 'Strict PiT cut-off used by replay.' },
      { name: 'headline', type: 'text', nullable: true, description: 'Headline or row label.' },
      { name: 'link', type: 'text', nullable: true, description: 'Canonical link if available.' },
      { name: 'symbol', type: 'text', nullable: true, description: 'Market symbol where applicable.' },
      { name: 'region', type: 'text', nullable: true, description: 'Region/country label.' },
      { name: 'price', type: 'double precision', nullable: true, description: 'Observed market price if applicable.' },
      { name: 'payload', type: 'jsonb', description: 'Original provider payload.' },
      { name: 'metadata', type: 'jsonb', description: 'Importer metadata and source annotations.' },
    ],
  },
  {
    name: 'historical_replay_frames',
    description: 'Materialized point-in-time replay frames derived from bitemporal raw items.',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'text', description: 'Stable replay frame id.' },
      { name: 'dataset_id', type: 'text', description: 'Parent historical dataset id.' },
      { name: 'bucket_hours', type: 'integer', description: 'Materialization bucket size.' },
      { name: 'bucket_start', type: 'timestamptz', description: 'Bucket start time.' },
      { name: 'bucket_end', type: 'timestamptz', description: 'Bucket end time / frame timestamp.' },
      { name: 'valid_time_start', type: 'timestamptz', description: 'Earliest real-world valid time present in the frame.' },
      { name: 'valid_time_end', type: 'timestamptz', nullable: true, description: 'Frame valid-time boundary.' },
      { name: 'transaction_time', type: 'timestamptz', description: 'Replay transaction time.' },
      { name: 'knowledge_boundary', type: 'timestamptz', description: 'PiT knowledge ceiling used by the frame.' },
      { name: 'warmup', type: 'boolean', description: 'True when reserved for burn-in only.' },
      { name: 'payload', type: 'jsonb', description: 'Serialized HistoricalReplayFrame.' },
    ],
  },
  {
    name: 'raw_items',
    description: 'Append-only raw ingest ledger for RSS/API/Playwright payloads.',
    primaryKey: ['id'],
    columns: [
      { name: 'id', type: 'uuid', description: 'Stable ingest id.' },
      { name: 'source_kind', type: 'text', description: 'rss | api | playwright | manual.' },
      { name: 'source_id', type: 'text', description: 'Registry id or feed name.' },
      { name: 'discovered_at', type: 'timestamptz', description: 'Point-in-time ingest timestamp.' },
      { name: 'published_at', type: 'timestamptz', nullable: true, description: 'Original item publication timestamp.' },
      { name: 'headline', type: 'text', nullable: true, description: 'Primary item title or label.' },
      { name: 'payload', type: 'jsonb', description: 'Full raw payload.' },
      { name: 'link', type: 'text', nullable: true, description: 'Canonical link where available.' },
      { name: 'content_hash', type: 'text', description: 'Dedup hash.' },
    ],
  },
  {
    name: 'normalized_events',
    description: 'Point-in-time event records extracted from raw items.',
    primaryKey: ['event_id'],
    columns: [
      { name: 'event_id', type: 'uuid', description: 'Stable event id.' },
      { name: 'discovered_at', type: 'timestamptz', description: 'When the event entered the system.' },
      { name: 'event_time', type: 'timestamptz', nullable: true, description: 'Best-known real-world event time.' },
      { name: 'event_type', type: 'text', description: 'conflict | sanction | outage | cyber | chokepoint | policy.' },
      { name: 'region', type: 'text', nullable: true, description: 'Normalized region label.' },
      { name: 'severity', type: 'numeric(5,2)', description: '0-100 normalized severity.' },
      { name: 'confidence', type: 'numeric(5,2)', description: '0-100 confidence.' },
      { name: 'entity_ids', type: 'jsonb', description: 'Canonical entity ids linked to the event.' },
      { name: 'evidence_item_ids', type: 'jsonb', description: 'raw_items ids used as evidence.' },
      { name: 'properties', type: 'jsonb', description: 'LPG-style freeform event properties.' },
    ],
  },
  {
    name: 'entity_nodes',
    description: 'Canonical ontology nodes with type and alias metadata.',
    primaryKey: ['entity_id'],
    columns: [
      { name: 'entity_id', type: 'uuid', description: 'Canonical entity id.' },
      { name: 'canonical_name', type: 'text', description: 'Primary normalized label.' },
      { name: 'entity_type', type: 'text', description: 'country | company | technology | commodity | waterway | event | ...' },
      { name: 'aliases', type: 'jsonb', description: 'Approved aliases.' },
      { name: 'external_refs', type: 'jsonb', description: 'Wikidata/OpenSanctions/STIX refs.' },
      { name: 'confidence', type: 'numeric(5,2)', description: 'Canonicalization confidence.' },
      { name: 'properties', type: 'jsonb', description: 'LPG-style property bag.' },
      { name: 'updated_at', type: 'timestamptz', description: 'Last material update.' },
    ],
  },
  {
    name: 'graph_edges',
    description: 'Temporal ontology edges, including inferred and rejected metadata.',
    primaryKey: ['edge_id'],
    columns: [
      { name: 'edge_id', type: 'uuid', description: 'Stable edge id.' },
      { name: 'source_entity_id', type: 'uuid', description: 'Origin canonical entity.' },
      { name: 'target_entity_id', type: 'uuid', description: 'Target canonical entity.' },
      { name: 'relation_type', type: 'text', description: 'sanctions | owned_by | affects | conflict | location | ...' },
      { name: 'weight', type: 'numeric(8,4)', description: 'Normalized relation weight.' },
      { name: 'confidence', type: 'numeric(5,2)', description: 'Edge confidence.' },
      { name: 'valid_from', type: 'timestamptz', nullable: true, description: 'Temporal validity start.' },
      { name: 'valid_until', type: 'timestamptz', nullable: true, description: 'Temporal validity end.' },
      { name: 'is_inferred', type: 'boolean', description: 'True for rule-engine inferred edges.' },
      { name: 'properties', type: 'jsonb', description: 'LPG-style edge property bag.' },
    ],
  },
  {
    name: 'source_scores',
    description: 'Online-learned source posterior and health state.',
    primaryKey: ['source_id'],
    columns: [
      { name: 'source_id', type: 'text', description: 'Normalized source id.' },
      { name: 'posterior_alpha', type: 'numeric(12,4)', description: 'Source posterior alpha.' },
      { name: 'posterior_beta', type: 'numeric(12,4)', description: 'Source posterior beta.' },
      { name: 'posterior_accuracy_score', type: 'numeric(5,2)', description: 'Derived posterior accuracy.' },
      { name: 'credibility_score', type: 'numeric(5,2)', description: 'Blended credibility score.' },
      { name: 'feed_health_score', type: 'numeric(5,2)', description: 'Source feed health.' },
      { name: 'propaganda_risk_score', type: 'numeric(5,2)', description: 'Bias/propaganda risk.' },
      { name: 'updated_at', type: 'timestamptz', description: 'Last posterior update.' },
      { name: 'properties', type: 'jsonb', description: 'Extra source metrics.' },
    ],
  },
  {
    name: 'mapping_stats',
    description: 'Online-learned event-theme to symbol mapping posterior.',
    primaryKey: ['mapping_id'],
    columns: [
      { name: 'mapping_id', type: 'text', description: 'theme::symbol::direction' },
      { name: 'theme_id', type: 'text', description: 'Normalized theme id.' },
      { name: 'symbol', type: 'text', description: 'Ticker or market symbol.' },
      { name: 'direction', type: 'text', description: 'long | short | hedge | watch.' },
      { name: 'alpha', type: 'numeric(12,4)', description: 'Win posterior alpha.' },
      { name: 'beta', type: 'numeric(12,4)', description: 'Loss posterior beta.' },
      { name: 'posterior_win_rate', type: 'numeric(5,2)', description: 'Posterior expected hit rate.' },
      { name: 'ema_return_pct', type: 'numeric(8,4)', description: 'EMA realized return.' },
      { name: 'ema_holding_days', type: 'numeric(8,4)', description: 'EMA holding duration.' },
      { name: 'observations', type: 'integer', description: 'Closed-sample count.' },
      { name: 'updated_at', type: 'timestamptz', description: 'Last learning update.' },
    ],
  },
  {
    name: 'idea_runs',
    description: 'Point-in-time generated investment ideas used for replay/backtesting.',
    primaryKey: ['idea_run_id'],
    columns: [
      { name: 'idea_run_id', type: 'uuid', description: 'Generated idea run id.' },
      { name: 'backtest_run_id', type: 'uuid', nullable: true, description: 'Parent backtest run id.' },
      { name: 'generated_at', type: 'timestamptz', description: 'Idea generation timestamp.' },
      { name: 'theme_id', type: 'text', description: 'Theme identifier.' },
      { name: 'region', type: 'text', description: 'Geographic region.' },
      { name: 'direction', type: 'text', description: 'long | short | hedge | watch.' },
      { name: 'conviction', type: 'numeric(5,2)', description: 'Idea conviction at generation.' },
      { name: 'false_positive_risk', type: 'numeric(5,2)', description: 'Idea false-positive estimate.' },
      { name: 'size_pct', type: 'numeric(8,4)', description: 'Recommended position size.' },
      { name: 'symbols', type: 'jsonb', description: 'Mapped symbols and entry prices.' },
      { name: 'properties', type: 'jsonb', description: 'Triggers, invalidation, evidence, analog refs.' },
    ],
  },
  {
    name: 'forward_returns',
    description: 'Outcome labels for each idea/symbol/horizon tuple.',
    primaryKey: ['forward_return_id'],
    columns: [
      { name: 'forward_return_id', type: 'uuid', description: 'Forward-return record id.' },
      { name: 'idea_run_id', type: 'uuid', description: 'Parent idea run.' },
      { name: 'symbol', type: 'text', description: 'Instrument symbol.' },
      { name: 'horizon_hours', type: 'integer', description: 'Forward horizon.' },
      { name: 'entry_timestamp', type: 'timestamptz', description: 'Entry timestamp.' },
      { name: 'exit_timestamp', type: 'timestamptz', nullable: true, description: 'Resolved exit timestamp.' },
      { name: 'entry_price', type: 'numeric(18,8)', nullable: true, description: 'Entry price.' },
      { name: 'exit_price', type: 'numeric(18,8)', nullable: true, description: 'Exit price.' },
      { name: 'raw_return_pct', type: 'numeric(8,4)', nullable: true, description: 'Unsigned raw return.' },
      { name: 'signed_return_pct', type: 'numeric(8,4)', nullable: true, description: 'Direction-adjusted return.' },
    ],
  },
  {
    name: 'backtest_runs',
    description: 'Metadata and summary for replay or walk-forward runs.',
    primaryKey: ['backtest_run_id'],
    columns: [
      { name: 'backtest_run_id', type: 'uuid', description: 'Run id.' },
      { name: 'label', type: 'text', description: 'User-visible run label.' },
      { name: 'mode', type: 'text', description: 'replay | walk-forward.' },
      { name: 'started_at', type: 'timestamptz', description: 'Run start.' },
      { name: 'completed_at', type: 'timestamptz', description: 'Run completion.' },
      { name: 'frame_count', type: 'integer', description: 'Replay frame count.' },
      { name: 'summary', type: 'jsonb', description: 'Summary metrics and workflow stats.' },
      { name: 'windows', type: 'jsonb', nullable: true, description: 'Walk-forward split metadata.' },
    ],
  },
];

export const INTELLIGENCE_SERVER_API_CONTRACT: IntelligenceApiContract[] = [
  {
    method: 'GET',
    path: '/api/intelligence/v1/schema',
    description: 'Return table and endpoint contracts for deployment tooling and admin UIs.',
    responseShape: '{ tables: IntelligenceTableContract[], endpoints: IntelligenceApiContract[] }',
  },
  {
    method: 'POST',
    path: '/api/intelligence/v1/import',
    description: 'Import a historical dump into bitemporal raw storage and materialized replay frames.',
    requestShape: '{ filePath: string, options?: HistoricalBackfillOptions }',
    responseShape: 'HistoricalBackfillResult',
  },
  {
    method: 'GET',
    path: '/api/intelligence/v1/datasets',
    description: 'List imported historical datasets and their PiT boundaries.',
    responseShape: 'HistoricalDatasetSummary[]',
  },
  {
    method: 'POST',
    path: '/api/intelligence/v1/replay',
    description: 'Run point-in-time historical replay over ordered frames.',
    requestShape: '{ label?: string, frames: HistoricalReplayFrame[], horizonsHours?: number[], retainLearningState?: boolean }',
    responseShape: 'HistoricalReplayRun',
  },
  {
    method: 'POST',
    path: '/api/intelligence/v1/walk-forward',
    description: 'Run train/validate/test walk-forward replay over ordered frames.',
    requestShape: '{ label?: string, frames: HistoricalReplayFrame[], horizonsHours?: number[], trainRatio?: number, validateRatio?: number, foldCount?: number, retainLearningState?: boolean }',
    responseShape: 'HistoricalReplayRun',
  },
  {
    method: 'GET',
    path: '/api/intelligence/v1/backtest-runs',
    description: 'List recent replay/backtest runs.',
    responseShape: 'HistoricalReplayRun[]',
  },
  {
    method: 'GET',
    path: '/api/intelligence/v1/backtest-runs/:id',
    description: 'Fetch a specific replay/backtest run payload.',
    responseShape: 'HistoricalReplayRun | null',
  },
];
