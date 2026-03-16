---
layout: home
title: Lattice Current
summary: 1つのコードベースでリアルタイム・インテリジェンス、AI補助分析、オントロジーグラフ、ヒストリカル・リプレイを提供するドキュメントサイト。
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
hero:
  name: Lattice Current
  text: AI・オントロジー・バックテストを備えたリアルタイムインテリジェンス
  tagline: ライブ監視、イベントから市場への伝播分析、リプレイベースの意思決定支援のための独立公開研究フォークです。
  image:
    src: /images/hero/worldmonitor-hero.jpg
    alt: Lattice Current 公開用ヒーロー画像
  actions:
    - theme: brand
      text: 開始ガイド
      link: /ja/getting-started
    - theme: alt
      text: アーキテクチャ
      link: /ja/architecture
    - theme: alt
      text: Playground
      link: /ja/playground
    - theme: alt
      text: GitHub Repo
      link: https://github.com/cheesss/lattice-current
features:
  - title: マルチバリアントのインテリジェンス・ワークスペース
    details: full、tech、finance の各バリアントは同じコードベースを共有しながら、異なるパネル、フィード、ワークフローを公開します。
  - title: 証拠に紐づく AI 分析
    details: 要約、推論、Q&A、構造化分析は、自由なチャットではなく実データに結びついた状態で動作します。
  - title: リプレイとバックテスト
    details: ヒストリカル・リプレイ、ウォークフォワード検証、投資アイデア追跡によって、ライブ監視を検証可能なワークフローに変えます。
---

## 最短の入り方

長い説明を読むより、下の operations console をまず触るのが最短です。

<div class="lc-home-signalbar">
  <div class="lc-home-signalbar-item">
    <span>運用モード</span>
    <strong>Full / Tech / Finance</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>コアループ</span>
    <strong>Signal -> Score -> Connect -> Replay</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>最初の入口</span>
    <strong>Map -> Hub -> Replay -> Scenario</strong>
  </div>
</div>

<InteractiveGlobeHero locale="ja" />

<OperationsConsoleDemo locale="ja" />

## フォークとしての位置づけ

このリポジトリは独立した公開研究フォークです。特定の upstream プロジェクトの公式配布物や公式ホスティングを示すものではありません。

## バリアント

- **Full**: 地政学、紛争、インフラ、軍事、マクロ波及
- **Tech**: AI、スタートアップ、クラウド、サイバー、サプライチェーンとエコシステム監視
- **Finance**: クロスアセット、マクロ、中央銀行、伝播分析、リプレイ、投資ワークフロー

## 必要な経路だけ開く

<div class="lc-home-route-grid">
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">Hands-on path</span>
    <h3>Operations console -> features</h3>
    <p>まずクリックできる map と hub を触って、必要な capability 文書だけ後から開いてください。</p>
    <a href="/ja/playground">Open playground</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">System path</span>
    <h3>Architecture -> runtime ownership</h3>
    <p>どの layer がどこで動き、何を保持し、replay と storage がどう接続されるかを知りたい時だけ topology を開けば十分です。</p>
    <a href="/ja/architecture">アーキテクチャ文書を開く</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">Model path</span>
    <h3>AI and backtesting</h3>
    <p>スコア、prior、validation loop の理由が必要な時だけ model docs に進む構成です。</p>
    <a href="/ja/ai-backtesting/">AI・バックテスト文書を開く</a>
  </div>
</div>

## 公開ドキュメント方針

<div class="policy-callout">
公開ドキュメントは製品動作、アーキテクチャ、アルゴリズムを説明しますが、機微な運用詳細、非公開フィード、資格情報、内部専用ワークフローは省略またはサニタイズします。
</div>

## ここから始める

- [開始ガイド](/ja/getting-started)
- [機能](/ja/features/)
- [AI・バックテスト](/ja/ai-backtesting/)
- [アルゴリズム](/ja/algorithms)
- [法務](/ja/legal/)

## 最新更新

- [2026-03: ホームにインタラクティブグローブを追加](/ja/updates/2026-03-interactive-globe-home)
- [2026-03: ドキュメントサイト公開と公開ポリシー整理](/ja/updates/2026-03-docs-launch)
