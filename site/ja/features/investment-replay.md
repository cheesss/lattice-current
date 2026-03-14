---
title: 投資・リプレイ
summary: イベントから資産へのマッピング、アイデア支援、リプレイ、ウォークフォワード評価。
status: beta
variants:
  - finance
  - tech
updated: 2026-03-15
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

## 主な UI 面

- Investment Workflow
- Auto Investment Ideas
- Backtest Lab
- Transmission Sankey / Network

## 関連アルゴリズム

- event-to-market transmission
- regime weighting
- Kalman スタイル adaptive weighting
- Hawkes intensity, transfer entropy, bandits
- historical replay と warm-up handling

## 制限

公開サイトはシステム動作を説明しますが、非公開の運用データや機微な市場設定は公開しません。

## バリアント適用範囲

主な対象は `finance` で、`tech` にも一部の拡張共有があります。