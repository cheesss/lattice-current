create extension if not exists pgcrypto;

create table if not exists historical_datasets (
  dataset_id text primary key,
  provider text not null,
  source_version text,
  imported_at timestamptz not null,
  raw_record_count integer not null default 0,
  frame_count integer not null default 0,
  warmup_frame_count integer not null default 0,
  bucket_hours integer not null default 6,
  first_valid_time timestamptz,
  last_valid_time timestamptz,
  first_transaction_time timestamptz,
  last_transaction_time timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists historical_raw_items (
  id text primary key,
  dataset_id text not null references historical_datasets(dataset_id) on delete cascade,
  provider text not null,
  source_kind text not null,
  source_id text not null,
  item_kind text not null,
  valid_time_start timestamptz not null,
  valid_time_end timestamptz,
  transaction_time timestamptz not null,
  knowledge_boundary timestamptz not null,
  headline text,
  link text,
  symbol text,
  region text,
  price double precision,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists historical_raw_items_dataset_tx_idx on historical_raw_items (dataset_id, transaction_time asc);
create index if not exists historical_raw_items_valid_idx on historical_raw_items (dataset_id, valid_time_start asc);

create table if not exists historical_replay_frames (
  id text primary key,
  dataset_id text not null references historical_datasets(dataset_id) on delete cascade,
  bucket_hours integer not null,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  valid_time_start timestamptz not null,
  valid_time_end timestamptz,
  transaction_time timestamptz not null,
  knowledge_boundary timestamptz not null,
  warmup boolean not null default false,
  news_count integer not null default 0,
  cluster_count integer not null default 0,
  market_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists historical_replay_frames_dataset_tx_idx on historical_replay_frames (dataset_id, transaction_time asc);

create table if not exists raw_items (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_id text not null,
  discovered_at timestamptz not null,
  published_at timestamptz,
  headline text,
  payload jsonb not null,
  link text,
  content_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists raw_items_source_idx on raw_items (source_id, discovered_at desc);
create index if not exists raw_items_hash_idx on raw_items (content_hash);

create table if not exists normalized_events (
  event_id uuid primary key default gen_random_uuid(),
  discovered_at timestamptz not null,
  event_time timestamptz,
  event_type text not null,
  region text,
  severity numeric(5,2) not null,
  confidence numeric(5,2) not null,
  entity_ids jsonb not null default '[]'::jsonb,
  evidence_item_ids jsonb not null default '[]'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists normalized_events_type_idx on normalized_events (event_type, discovered_at desc);

create table if not exists entity_nodes (
  entity_id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  entity_type text not null,
  aliases jsonb not null default '[]'::jsonb,
  external_refs jsonb not null default '[]'::jsonb,
  confidence numeric(5,2) not null default 0,
  properties jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists entity_nodes_name_type_uidx on entity_nodes (canonical_name, entity_type);

create table if not exists graph_edges (
  edge_id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references entity_nodes(entity_id) on delete cascade,
  target_entity_id uuid not null references entity_nodes(entity_id) on delete cascade,
  relation_type text not null,
  weight numeric(8,4) not null default 0,
  confidence numeric(5,2) not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  is_inferred boolean not null default false,
  properties jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists graph_edges_lookup_idx on graph_edges (relation_type, source_entity_id, target_entity_id);

create table if not exists source_scores (
  source_id text primary key,
  posterior_alpha numeric(12,4) not null default 1,
  posterior_beta numeric(12,4) not null default 1,
  posterior_accuracy_score numeric(5,2) not null default 50,
  credibility_score numeric(5,2) not null default 50,
  feed_health_score numeric(5,2) not null default 50,
  propaganda_risk_score numeric(5,2) not null default 0,
  properties jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists mapping_stats (
  mapping_id text primary key,
  theme_id text not null,
  symbol text not null,
  direction text not null,
  alpha numeric(12,4) not null default 1,
  beta numeric(12,4) not null default 1,
  posterior_win_rate numeric(5,2) not null default 50,
  ema_return_pct numeric(8,4) not null default 0,
  ema_holding_days numeric(8,4) not null default 0,
  observations integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists mapping_stats_theme_idx on mapping_stats (theme_id, symbol, direction);

create table if not exists backtest_runs (
  backtest_run_id uuid primary key default gen_random_uuid(),
  label text not null,
  mode text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  temporal_mode text not null default 'bitemporal',
  frame_count integer not null,
  warmup_frame_count integer not null default 0,
  evaluation_frame_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  windows jsonb,
  created_at timestamptz not null default now()
);

create table if not exists idea_runs (
  idea_run_id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid references backtest_runs(backtest_run_id) on delete set null,
  generated_at timestamptz not null,
  theme_id text not null,
  region text not null,
  direction text not null,
  conviction numeric(5,2) not null,
  false_positive_risk numeric(5,2) not null,
  size_pct numeric(8,4) not null,
  symbols jsonb not null default '[]'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idea_runs_theme_idx on idea_runs (theme_id, generated_at desc);

create table if not exists forward_returns (
  forward_return_id uuid primary key default gen_random_uuid(),
  idea_run_id uuid not null references idea_runs(idea_run_id) on delete cascade,
  symbol text not null,
  horizon_hours integer not null,
  entry_timestamp timestamptz not null,
  exit_timestamp timestamptz,
  entry_price numeric(18,8),
  exit_price numeric(18,8),
  raw_return_pct numeric(8,4),
  signed_return_pct numeric(8,4),
  created_at timestamptz not null default now()
);
create index if not exists forward_returns_lookup_idx on forward_returns (symbol, horizon_hours, entry_timestamp desc);
