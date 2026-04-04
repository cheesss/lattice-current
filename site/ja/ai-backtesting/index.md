---
title: Signal Evaluation
summary: AI、シグナル解釈、判断支援、リプレイ検証の関係を説明します。
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-04-05
owner: core
---

# Signal Evaluation

このセクションは、現在のブランチで AI、シグナル解釈、判断支援、リプレイ検証がどう結び付いているかを説明する文書をまとめます。

## Core artifacts

- [ドキュメント索引](https://github.com/cheesss/lattice-current/blob/main/docs/DOCUMENTATION.md)
- [アルゴリズム](https://github.com/cheesss/lattice-current/blob/main/docs/ALGORITHMS.md)
- [AI Intelligence](https://github.com/cheesss/lattice-current/blob/main/docs/AI_INTELLIGENCE.md)
- [判断支援プレイブック](https://github.com/cheesss/lattice-current/blob/main/docs/investment-usage-playbook.md)
- [Temporal feature upgrade status](https://github.com/cheesss/lattice-current/blob/main/docs/TEMPORAL_FEATURE_UPGRADE_2026-04-05.md)

## Integrated flow

1. live feeds and structured services create a current snapshot
2. AI, event resolution, and graph layers build evidence-grounded context
3. 判断支援ロジックがシグナルを候補に変換する
4. リプレイと履歴検証がその候補の妥当性を確認する
5. 検証結果が証拠品質と admission 品質を補正する

## Public mock workbench

The public docs include a click-through mock replay workbench. It is not connected to private feeds, but it mirrors the product structure.

- point-in-time datasets
- replay and scenario comparison
- operator decision posture
- hot / warm / cold storage lifecycle

<ReplayScenarioWorkbench locale="ja" />

## Current limits

- いくつかの確率レイヤーはまだ実用的近似です
- リプレイ品質は point-in-time データの完全性に依存します
- 現在の main ブランチは完全自動売買スタックではありません

## Read next

- [Algorithms](/ja/algorithms)
- [Architecture](/ja/architecture)
- [Features / Investment & Replay](/ja/features/investment-replay)
- [Operations Console](/ja/playground)
