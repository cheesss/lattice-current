---
title: 自動化・テーマ発見
summary: dataset registry, scheduler worker, replay cadence, theme discovery queue, Codex theme proposal.
status: beta
variants:
  - full
  - finance
updated: 2026-03-16
owner: core
---

# 自動化・テーマ発見

このページはバックテスト運用の自動化をまとめたものです。

## 含まれるもの

- `config/intelligence-datasets.json` ベースの dataset registry
- scheduler worker
- `fetch -> import -> replay`
- nightly walk-forward
- lock / retry / retention
- theme discovery queue
- guarded Codex theme proposer

## 原則

- Codex は直接の執行エンジンではありません。
- Codex は反復する未分類シグナルから新しいバックテスト・テーマを提案します。
- scheduler policy が閾値を満たした場合のみ昇格します。
- 昇格したテーマは次の replay cycle から反映されます。

## コマンド

```bash
npm run intelligence:scheduler:once
npm run intelligence:scheduler
node --import tsx scripts/intelligence-scheduler.mjs status
```

## 制約付き自律性

この自動化ループは、テーマや候補を増やすだけでは終わりません。

投資スナップショットには次の制約も入ります。

- ソース間の矛盾 penalty
- rumor / hedge language penalty
- 古い prior の減衰
- recent-evidence floor
- spread / slippage / liquidity / session-state penalty
- calibrated confidence
- `deploy`, `shadow`, `watch`, `abstain` action gate
- 最近の shadow performance が悪化した時の rollback

つまり現在の構造は、無制限の auto-trader よりも制約付き autonomous research stack に近いです。
