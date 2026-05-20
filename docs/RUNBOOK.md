# Lattice Current Runbook

Updated: 2026-04-30

This runbook lists every long-running service required for Lattice Current to operate, plus the commands to start, stop, check, and recover them.

If anything in this document falls out of sync with `package.json` scripts or the daemon code, update the document — `scripts/check-release-readiness.mjs` reads it indirectly and operators rely on it.

## Required services

| # | Service | Port | Start | Health |
| --- | --- | --- | --- | --- |
| 1 | Vite dev server (frontend shell) | 3000 | `npm run dev:vite` | `curl http://127.0.0.1:3000/event-dashboard.html -o /dev/null -w "%{http_code}\n"` |
| 2 | Event Dashboard API | 46200 | (started by master-daemon) or `node scripts/event-dashboard-api.mjs` | `curl http://127.0.0.1:46200/api/health` |
| 3 | Master daemon (40 scheduled tasks) | n/a | `npm run daemon` | `data/daemon-state.json` mtime within last 10 min |
| 4 | Data accumulator (Yahoo warm / GDELT / FRED) | n/a | `npm run daemon:accumulator` | `data/data-accumulator-state.json` mtime within last 30 min |
| 5 | Meta-model inference server (PyTorch FastAPI) | 8100 | `python scripts/meta-model-server.py` | `curl http://127.0.0.1:8100/health` |

All five must be up for the dashboard to render with live data. Three of them (1, 3, 4) are typically started in three separate terminals.

## Start order

1. Set environment: `export $(grep -v '^#' .env.local | xargs)` (bash) or use `dotenv` in Windows.
2. Start meta-model server (5) first — it has the slowest cold start (~5s for model load).
3. Start master daemon (3) — it boots the dashboard API (2) as a child.
4. Start data accumulator (4).
5. Start vite dev server (1) last — lets API/daemon settle before the UI hits them.

A single command `npm run dev:full` (`scripts/dev-full.mjs`) wraps all of the above for development.

## Health & freshness checks

```bash
# All in one
curl -s http://127.0.0.1:46200/api/ops/status | jq .

# Individual
curl http://127.0.0.1:46200/api/health
curl http://127.0.0.1:8100/health
test $(($(date +%s) - $(stat -c %Y data/daemon-state.json))) -lt 600 && echo "daemon fresh"
```

`/api/ops/status` (added in S-level Phase 7) is the canonical "is the system healthy" endpoint. See `scripts/event-dashboard-api.mjs`.

## Common failures

| Symptom | Likely cause | First action |
| --- | --- | --- |
| Vite reachable on `192.168.x.x:3000` but not `127.0.0.1:3000` | `server.host` was bound to `::1` only | `vite.config.ts` `server.host: '0.0.0.0'` (already set as of 2026-04-30) |
| `/api/event-decisions` returns 5xx | Master daemon down or DB password rotated | Check `data/daemon-state.json`, then `pg_isready -h 192.168.0.2 -p 5433` |
| `/api/ops/status` reports `featureStaleEventCount > 100` | `event_features` upsert task missed too many cycles | Run `node scripts/incremental-event-engine-fast.mjs --repair-stale` |
| Meta-model `/predict/batch` returns 503 | Sidecar JSON missing or model `.pt` not loaded | Re-run `python scripts/meta-model-server.py` and watch stderr for load path |
| Daemon CPU pegged at 100% | Runaway child task — usually a Python subprocess | `taskkill /F /T /PID <pid>` (Windows) or `pkill -P <pid>` (Unix) |

## Release readiness

Before merging to main:

```bash
npm run check:release
```

This runs:

- `tsc --noEmit` (typecheck)
- `git status --short` purity check (no runtime artifacts in changes)
- API smoke test (`/api/health`, `/api/ops/status`)
- Daemon last-tick freshness
- DuckDB no-corrupt-files check

Output is human-readable + non-zero exit on failure.

## Stopping services

```bash
# Vite/daemon/accumulator: Ctrl+C in their terminal
# Meta-model server: Ctrl+C
# If a process is wedged on Windows:
tasklist | grep -E "node|python"
taskkill /F /PID <pid>
```

## Backup & restore

PostgreSQL on NAS (`192.168.0.2:5433`) is the source of truth. Backups are written to `data/backups/postgres-backup-*.sql.gz` by `scripts/backup-nas.mjs` (untracked, but kept on disk).

To restore:

```bash
gunzip -c data/backups/postgres-backup-<ts>.sql.gz | psql -h 192.168.0.2 -p 5433 -U lattice -d lattice
```

Models (`data/meta-v*.pt`, `data/meta-model-v1.onnx`) are tracked in git. Calibration sidecars (`data/meta-*.calibration.json`) are NOT tracked — regenerate via `python scripts/calibrate-meta-model.py`.

## Support contact

Single operator (solo dev). For issues encountered during external review, leave a note in `docs/PROJECT_HANDOFF_<date>.md` describing reproduction and current state.
