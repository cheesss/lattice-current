<template>
  <section class="lc-section lc-topology">
    <div class="lc-section-head">
      <div>
        <p class="lc-kicker">{{ current.kicker }}</p>
        <h2>{{ current.title }}</h2>
        <p>{{ current.lead }}</p>
      </div>
      <div class="lc-badge-row">
        <span v-for="badge in current.badges" :key="badge" class="lc-badge">{{ badge }}</span>
      </div>
    </div>

    <div class="lc-topology-stack">
      <button
        v-for="layer in current.layers"
        :key="layer.id"
        class="lc-topology-layer"
        :class="{ 'is-active': layer.id === activeId }"
        type="button"
        @click="activeId = layer.id"
      >
        <div class="lc-topology-layer-head">
          <strong>{{ layer.title }}</strong>
          <span>{{ layer.runtime }}</span>
        </div>
        <p>{{ layer.summary }}</p>
        <div class="lc-chip-row">
          <span v-for="node in layer.nodes.slice(0, 3)" :key="node" class="lc-chip">{{ node }}</span>
        </div>
      </button>
    </div>

    <div class="lc-topology-detail">
      <div class="lc-topology-main">
        <p class="lc-kicker">{{ active.runtime }}</p>
        <h3>{{ active.title }}</h3>
        <p>{{ active.body }}</p>
        <div class="lc-link-block">
          <p class="lc-mini-label">{{ current.nodesLabel }}</p>
          <div class="lc-chip-row">
            <span v-for="node in active.nodes" :key="node" class="lc-chip lc-chip-strong">{{ node }}</span>
          </div>
        </div>
      </div>
      <div class="lc-topology-side">
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.flowsLabel }}</p>
          <ul>
            <li v-for="flow in active.flows" :key="flow">{{ flow }}</li>
          </ul>
        </div>
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.docsLabel }}</p>
          <div class="lc-link-row">
            <a v-for="link in active.links" :key="link.href" class="lc-link-pill" :href="link.href">{{ link.label }}</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type Layer = {
  id: string;
  title: string;
  runtime: string;
  summary: string;
  body: string;
  nodes: string[];
  flows: string[];
  links: { label: string; href: string }[];
};

type TopologyContent = {
  kicker: string;
  title: string;
  lead: string;
  badges: string[];
  nodesLabel: string;
  flowsLabel: string;
  docsLabel: string;
  layers: Layer[];
};

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

function withLocale(locale: Locale, route: string) {
  return locale === 'en' ? route : `/${locale}${route}`;
}

