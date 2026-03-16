---
title: 投資・リプレイ
summary: イベントから資産へのマッピング、アイデア支援、リプレイ、ウォークフォワード評価。
status: beta
variants:
  - finance
  - tech
updated: 2026-03-16
owner: core
---

# 投資・リプレイ

## 何をするか

ライブイベントを資産に接続し、意思決定支援オブジェクトを生成し、リプレイとバックテストで検証します。

## なぜ必要か

ナラティブ中心の監視を、検証可能でレビュー可能な意思決定ワークフローへ変換するためです。

## 入力

- イベント、テーマ、伝播出力
- 市場時系列
- ソースおよびマッピング prior
- historical replay frame

## 出力

- 投資アイデアカード
- サイズ調整と false-positive ガードレール
- replay / walk-forward 実行サマリー
- Backtest Lab の可視化と意思決定比較
- coverage-aware universe の要約、review queue、gap 追跡
- 承認された動的候補が次の refresh とその後のバックテストに参加
- manual / guarded-auto / full-auto の universe policy モード
- scheduler が coverage gap に対して Codex candidate expansion を自動実行可能
- source registry 候補も guarded score + diversity policy 下で自動承認 / 自動有効化される
- candidate auto-approval は composite score と sector / asset-kind cap を使う
- 弱い theme motif と低信号 autonomous keyword を scheduler が自動で retire / reject できる
- 弱い idea card を operator view の前に自動 suppress できる
- ソース間の矛盾や rumor-heavy な表現を減点する cross-corroboration scoring
- `deploy`, `shadow`, `watch`, `abstain` に分かれる calibrated autonomy action
- 古い prior が現在の推薦を支配しないようにする time-decay と recent-evidence floor
- spread, slippage, liquidity, session state を含む reality-aware execution check
- 最近の shadow 成績が弱い時に保守モードへ戻す rollback signal
- raw signed return だけでなく cost-adjusted replay summary

## 主な UI 面

- Investment Workflow
- Auto Investment Ideas
- Backtest Lab
- Transmission Sankey / Network
- Coverage-aware universe review queue

## 関連アルゴリズム

- event-to-market transmission
- regime weighting
- Kalman スタイル adaptive weighting
- Hawkes intensity, transfer entropy, bandits
- historical replay と warm-up handling
- coverage-aware candidate retrieval
- core と approved expansion 資産を合わせて評価する deterministic ranking
- Codex-assisted candidate expansion review queue
- guarded auto-approval と probation / auto-demotion
- source / role / supporting signal / crowding penalty を合わせた composite auto-approval scoring
- scheduler-driven candidate expansion と accepted universe change 後の replay refresh
- novelty overlap limit と promotion score を使う Codex theme auto-promotion
- score / health / diversity cap を使う discovered feed / API source automation sweep
- autonomous keyword lifecycle review と theme queue hygiene
- pre-render idea-card triage と suppression
- clustered source 間の contradiction / rumor penalty
- confidence calibration, no-trade gate, shadow-only fallback
- session state / spread / slippage / liquidity に基づく execution-reality penalty
- deterministic ranking 内の recency weighting と stale-prior decay
- operator workflow に持ち込まれる shadow-book rollback state

## 制限

公開サイトはシステム動作を説明しますが、非公開の運用データや機微な市場設定は公開しません。

このエンジンは以前より強い自動化と制約付き自律性を持ちますが、まだ無制限の live auto-trader ではありません。現在の性格は次に近いです。

- まず意思決定支援と paper-trade 研究面
- 次に現実コストを織り込んだ replay engine
- 最後に policy gate と人の確認を通る execution candidate generator

## バリアント適用範囲

主な対象は `finance` で、`tech` にも一部の拡張共有があります。
