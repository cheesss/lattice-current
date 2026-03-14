<template>
  <section class="lc-section lc-feature-explorer">
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

    <div class="lc-feature-grid">
      <button
        v-for="item in current.items"
        :key="item.id"
        class="lc-feature-card"
        :class="{ 'is-active': item.id === activeId }"
        type="button"
        @click="activeId = item.id"
      >
        <span class="lc-feature-status">{{ item.status }}</span>
        <strong>{{ item.title }}</strong>
        <span>{{ item.summary }}</span>
      </button>
    </div>

    <div class="lc-feature-detail">
      <div class="lc-feature-main">
        <p class="lc-kicker">{{ active.panelLabel }}</p>
        <h3>{{ active.title }}</h3>
        <p>{{ active.body }}</p>

        <div class="lc-link-block">
          <p class="lc-mini-label">{{ current.docsLabel }}</p>
          <div class="lc-link-row">
            <a v-for="link in active.links" :key="link.href" class="lc-link-pill" :href="link.href">{{ link.label }}</a>
          </div>
        </div>
      </div>

      <div class="lc-feature-side">
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.connectsLabel }}</p>
          <div class="lc-link-row">
            <button
              v-for="connection in active.connections"
              :key="connection.id"
              class="lc-link-pill lc-link-pill-button"
              type="button"
              @click="activeId = connection.id"
            >
              {{ connection.label }}
            </button>
          </div>
        </div>
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.stackLabel }}</p>
          <ul>
            <li v-for="entry in active.stack" :key="entry">{{ entry }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type LinkItem = { label: string; href: string };
type Connection = { id: string; label: string };
type Item = {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: string;
  panelLabel: string;
  links: LinkItem[];
  connections: Connection[];
  stack: string[];
};

type ExplorerCopy = {
  kicker: string;
  title: string;
  lead: string;
  badges: string[];
  docsLabel: string;
  connectsLabel: string;
  stackLabel: string;
  items: Item[];
};

const props = withDefaults(defineProps<{ locale?: Locale }>(), {
  locale: 'en'
});

function withLocale(locale: Locale, route: string) {
  return locale === 'en' ? route : `/${locale}${route}`;
}

function buildContent(locale: Locale): ExplorerCopy {
  const links = {
    live: withLocale(locale, '/features/live-intelligence'),
    invest: withLocale(locale, '/features/investment-replay'),
    ai: withLocale(locale, '/ai-backtesting/'),
    algo: withLocale(locale, '/algorithms'),
    arch: withLocale(locale, '/architecture'),
    api: withLocale(locale, '/api')
  };

  const localized: Record<Locale, ExplorerCopy> = {
    en: {
      kicker: 'Interactive capability map',
      title: 'Click a capability to see what it connects to',
      lead: 'This is the fast way to understand what each product surface does, where it lives, and what other systems it depends on.',
      badges: ['Clickable', 'Cross-linked', 'Variant-aware'],
      docsLabel: 'Open docs',
      connectsLabel: 'Connected capabilities',
      stackLabel: 'Internal structure',
      items: [
        {
          id: 'live',
          title: 'Live Intelligence',
          summary: 'The live map and alerting surface.',
          body: 'The live intelligence layer merges feeds, map overlays, credibility, and thematic hotspots into a single operational surface for analysts.',
          status: 'Live ops',
          panelLabel: 'Operational surface',
          links: [{ label: 'Feature page', href: links.live }, { label: 'Architecture', href: links.arch }],
          connections: [{ id: 'graph', label: 'Ontology Graph' }, { id: 'ai', label: 'AI Analysis' }, { id: 'transmission', label: 'Transmission Engine' }],
          stack: ['feed collection', 'signal aggregation', 'map layers', 'country and theater scores']
        },
        {
          id: 'ai',
          title: 'AI Analysis',
          summary: 'Evidence-first summaries and Q&A.',
          body: 'AI layers summarize, deduce, and answer questions, but stay tied to graph context, source evidence, and current snapshot data.',
          status: 'Analysis',
          panelLabel: 'Reasoning layer',
          links: [{ label: 'AI & Backtesting', href: links.ai }, { label: 'Algorithms', href: links.algo }],
          connections: [{ id: 'live', label: 'Live Intelligence' }, { id: 'graph', label: 'Ontology Graph' }, { id: 'replay', label: 'Replay & Backtest' }],
          stack: ['deduction', 'Q&A', 'RAG context', 'local and API model routing']
        },
        {
          id: 'graph',
          title: 'Ontology Graph',
          summary: 'Entity, relation, and event topology.',
          body: 'The ontology surface explains how events, entities, and inferred links are organized, rejected, reified, and replayed over time.',
          status: 'Graph',
          panelLabel: 'Knowledge structure',
          links: [{ label: 'Algorithms', href: links.algo }, { label: 'Architecture', href: links.arch }],
          connections: [{ id: 'live', label: 'Live Intelligence' }, { id: 'transmission', label: 'Transmission Engine' }, { id: 'ai', label: 'AI Analysis' }],
          stack: ['entity resolution', 'constraints', 'reified events', 'graph timeslices']
        },
        {
          id: 'transmission',
          title: 'Transmission Engine',
          summary: 'From stories to sectors and assets.',
          body: 'Transmission modeling connects live events to countries, supply chains, sectors, and assets using graph logic, market signals, and adaptive priors.',
          status: 'Market link',
          panelLabel: 'Propagation layer',
          links: [{ label: 'Investment & Replay', href: links.invest }, { label: 'Algorithms', href: links.algo }],
          connections: [{ id: 'live', label: 'Live Intelligence' }, { id: 'replay', label: 'Replay & Backtest' }, { id: 'resource', label: 'Resource Profiler' }],
          stack: ['event-to-market transmission', 'regime model', 'Hawkes and entropy models', 'sizing logic']
        },
        {
          id: 'replay',
          title: 'Replay & Backtest',
          summary: 'Historical validation and walk-forward runs.',
          body: 'Replay and backtest flows measure whether live decision logic would have held up under point-in-time historical conditions.',
          status: 'Validation',
          panelLabel: 'Historical engine',
          links: [{ label: 'Investment & Replay', href: links.invest }, { label: 'AI & Backtesting', href: links.ai }],
          connections: [{ id: 'ai', label: 'AI Analysis' }, { id: 'transmission', label: 'Transmission Engine' }, { id: 'resource', label: 'Resource Profiler' }],
          stack: ['historical importer', 'PiT replay frames', 'walk-forward', 'prior updates']
        },
        {
          id: 'resource',
          title: 'Resource Profiler',
          summary: 'Memory, storage, and hot-path tracking.',
          body: 'Resource profiling exposes which collection or analytics paths consume time, memory, storage, and sidecar capacity so the system stays operable.',
          status: 'Observability',
          panelLabel: 'Runtime instrumentation',
          links: [{ label: 'Architecture', href: links.arch }, { label: 'API', href: links.api }],
          connections: [{ id: 'transmission', label: 'Transmission Engine' }, { id: 'replay', label: 'Replay & Backtest' }, { id: 'live', label: 'Live Intelligence' }],
          stack: ['duration probes', 'heap deltas', 'storage pressure', 'sidecar process stats']
        }
      ]
    },
    ko: {
      kicker: '인터랙티브 기능 맵',
      title: '기능을 클릭하면 어디와 연결되는지 바로 볼 수 있습니다',
      lead: '각 제품 표면이 무엇을 하고, 어디에 위치하며, 어떤 시스템에 의존하는지 빠르게 이해하기 위한 인터랙티브 맵입니다.',
      badges: ['클릭 가능', '상호 연결', '변형 인식'],
      docsLabel: '열 수 있는 문서',
      connectsLabel: '연결된 기능',
      stackLabel: '내부 구조',
      items: [
        {
          id: 'live',
          title: '실시간 인텔리전스',
          summary: '라이브 맵과 경보 표면입니다.',
          body: '실시간 인텔리전스 계층은 피드, 맵 오버레이, credibility, 테마성 hotspot을 하나의 운영 표면으로 묶습니다.',
          status: '운영',
          panelLabel: '운영 표면',
          links: [{ label: '기능 페이지', href: links.live }, { label: '아키텍처', href: links.arch }],
          connections: [{ id: 'graph', label: '온톨로지 그래프' }, { id: 'ai', label: 'AI 분석' }, { id: 'transmission', label: '전이 엔진' }],
          stack: ['피드 수집', 'signal aggregation', '맵 레이어', '국가/전장 점수']
        },
        {
          id: 'ai',
          title: 'AI 분석',
          summary: '근거 중심 요약과 Q&A.',
          body: 'AI 계층은 요약, 추론, 질문 응답을 제공하지만 항상 그래프 컨텍스트, source evidence, 현재 스냅샷 데이터와 연결된 상태를 유지합니다.',
          status: '분석',
          panelLabel: '추론 계층',
          links: [{ label: 'AI · 백테스트', href: links.ai }, { label: '알고리즘', href: links.algo }],
          connections: [{ id: 'live', label: '실시간 인텔리전스' }, { id: 'graph', label: '온톨로지 그래프' }, { id: 'replay', label: '리플레이 · 백테스트' }],
          stack: ['deduction', 'Q&A', 'RAG 컨텍스트', '로컬/원격 모델 라우팅']
        },
        {
          id: 'graph',
          title: '온톨로지 그래프',
          summary: '엔티티, 관계, 이벤트 토폴로지.',
          body: '온톨로지 표면은 이벤트, 엔티티, 추론 링크가 어떻게 정리되고, 거부되고, reify되고, 시간에 따라 리플레이되는지 보여줍니다.',
          status: '그래프',
          panelLabel: '지식 구조',
          links: [{ label: '알고리즘', href: links.algo }, { label: '아키텍처', href: links.arch }],
          connections: [{ id: 'live', label: '실시간 인텔리전스' }, { id: 'transmission', label: '전이 엔진' }, { id: 'ai', label: 'AI 분석' }],
          stack: ['엔티티 정규화', '제약 규칙', 'reified event', 'graph timeslice']
        },
        {
          id: 'transmission',
          title: '전이 엔진',
          summary: '스토리에서 섹터와 자산까지.',
          body: '전이 모델은 그래프 로직, 시장 신호, adaptive prior를 이용해 라이브 이벤트를 국가, 공급망, 섹터, 자산과 연결합니다.',
          status: '시장 연결',
          panelLabel: '파급 계층',
          links: [{ label: '투자 · 리플레이', href: links.invest }, { label: '알고리즘', href: links.algo }],
          connections: [{ id: 'live', label: '실시간 인텔리전스' }, { id: 'replay', label: '리플레이 · 백테스트' }, { id: 'resource', label: '리소스 프로파일러' }],
          stack: ['event-to-market transmission', 'regime model', 'Hawkes / entropy model', '사이징 로직']
        },
        {
          id: 'replay',
          title: '리플레이 · 백테스트',
          summary: '과거 검증과 워크포워드 실행.',
          body: '리플레이와 백테스트 흐름은 라이브 의사결정 로직이 과거 point-in-time 조건에서도 유효했는지 측정합니다.',
          status: '검증',
          panelLabel: '히스토리컬 엔진',
          links: [{ label: '투자 · 리플레이', href: links.invest }, { label: 'AI · 백테스트', href: links.ai }],
          connections: [{ id: 'ai', label: 'AI 분석' }, { id: 'transmission', label: '전이 엔진' }, { id: 'resource', label: '리소스 프로파일러' }],
          stack: ['historical importer', 'PiT replay frame', 'walk-forward', 'prior update']
        },
        {
          id: 'resource',
          title: '리소스 프로파일러',
          summary: '메모리, 저장소, hot path 추적.',
          body: '리소스 프로파일링은 어떤 수집/분석 경로가 시간, 메모리, 저장소, sidecar 자원을 가장 많이 쓰는지 보여줘 시스템이 실제로 운영 가능하게 유지되도록 돕습니다.',
          status: '관측성',
          panelLabel: '런타임 계측',
          links: [{ label: '아키텍처', href: links.arch }, { label: 'API', href: links.api }],
          connections: [{ id: 'transmission', label: '전이 엔진' }, { id: 'replay', label: '리플레이 · 백테스트' }, { id: 'live', label: '실시간 인텔리전스' }],
          stack: ['duration probe', 'heap delta', 'storage pressure', 'sidecar process stat']
        }
      ]
    },
    ja: {
      kicker: 'インタラクティブ機能マップ',
      title: '機能をクリックすると接続先が見える',
      lead: '各製品面が何を行い、どこに位置し、どのシステムに依存するかを素早く把握するためのインタラクティブマップです。',
      badges: ['クリック可能', '相互接続', 'バリアント認識'],
      docsLabel: '開くドキュメント',
      connectsLabel: '接続された機能',
      stackLabel: '内部構造',
      items: [
        {
          id: 'live',
          title: 'ライブインテリジェンス',
          summary: 'ライブ地図とアラートの表面。',
          body: 'ライブインテリジェンス層は、フィード、地図オーバーレイ、credibility、テーマ性 hotspot を単一の運用面に統合します。',
          status: '運用',
          panelLabel: '運用面',
          links: [{ label: '機能ページ', href: links.live }, { label: 'アーキテクチャ', href: links.arch }],
          connections: [{ id: 'graph', label: 'オントロジーグラフ' }, { id: 'ai', label: 'AI 分析' }, { id: 'transmission', label: '伝播エンジン' }],
          stack: ['フィード収集', 'signal aggregation', '地図レイヤー', '国別・戦域スコア']
        },
        {
          id: 'ai',
          title: 'AI 分析',
          summary: '証拠に基づく要約と Q&A。',
          body: 'AI 層は要約、推論、質問応答を提供しますが、常にグラフ文脈、source evidence、現在スナップショットと結びついた状態を保ちます。',
          status: '分析',
          panelLabel: '推論レイヤー',
          links: [{ label: 'AI・バックテスト', href: links.ai }, { label: 'アルゴリズム', href: links.algo }],
          connections: [{ id: 'live', label: 'ライブインテリジェンス' }, { id: 'graph', label: 'オントロジーグラフ' }, { id: 'replay', label: 'リプレイ・バックテスト' }],
          stack: ['deduction', 'Q&A', 'RAG 文脈', 'ローカル/外部モデルルーティング']
        },
        {
          id: 'graph',
          title: 'オントロジーグラフ',
          summary: 'エンティティ、関係、イベントのトポロジー。',
          body: 'オントロジー面は、イベント、エンティティ、推論リンクがどのように整理され、拒否され、reify され、時系列で再生されるかを示します。',
          status: 'グラフ',
          panelLabel: '知識構造',
          links: [{ label: 'アルゴリズム', href: links.algo }, { label: 'アーキテクチャ', href: links.arch }],
          connections: [{ id: 'live', label: 'ライブインテリジェンス' }, { id: 'transmission', label: '伝播エンジン' }, { id: 'ai', label: 'AI 分析' }],
          stack: ['エンティティ解決', '制約ルール', 'reified event', 'graph timeslice']
        },
        {
          id: 'transmission',
          title: '伝播エンジン',
          summary: 'ストーリーからセクターと資産へ。',
          body: '伝播モデルは、グラフロジック、市場シグナル、adaptive prior を使って、ライブイベントを国、サプライチェーン、セクター、資産へ接続します。',
          status: '市場接続',
          panelLabel: '波及レイヤー',
          links: [{ label: '投資・リプレイ', href: links.invest }, { label: 'アルゴリズム', href: links.algo }],
          connections: [{ id: 'live', label: 'ライブインテリジェンス' }, { id: 'replay', label: 'リプレイ・バックテスト' }, { id: 'resource', label: 'リソースプロファイラ' }],
          stack: ['event-to-market transmission', 'regime model', 'Hawkes / entropy model', 'sizing ロジック']
        },
        {
          id: 'replay',
          title: 'リプレイ・バックテスト',
          summary: '過去検証とウォークフォワード実行。',
          body: 'リプレイとバックテストの流れは、ライブ意思決定ロジックが過去の point-in-time 条件でも有効だったかを測定します。',
          status: '検証',
          panelLabel: 'ヒストリカルエンジン',
          links: [{ label: '投資・リプレイ', href: links.invest }, { label: 'AI・バックテスト', href: links.ai }],
          connections: [{ id: 'ai', label: 'AI 分析' }, { id: 'transmission', label: '伝播エンジン' }, { id: 'resource', label: 'リソースプロファイラ' }],
          stack: ['historical importer', 'PiT replay frame', 'walk-forward', 'prior update']
        },
        {
          id: 'resource',
          title: 'リソースプロファイラ',
          summary: 'メモリ、ストレージ、hot path の追跡。',
          body: 'リソースプロファイリングは、どの収集/分析経路が時間、メモリ、ストレージ、sidecar 容量を最も消費するかを可視化し、システムが運用可能な状態を保つのに役立ちます。',
          status: '可観測性',
          panelLabel: 'ランタイム計測',
          links: [{ label: 'アーキテクチャ', href: links.arch }, { label: 'API', href: links.api }],
          connections: [{ id: 'transmission', label: '伝播エンジン' }, { id: 'replay', label: 'リプレイ・バックテスト' }, { id: 'live', label: 'ライブインテリジェンス' }],
          stack: ['duration probe', 'heap delta', 'storage pressure', 'sidecar process stats']
        }
      ]
    }
  };

  return localized[locale];
}

const current = computed(() => buildContent(props.locale));
const activeId = ref(current.value.items[0].id);
const active = computed(() => current.value.items.find((item) => item.id === activeId.value) ?? current.value.items[0]);
</script>

<style scoped>
.lc-section {
  position: relative;
  margin: 28px 0;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 34%),
    radial-gradient(circle at bottom left, rgba(251, 191, 36, 0.12), transparent 34%),
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
.lc-link-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lc-badge,
.lc-link-pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
}

.lc-link-pill {
  text-decoration: none;
  color: inherit;
}

.lc-link-pill-button {
  cursor: pointer;
}

.lc-feature-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  margin-bottom: 18px;
}

.lc-feature-card {
  position: relative;
  display: grid;
  gap: 8px;
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 16px;
  background: rgba(15, 23, 42, 0.58);
  color: inherit;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.lc-feature-card:hover,
.lc-feature-card.is-active {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(30, 41, 59, 0.92);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
}

.lc-feature-card strong {
  font-size: 16px;
}

.lc-feature-card span:last-child {
  color: #cbd5e1;
  font-size: 13px;
}

.lc-feature-status {
  font-size: 11px;
  color: #fbbf24;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lc-feature-detail {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
}

.lc-feature-main,
.lc-mini-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 18px;
  background: rgba(15, 23, 42, 0.55);
}

.lc-feature-main h3 {
  margin-top: 6px;
}

.lc-feature-side {
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
  .lc-feature-detail {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