function build(locale: Locale): TopologyContent {
  const links = {
    arch: withLocale(locale, '/architecture'),
    features: withLocale(locale, '/features/'),
    ai: withLocale(locale, '/ai-backtesting/'),
    api: withLocale(locale, '/api'),
    algorithms: withLocale(locale, '/algorithms')
  };

  const localized: Record<Locale, TopologyContent> = {
    en: {
      kicker: 'System topology',
      title: 'Click a layer to see where it runs and what it owns',
      lead: 'This view compresses the full architecture into an operator-friendly stack: interface, analytics, graph, historical replay, and storage.',
      badges: ['Frontend', 'Sidecar', 'Historical archive'],
      nodesLabel: 'Key nodes',
      flowsLabel: 'Main flows',
      docsLabel: 'Related docs',
      layers: [
        {
          id: 'interface',
          title: 'Interface layer',
          runtime: 'Browser / desktop shell',
          summary: 'Panels, maps, overlays, and operator navigation.',
          body: 'The interface layer is where analysts read, compare, filter, and drill into current signals. It renders maps, panels, and interactive docs surfaces.',
          nodes: ['panel layout', 'map container', 'analysis hub', 'backtest lab'],
          flows: ['renders normalized state', 'routes clicks into focused context', 'surfaces alerts and replay outputs'],
          links: [{ label: 'Architecture', href: links.arch }, { label: 'Features', href: links.features }]
        },
        {
          id: 'analytics',
          title: 'Analytics layer',
          runtime: 'TypeScript services',
          summary: 'Scoring, credibility, transmission, and investment logic.',
          body: 'Core analytical services transform normalized events into credibility scores, risk metrics, graph context, and decision-support objects.',
          nodes: ['source credibility', 'country instability', 'event transmission', 'investment intelligence'],
          flows: ['consumes normalized events', 'produces scores and paths', 'feeds panels and replay'],
          links: [{ label: 'Algorithms', href: links.algorithms }, { label: 'AI & Backtesting', href: links.ai }]
        },
        {
          id: 'graph',
          title: 'Graph and ontology layer',
          runtime: 'Client analysis + persisted snapshots',
          summary: 'Entity resolution, constraints, graph slices, and STIX/export views.',
          body: 'This layer explains relationship structure: what entities exist, which links were accepted or rejected, and how graph state changes over time.',
          nodes: ['entity ontology', 'keyword registry', 'ontology graph', 'event store'],
          flows: ['normalizes aliases', 'enforces relation grammar', 'supports Q&A and replay context'],
          links: [{ label: 'Algorithms', href: links.algorithms }, { label: 'Architecture', href: links.arch }]
        },
        {
          id: 'historical',
          title: 'Historical replay layer',
          runtime: 'Local jobs + archive adapters',
          summary: 'Point-in-time replay, walk-forward validation, and archive sync.',
          body: 'Historical services ingest past data, enforce point-in-time boundaries, run replay jobs, and preserve backtest traces for comparison.',
          nodes: ['historical importer', 'walk-forward runner', 'DuckDB archive', 'Postgres sync'],
          flows: ['loads replay frames', 'updates priors', 'stores run results', 'feeds Backtest Lab'],
          links: [{ label: 'AI & Backtesting', href: links.ai }, { label: 'API', href: links.api }]
        },
        {
          id: 'storage',
          title: 'Storage and local runtime',
          runtime: 'IndexedDB / local sidecar / optional Postgres',
          summary: 'Persistent cache, archive files, resource telemetry, and local APIs.',
          body: 'Storage and runtime services keep snapshots, caches, archives, resource stats, and sidecar endpoints available across runs.',
          nodes: ['persistent cache', 'DuckDB archive', 'resource telemetry', 'local API server'],
          flows: ['stores caches and replay runs', 'reports resource pressure', 'bridges desktop-only features'],
          links: [{ label: 'Architecture', href: links.arch }, { label: 'API', href: links.api }]
        }
      ]
    },
    ko: {
      kicker: '시스템 토폴로지',
      title: '레이어를 클릭하면 어디서 돌고 무엇을 담당하는지 볼 수 있습니다',
      lead: '이 뷰는 전체 아키텍처를 운영자가 이해하기 쉬운 스택으로 압축합니다. 인터페이스, 분석, 그래프, 히스토리컬 리플레이, 저장 계층을 한 번에 보여줍니다.',
      badges: ['프론트엔드', 'Sidecar', '히스토리컬 아카이브'],
      nodesLabel: '핵심 노드',
      flowsLabel: '주요 흐름',
      docsLabel: '관련 문서',
      layers: [
        {
          id: 'interface',
          title: '인터페이스 계층',
          runtime: '브라우저 / 데스크톱 셸',
          summary: '패널, 맵, 오버레이, 운영자 내비게이션.',
          body: '인터페이스 계층은 애널리스트가 현재 신호를 읽고, 비교하고, 필터링하고, drill-down 하는 곳입니다. 맵, 패널, 인터랙티브 문서 표면을 렌더링합니다.',
          nodes: ['panel layout', 'map container', 'analysis hub', 'backtest lab'],
          flows: ['정규화 상태 렌더링', '클릭을 집중 컨텍스트로 라우팅', '경보와 리플레이 출력 노출'],
          links: [{ label: '아키텍처', href: links.arch }, { label: '기능', href: links.features }]
        },
        {
          id: 'analytics',
          title: '분석 계층',
          runtime: 'TypeScript 서비스',
          summary: '점수 계산, credibility, 전이, 투자 로직.',
          body: '핵심 분석 서비스가 정규화 이벤트를 credibility score, risk metric, graph context, decision-support object로 바꿉니다.',
          nodes: ['source credibility', 'country instability', 'event transmission', 'investment intelligence'],
          flows: ['정규화 이벤트 소비', '점수와 경로 생성', '패널과 리플레이에 공급'],
          links: [{ label: '알고리즘', href: links.algorithms }, { label: 'AI · 백테스트', href: links.ai }]
        },
        {
          id: 'graph',
          title: '그래프 · 온톨로지 계층',
          runtime: '클라이언트 분석 + 저장 스냅샷',
          summary: '엔티티 정규화, 제약 규칙, 그래프 슬라이스, STIX/내보내기 뷰.',
          body: '이 계층은 관계 구조를 설명합니다. 어떤 엔티티가 있고, 어떤 링크가 허용되거나 거부됐는지, 그래프 상태가 시간에 따라 어떻게 변했는지를 보여줍니다.',
          nodes: ['entity ontology', 'keyword registry', 'ontology graph', 'event store'],
          flows: ['별칭 정규화', '관계 문법 적용', 'Q&A와 리플레이 컨텍스트 지원'],
          links: [{ label: '알고리즘', href: links.algorithms }, { label: '아키텍처', href: links.arch }]
        },
        {
          id: 'historical',
          title: '히스토리컬 리플레이 계층',
          runtime: '로컬 job + archive adapter',
          summary: 'PiT 리플레이, 워크포워드 검증, 아카이브 동기화.',
          body: '히스토리컬 서비스는 과거 데이터를 적재하고, point-in-time 경계를 강제하며, replay job을 실행하고, 비교용 backtest trace를 저장합니다.',
          nodes: ['historical importer', 'walk-forward runner', 'DuckDB archive', 'Postgres sync'],
          flows: ['replay frame 로드', 'prior 업데이트', 'run 결과 저장', 'Backtest Lab에 공급'],
          links: [{ label: 'AI · 백테스트', href: links.ai }, { label: 'API', href: links.api }]
        },
        {
          id: 'storage',
          title: '저장 · 로컬 런타임 계층',
          runtime: 'IndexedDB / local sidecar / optional Postgres',
          summary: 'persistent cache, archive 파일, resource telemetry, local API.',
          body: '저장/런타임 서비스는 스냅샷, 캐시, 아카이브, 리소스 통계, sidecar endpoint를 실행 간 유지합니다.',
          nodes: ['persistent cache', 'DuckDB archive', 'resource telemetry', 'local API server'],
          flows: ['캐시와 replay run 저장', '리소스 압박 보고', '데스크톱 전용 기능 브리지'],
          links: [{ label: '아키텍처', href: links.arch }, { label: 'API', href: links.api }]
        }
      ]
    },
    ja: {
      kicker: 'システムトポロジー',
      title: 'レイヤーをクリックすると、どこで動き何を担当するか分かる',
      lead: 'このビューは全体アーキテクチャを、運用者が理解しやすいスタックとして圧縮します。インターフェース、分析、グラフ、ヒストリカルリプレイ、ストレージを一度に示します。',
      badges: ['フロントエンド', 'Sidecar', 'ヒストリカルアーカイブ'],
      nodesLabel: '主要ノード',
      flowsLabel: '主なフロー',
      docsLabel: '関連ドキュメント',
      layers: [
        {
          id: 'interface',
          title: 'インターフェース層',
          runtime: 'ブラウザ / デスクトップシェル',
          summary: 'パネル、地図、オーバーレイ、運用ナビゲーション。',
          body: 'インターフェース層は、アナリストが現在のシグナルを読み、比較し、絞り込み、ドリルダウンする場所です。地図、パネル、インタラクティブ文書面を描画します。',
          nodes: ['panel layout', 'map container', 'analysis hub', 'backtest lab'],
          flows: ['正規化状態を描画', 'クリックを集中コンテキストへルーティング', 'アラートとリプレイ出力を表示'],
          links: [{ label: 'アーキテクチャ', href: links.arch }, { label: '機能', href: links.features }]
        },
        {
          id: 'analytics',
          title: '分析層',
          runtime: 'TypeScript サービス',
          summary: 'スコアリング、credibility、伝播、投資ロジック。',
          body: '中核分析サービスが、正規化イベントを credibility score、risk metric、graph context、decision-support object へ変換します。',
          nodes: ['source credibility', 'country instability', 'event transmission', 'investment intelligence'],
          flows: ['正規化イベントを消費', 'スコアと経路を生成', 'パネルとリプレイに供給'],
          links: [{ label: 'アルゴリズム', href: links.algorithms }, { label: 'AI・バックテスト', href: links.ai }]
        },
        {
          id: 'graph',
          title: 'グラフ・オントロジー層',
          runtime: 'クライアント分析 + 保存スナップショット',
          summary: 'エンティティ解決、制約、グラフスライス、STIX/エクスポートビュー。',
          body: 'この層は関係構造を説明します。どのエンティティがあり、どのリンクが受理または拒否され、グラフ状態が時間と共にどう変わるかを示します。',
          nodes: ['entity ontology', 'keyword registry', 'ontology graph', 'event store'],
          flows: ['別名を正規化', '関係文法を適用', 'Q&A とリプレイ文脈を支援'],
          links: [{ label: 'アルゴリズム', href: links.algorithms }, { label: 'アーキテクチャ', href: links.arch }]
        },
        {
          id: 'historical',
          title: 'ヒストリカルリプレイ層',
          runtime: 'ローカルジョブ + アーカイブアダプタ',
          summary: 'PiT リプレイ、ウォークフォワード検証、アーカイブ同期。',
          body: 'ヒストリカルサービスは過去データを取り込み、point-in-time 境界を強制し、replay job を実行し、比較用 backtest trace を保持します。',
          nodes: ['historical importer', 'walk-forward runner', 'DuckDB archive', 'Postgres sync'],
          flows: ['replay frame を読み込む', 'prior を更新する', 'run 結果を保存する', 'Backtest Lab へ供給する'],
          links: [{ label: 'AI・バックテスト', href: links.ai }, { label: 'API', href: links.api }]
        },
        {
          id: 'storage',
          title: 'ストレージ・ローカルランタイム層',
          runtime: 'IndexedDB / local sidecar / optional Postgres',
          summary: 'persistent cache、archive ファイル、resource telemetry、local API。',
          body: 'ストレージと runtime サービスは、スナップショット、キャッシュ、アーカイブ、リソース統計、sidecar endpoint を実行間で保持します。',
          nodes: ['persistent cache', 'DuckDB archive', 'resource telemetry', 'local API server'],
          flows: ['キャッシュと replay run を保存', 'リソース圧力を報告', 'デスクトップ専用機能をブリッジ'],
          links: [{ label: 'アーキテクチャ', href: links.arch }, { label: 'API', href: links.api }]
        }
      ]
    }
  };

  return localized[locale];
}

