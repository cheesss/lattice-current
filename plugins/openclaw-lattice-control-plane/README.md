# OpenClaw Lattice Control Plane

Phase 1-2 native OpenClaw plugin for operator read tools plus guarded review actions.
Current local runtime default: `codex-cli/gpt-5.4`.

## Scope

This plugin wraps the local Lattice API and presents concise operator-facing summaries.
It exposes guarded approval and discovery-triage review actions, but still excludes generic shell access and direct SQL access.

## Tools

- `lattice.get_health`
- `lattice.get_kpi_summary`
- `lattice.get_theme_brief`
- `lattice.get_approval_queue`
- `lattice.get_discovery_triage`
- `lattice.get_data_freshness_audit`
- `lattice.get_source_repair_status`
- `lattice.get_live_status`
- `lattice.get_runtime_observability` (optional sidecar)
- `lattice.get_automation_ops_snapshot` (optional sidecar)
- `lattice.simulate_approval`
- `lattice.review_approval`
- `lattice.review_discovery_topic`

## Surface

This plugin now exposes a lightweight OpenClaw-owned operator surface at:

```text
http://127.0.0.1:18789/plugins/lattice
```

It renders:

- health
- KPI strip
- live status
- approval queue summary
- freshness audit
- discovery triage summary
- latest brief excerpt
- recent OpenClaw events and agent runs

Raw JSON snapshot:

```text
http://127.0.0.1:18789/plugins/lattice/api/snapshot
```

Source repair status JSON:

```text
http://127.0.0.1:18789/plugins/lattice/api/source-repair-status
```

Context-safe web command:

```text
/lattice-source-status
```

This bypasses the LLM and returns the Codex source-repair closed-loop evidence directly, so it does not consume chat context or trigger context-length warnings.

## Local install

```powershell
openclaw plugins install -l .\plugins\openclaw-lattice-control-plane
openclaw gateway restart
```

Then configure the plugin under:

```toml
[plugins.entries.openclaw-lattice-control-plane]
enabled = true

[plugins.entries.openclaw-lattice-control-plane.config]
latticeApiBaseUrl = "http://127.0.0.1:46200"
latticeUiBaseUrl = "http://127.0.0.1:4173"
defaultTheme = "materials-science"
timeoutMs = 10000
sidecarBaseUrl = "http://127.0.0.1:6077"
sidecarToken = ""
```

Use [openclaw-lattice-control-plane.sample.toml](/C:/Users/chohj/Documents/Playground/lattice-current-fix/plugins/openclaw-lattice-control-plane/openclaw-lattice-control-plane.sample.toml) as the starting point.

## Local validation

```powershell
cd .\plugins\openclaw-lattice-control-plane
npm install
npm run smoke
```

Use `npm run smoke:all` only when the sidecar is actually running and the optional token is available.

Validated in this repository:

- `npx tsc -p .\tsconfig.json`
- `npm run smoke`
- `GET /plugins/lattice`
- `GET /plugins/lattice/api/snapshot`
- `GET /plugins/lattice/api/source-repair-status`
- `POST /tools/invoke` for `lattice.get_health`
- `POST /tools/invoke` for `lattice.get_source_repair_status`
- `POST /tools/invoke` for `lattice.simulate_approval`
- `POST /tools/invoke` for `lattice.review_approval`
- `POST /tools/invoke` for `lattice.review_discovery_topic`
- `openclaw agent --agent main --message "Reply with the single word ok." --json`
- `openclaw agent --agent main --message "Use the lattice.get_health tool and report only the status field." --json`
- OpenClaw Control UI `/lattice-source-status`

## Assumptions

- The local Lattice API is reachable on `http://127.0.0.1:46200`.
- The dashboard UI is reachable on `http://127.0.0.1:4173`.
- Optional sidecar endpoints can use an explicit `sidecarToken` when enabled.
- The OpenClaw host resolves TypeScript plugin entry files directly from `openclaw.extensions`.
- The local OpenClaw Gateway is installed on this workstation and the plugin is linked in developer mode.
- The local OpenClaw agent default model is configured to `codex-cli/gpt-5.4`.
