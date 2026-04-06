# News Server Domain

This domain handles news ingestion, digest construction, deduplication, and summarization support.

## Main responsibilities

- feed digest assembly
- article summarization cache path
- source/feed normalization and dedup

## Important files

- `v1/list-feed-digest.ts`
- `v1/summarize-article.ts`
- `v1/get-summarize-article-cache.ts`
- `v1/dedup.mjs`
- `v1/_feeds.ts`
- `v1/_classifier.ts`

## Design note

The news server domain should be transport and payload oriented. Cross-panel news reasoning should stay in `src/services/news/` or intelligence services.