const current = computed(() => build(props.locale));
const activeId = ref(current.value.layers[0].id);
const active = computed(() => current.value.layers.find((layer) => layer.id === activeId.value) ?? current.value.layers[0]);
</script>

<style scoped>
.lc-section {
  position: relative;
  margin: 28px 0;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top left, rgba(45, 212, 191, 0.12), transparent 34%),
    radial-gradient(circle at bottom right, rgba(251, 191, 36, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(8, 15, 29, 0.95), rgba(15, 23, 42, 0.92));
  box-shadow: 0 24px 72px rgba(2, 6, 23, 0.24);
}

.lc-section-head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.lc-kicker {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  color: #8fd1ff;
}

.lc-section-head h2 {
  margin: 4px 0 8px;
}

.lc-badge-row,
.lc-chip-row,
.lc-link-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lc-badge,
.lc-chip,
.lc-link-pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
}

.lc-chip-strong {
  background: rgba(45, 212, 191, 0.12);
  border-color: rgba(45, 212, 191, 0.22);
}

.lc-link-pill {
  text-decoration: none;
  color: inherit;
}

.lc-topology-stack {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-bottom: 18px;
}

.lc-topology-layer {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 16px;
  background: rgba(15, 23, 42, 0.58);
  color: inherit;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.lc-topology-layer:hover,
.lc-topology-layer.is-active {
  transform: translateY(-2px);
  border-color: rgba(45, 212, 191, 0.36);
  background: rgba(30, 41, 59, 0.92);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
}

.lc-topology-layer-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
}

.lc-topology-layer-head span {
  font-size: 12px;
  color: #8fd1ff;
}

.lc-topology-detail {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.9fr);
}

.lc-topology-main,
.lc-mini-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 18px;
  background: rgba(15, 23, 42, 0.55);
}

.lc-topology-main h3 {
  margin-top: 6px;
}

.lc-topology-side {
  display: grid;
  gap: 12px;
}

.lc-link-block {
  margin-top: 18px;
}

.lc-mini-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fbbf24;
}

.lc-mini-card ul {
  margin: 0;
  padding-left: 18px;
}

.lc-mini-card li + li {
  margin-top: 6px;
}

@media (max-width: 860px) {
  .lc-section-head,
  .lc-topology-detail {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
