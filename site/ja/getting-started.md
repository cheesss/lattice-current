---
title: 開始ガイド
summary: アプリをローカルで動かし、公開リポジトリの表面とドキュメント範囲を理解します。
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# 開始ガイド

## 要件

- Node.js 20+
- npm
- Tauri アーティファクトをビルドする場合は追加のデスクトップ前提条件

## ローカル開発

```bash
npm install
npm run dev
```

よく使うコマンド:

```bash
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
npm run docs:dev
npm run docs:build
```

## リポジトリの表面

- `src/`: フロントエンドと分析サービス
- `server/`: サービスハンドラと API
- `src-tauri/`: デスクトップ runtime と local sidecar
- `docs/`: 詳細な技術文書とリファレンス
- `site/`: GitHub Pages ドキュメントサイト

## ブランドに関する注意

この公開フォークのブランドは `Lattice Current` です。

一方で、コードパス、パッケージ名、localStorage キー、proto パッケージなどには legacy `worldmonitor` 識別子が残っています。これは実装上または継承された構造を示すものであり、このリポジトリの公開ブランドではありません。

## 次に読む文書

- [バリアント](/ja/variants)
- [機能](/ja/features/)
- [アーキテクチャ](/ja/architecture)
- [API](/ja/api)