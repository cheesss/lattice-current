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

1. Playground を開く
2. mock live event を一つ選ぶ
3. transmission path を確認する
4. replay case と比較する

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
    <span>公開面</span>
    <strong>ドキュメント、リプレイ、アーキテクチャ、API</strong>
  </div>
</div>

<div class="lc-overview-grid">
  <div class="lc-overview-card">
    <h3>ライブから意思決定まで</h3>
    <p>シグナルは収集、スコア化、グラフ文脈、意思決定支援、リプレイまで同じ製品面でつながります。</p>
  </div>
  <div class="lc-overview-card">
    <h3>説明しやすい内部構造</h3>
    <p>中核レイヤーを静的な箇条書きではなく、クリックできる機能マップとアーキテクチャスタックで理解できます。</p>
  </div>
  <div class="lc-overview-card">
    <h3>接続された機能探索</h3>
    <p>ライブ監視、オントロジー、伝播、リプレイ、リソース計測がどう連動するかをクリックしながら追えます。</p>
  </div>
</div>

<div class="lc-home-section-grid">
  <div class="lc-home-section-card">
    <h3>最初の入口</h3>
    <p>新しい訪問者には、まず Playground で synthetic operator workflow を触るルートを推奨します。</p>
  </div>
  <div class="lc-home-section-card alt">
    <h3>次のルート</h3>
    <p>機能ページで capability を見て、アーキテクチャで ownership を見て、AI・バックテストで内部ロジックを追う構成です。</p>
  </div>
</div>

<InteractivePlayground locale="ja" />

<AudienceWorkbench locale="ja" />

<DecisionLoop locale="ja" />

<CapabilityConstellation locale="ja" />

<SystemTopology locale="ja" />

## フォークとしての位置づけ

このリポジトリは独立した公開研究フォークです。特定の upstream プロジェクトの公式配布物や公式ホスティングを示すものではありません。

## バリアント

- **Full**: 地政学、紛争、インフラ、軍事、マクロ波及
- **Tech**: AI、スタートアップ、クラウド、サイバー、サプライチェーンとエコシステム監視
- **Finance**: クロスアセット、マクロ、中央銀行、伝播分析、リプレイ、投資ワークフロー

## ビジュアルで構造を理解する

<div class="lc-home-route-grid">
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">Hands-on path</span>
    <h3>Playground -> features</h3>
    <p>まず mock interface を触って、その後で必要な capability 文書へ進んでください。</p>
    <a href="/ja/playground">Open playground</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">運用経路</span>
    <h3>ライブ監視 -> 伝播</h3>
    <p>ライブインテリジェンスから始めて、テーマがセクターや資産へ波及し始めたら伝播モデルへ移動してください。</p>
    <a href="/ja/features/live-intelligence">ライブインテリジェンス文書を開く</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">研究経路</span>
    <h3>オントロジー -> AI 分析</h3>
    <p>グラフ状態と証拠ベース AI 文書を組み合わせて、クラスタが実際に何を意味するのかを把握します。</p>
    <a href="/ja/ai-backtesting/">AI・バックテスト文書を開く</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">検証経路</span>
    <h3>リプレイ -> バックテスト -> prior</h3>
    <p>ヒストリカルリプレイとウォークフォワードで、意思決定ロジックが point-in-time 条件でも有効かを確認します。</p>
    <a href="/ja/features/investment-replay">投資・リプレイ文書を開く</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">ビルダー経路</span>
    <h3>アーキテクチャ -> API -> 公開同期</h3>
    <p>開発者はランタイム層、公開インターフェース、内部 -> 公開の配布フローをこの経路で追えます。</p>
    <a href="/ja/architecture">アーキテクチャ文書を開く</a>
  </div>
</div>

## 公開ドキュメント方針

<div class="policy-callout">
公開ドキュメントは製品動作、アーキテクチャ、アルゴリズムを説明しますが、機微な運用詳細、非公開フィード、資格情報、内部専用ワークフローは省略またはサニタイズします。
</div>

<div class="lc-home-cta-slab">
  <h2>このサイトを README ではなくシステムマップとして使ってください</h2>
  <p>最短ルートは Playground -> feature map -> architecture topology です。詳細ページは必要になった時だけ開けば十分です。</p>
  <div class="lc-link-row">
    <a class="lc-link-pill" href="/ja/playground">Open playground</a>
    <a class="lc-link-pill" href="/ja/features/">機能を見る</a>
    <a class="lc-link-pill" href="/ja/architecture">トポロジーを開く</a>
    <a class="lc-link-pill" href="/ja/ai-backtesting/">リプレイロジックを見る</a>
  </div>
</div>

## ここから始める

- [開始ガイド](/ja/getting-started)
- [機能](/ja/features/)
- [AI・バックテスト](/ja/ai-backtesting/)
- [アルゴリズム](/ja/algorithms)
- [法務](/ja/legal/)

## 最新更新

- [2026-03: ドキュメントサイト公開と公開ポリシー整理](/ja/updates/2026-03-docs-launch)
