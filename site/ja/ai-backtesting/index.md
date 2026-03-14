---
title: AI・バックテスト
summary: AI 層、投資ロジック、リプレイエンジンがどのように連携するかを説明します。
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# AI・バックテスト

このセクションでは、AI、投資ロジック、リプレイをどう統合しているかを説明する文書をまとめています。

## 主要アーティファクト

- [AI / バックテスト統合分析](https://github.com/cheesss/lattice-current/blob/main/docs/ai_backtest_analysis.md)
- [改善計画: 60 の具体項目](https://github.com/cheesss/lattice-current/blob/main/docs/improvement_plan_60_points.md)
- [UX / 可視化改善案](https://github.com/cheesss/lattice-current/blob/main/docs/ux_visualization_improvements.md)
- [投資活用プレイブック](https://github.com/cheesss/lattice-current/blob/main/docs/investment-usage-playbook.md)

## 統合フロー

1. ライブフィードと構造化サービスが現在のスナップショットを作る
2. AI とグラフ層が証拠に基づくコンテキストを作る
3. 投資ロジックがテーマを資産にマッピングしてアイデア候補を作る
4. リプレイとウォークフォワード・バックテストが時間を通じて評価する
5. 学習された prior が再びライブ意思決定支援に戻る

## 現在の制限

- 一部の確率レイヤーは実用上の近似に留まる
- リプレイ品質は point-in-time データの完全性に依存する
- learned sizing は adaptive prior と hard guardrail を混ぜている

## 次に読むページ

- [アルゴリズム](/ja/algorithms)
- [アーキテクチャ](/ja/architecture)
- [機能 / 投資・リプレイ](/ja/features/investment-replay)