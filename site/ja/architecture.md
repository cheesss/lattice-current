---
title: アーキテクチャ
summary: フロントエンド、サービス、デスクトップ sidecar、データフロー、アーカイブ層。
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# アーキテクチャ

<p class="lc-section-caption">
下のアーキテクチャスタックはインタラクティブです。レイヤーをクリックすると、実行境界だけでなく所有ノード、責務、状態境界、セキュリティ境界まで確認できます。
</p>

<ScrollSignalStory locale="ja" />

<SystemTopology locale="ja" />

## 主なサブシステム

- フロントエンド app shell とパネルシステム
- ドメインサービスと分析モジュール
- デスクトップ sidecar とローカル API
- ヒストリカル・リプレイとアーカイブサービス
- storage envelope, schema registry, and hot / warm / cold retention pipeline
- unattended dataset registry と scheduler worker
- theme discovery queue と guarded Codex proposer
- 生成されたサービス契約と OpenAPI surface

## 参照文書

- [アーキテクチャ詳細](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [デスクトップ runtime](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [過去データソース](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)
- [Phase 7 implementation notes](https://github.com/cheesss/lattice-current/blob/main/docs/PHASE7_IMPLEMENTATION_NOTES.md)
- [インテリジェンスサーバースキーマ](https://github.com/cheesss/lattice-current/blob/main/docs/intelligence-server-schema.sql)
- [サービス公開準備計画](https://github.com/cheesss/lattice-current/blob/main/docs/service-server-plan.md)

## 公開境界

このサイトはアーキテクチャ判断と主要フローを説明しますが、非公開運用手順、シークレット、機微なデプロイ詳細は含みません。
