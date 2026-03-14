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

## 主なサブシステム

- フロントエンド app shell とパネルシステム
- ドメインサービスと分析モジュール
- デスクトップ sidecar とローカル API
- ヒストリカル・リプレイとアーカイブサービス
- 生成されたサービス契約と OpenAPI surface

## 参照文書

- [アーキテクチャ詳細](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [デスクトップ runtime](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [過去データソース](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)
- [インテリジェンスサーバースキーマ](https://github.com/cheesss/lattice-current/blob/main/docs/intelligence-server-schema.sql)

## 公開境界

このサイトはアーキテクチャ判断と主要フローを説明しますが、非公開運用手順、シークレット、機微なデプロイ詳細は含みません。