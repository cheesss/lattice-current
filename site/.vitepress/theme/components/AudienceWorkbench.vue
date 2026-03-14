<template>
  <section class="lc-section lc-workbench">
    <div class="lc-section-head">
      <div>
        <p class="lc-kicker">{{ copy.kicker }}</p>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.lead }}</p>
      </div>
      <div class="lc-badge-row">
        <span v-for="badge in copy.badges" :key="badge" class="lc-badge">{{ badge }}</span>
      </div>
    </div>

    <div class="lc-workbench-tabs">
      <button
        v-for="mode in modes"
        :key="mode.id"
        class="lc-workbench-tab"
        :class="{ 'is-active': mode.id === activeId }"
        type="button"
        @click="activeId = mode.id"
      >
        <span class="lc-workbench-tab-label">{{ mode.label }}</span>
        <span class="lc-workbench-tab-meta">{{ mode.meta }}</span>
      </button>
    </div>

    <div class="lc-workbench-panel">
      <div class="lc-workbench-main">
        <p class="lc-kicker">{{ active.kicker }}</p>
        <h3>{{ active.title }}</h3>
        <p>{{ active.body }}</p>
        <div class="lc-chip-row">
          <span v-for="signal in active.signals" :key="signal" class="lc-chip">{{ signal }}</span>
        </div>
      </div>

      <div class="lc-workbench-side">
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ copy.bestSurfacesLabel }}</p>
          <ul>
            <li v-for="surface in active.surfaces" :key="surface">{{ surface }}</li>
          </ul>
        </div>
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ copy.bestActionsLabel }}</p>
          <ul>
            <li v-for="action in active.actions" :key="action">{{ action }}</li>
          </ul>
        </div>
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ copy.docsLabel }}</p>
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
type LinkItem = { label: string; href: string };
type Mode = {
  id: string;
  label: string;
  meta: string;
  kicker: string;
  title: string;
  body: string;
  signals: string[];
  surfaces: string[];
  actions: string[];
  links: LinkItem[];
};
type Copy = {
  kicker: string;
  title: string;
  lead: string;
  badges: string[];
  bestSurfacesLabel: string;
  bestActionsLabel: string;
  docsLabel: string;
  modes: Mode[];
};

const props = withDefaults(defineProps<{ locale?: Locale }>(), {
  locale: 'en'
});

function withLocale(locale: Locale, route: string) {
  return locale === 'en' ? route : `/${locale}${route}`;
}

function createCopy(locale: Locale): Copy {
  const links = {
    features: withLocale(locale, '/features/'),
    live: withLocale(locale, '/features/live-intelligence'),
    invest: withLocale(locale, '/features/investment-replay'),
    ai: withLocale(locale, '/ai-backtesting/'),
    arch: withLocale(locale, '/architecture')
  };

  const localized: Record<Locale, Copy> = {
    en: {
      kicker: 'Choose a mode',
      title: 'Different users should start in different places',
      lead: 'Use the tabs to see which surfaces matter most for operators, researchers, macro desks, and builders.',
      badges: ['Operator paths', 'Role-oriented', 'Clickable'],
      bestSurfacesLabel: 'Best surfaces',
      bestActionsLabel: 'Typical next actions',
      docsLabel: 'Open docs',
      modes: [
        {
          id: 'ops',
          label: 'Operations',
          meta: 'live monitoring',
          kicker: 'Live posture',
          title: 'Use the product as a live command surface',
          body: 'Operations-focused users should start with the live map, hotspot detection, alert stack, and resource instrumentation to stay ahead of changing conditions.',
          signals: ['alerts', 'country instability', 'critical feeds'],
          surfaces: ['Live Intelligence', 'Signal Ridge', 'Resource Profiler'],
          actions: ['triage alerts', 'pin a theater or theme', 'open related transmission paths'],
          links: [{ label: 'Live Intelligence', href: links.live }, { label: 'Architecture', href: links.arch }]
        },
        {
          id: 'research',
          label: 'Research',
          meta: 'evidence + graph',
          kicker: 'Evidence mode',
          title: 'Use the graph and AI layers to build explanations',
          body: 'Researchers should pivot between ontology, AI deduction, and cross-linked docs to understand why a theme exists and which sources support it.',
          signals: ['ontology state', 'source credibility', 'graph themes'],
          surfaces: ['Ontology Graph', 'AI & Backtesting', 'Feature Explorer'],
          actions: ['inspect entity links', 'open evidence-first AI notes', 'compare feature surfaces'],
          links: [{ label: 'AI & Backtesting', href: links.ai }, { label: 'Features', href: links.features }]
        },
        {
          id: 'macro',
          label: 'Macro Desk',
          meta: 'markets + replay',
          kicker: 'Decision support',
          title: 'Use transmission and replay before taking conviction',
          body: 'Macro and investment workflows should start with transmission, investment cards, and replay validation before trusting any idea or market narrative.',
          signals: ['regime state', 'transmission paths', 'historical analogs'],
          surfaces: ['Investment & Replay', 'Backtest Lab', 'Transmission Network'],
          actions: ['check regime bias', 'compare analog runs', 'review sizing and invalidation'],
          links: [{ label: 'Investment & Replay', href: links.invest }, { label: 'AI & Backtesting', href: links.ai }]
        },
        {
          id: 'builder',
          label: 'Builders',
          meta: 'architecture + runtime',
          kicker: 'System layer',
          title: 'Use topology and docs to understand the moving parts',
          body: 'Developers and maintainers should use the architecture stack, capability graph, and public docs taxonomy to understand where each subsystem lives.',
          signals: ['runtime layers', 'public surfaces', 'archive paths'],
          surfaces: ['Architecture', 'Capability Constellation', 'Public Sync'],
          actions: ['trace a subsystem', 'check storage and replay boundaries', 'sync internal to public repo'],
          links: [{ label: 'Architecture', href: links.arch }, { label: 'Features', href: links.features }]
        }
      ]
    },
    ko: {
      kicker: '사용 모드 선택',
      title: '사용자 유형에 따라 시작 지점이 달라야 합니다',
      lead: '탭을 눌러 운영자, 리서처, 매크로 데스크, 빌더 각각이 어디서 시작하는 게 좋은지 확인하세요.',
      badges: ['역할 기반', '운영 경로', '클릭형'],
      bestSurfacesLabel: '추천 화면',
      bestActionsLabel: '다음 행동',
      docsLabel: '열 수 있는 문서',
      modes: [
        {
          id: 'ops',
          label: '운영자',
          meta: '실시간 모니터링',
          kicker: '라이브 태세',
          title: '제품을 실시간 관제 표면으로 사용하는 방식',
          body: '운영자 중심 사용자는 라이브 맵, 핫스팟 감지, 경보 스택, 리소스 계측부터 시작해 빠르게 변하는 상황을 따라가는 것이 좋습니다.',
          signals: ['경보', '국가 불안정', 'critical feed'],
          surfaces: ['실시간 인텔리전스', 'Signal Ridge', '리소스 프로파일러'],
          actions: ['경보 분류', '지역/테마 고정', '관련 전이 경로 열기'],
          links: [{ label: '실시간 인텔리전스', href: links.live }, { label: '아키텍처', href: links.arch }]
        },
        {
          id: 'research',
          label: '리서처',
          meta: '근거 + 그래프',
          kicker: '근거 모드',
          title: '그래프와 AI 계층으로 설명을 만드는 방식',
          body: '리서처는 온톨로지, AI 추론, 상호 연결된 문서를 넘나들며 왜 이 테마가 생겼고 어떤 소스가 이를 지지하는지 확인해야 합니다.',
          signals: ['온톨로지 상태', 'source credibility', 'graph theme'],
          surfaces: ['온톨로지 그래프', 'AI · 백테스트', '기능 탐색기'],
          actions: ['엔티티 링크 확인', '근거 중심 AI 문서 열기', '기능 표면 비교'],
          links: [{ label: 'AI · 백테스트', href: links.ai }, { label: '기능', href: links.features }]
        },
        {
          id: 'macro',
          label: '매크로 데스크',
          meta: '시장 + 리플레이',
          kicker: '의사결정 지원',
          title: '전이와 리플레이를 먼저 보고 확신도를 잡는 방식',
          body: '매크로와 투자 워크플로우는 전이, 투자 카드, 리플레이 검증을 먼저 보고 나서야 아이디어와 시장 내러티브를 신뢰하는 것이 맞습니다.',
          signals: ['regime 상태', '전이 경로', 'historical analog'],
          surfaces: ['투자 · 리플레이', 'Backtest Lab', '전이 네트워크'],
          actions: ['regime 편향 확인', '유사 런 비교', '사이징과 무효화 검토'],
          links: [{ label: '투자 · 리플레이', href: links.invest }, { label: 'AI · 백테스트', href: links.ai }]
        },
        {
          id: 'builder',
          label: '빌더',
          meta: '아키텍처 + 런타임',
          kicker: '시스템 계층',
          title: '토폴로지와 문서로 내부 구조를 이해하는 방식',
          body: '개발자와 유지보수자는 아키텍처 스택, 기능 연결 그래프, 공개 문서 구조를 통해 각 서브시스템이 어디에 있고 무엇을 담당하는지 파악해야 합니다.',
          signals: ['런타임 계층', '공개 표면', '아카이브 경로'],
          surfaces: ['아키텍처', 'Capability Constellation', 'Public Sync'],
          actions: ['서브시스템 추적', '저장/리플레이 경계 확인', '내부 -> 공개 동기화'],
          links: [{ label: '아키텍처', href: links.arch }, { label: '기능', href: links.features }]
        }
      ]
    },
    ja: {
      kicker: '利用モード選択',
      title: '利用者ごとに最初の入口は変わるべきです',
      lead: 'タブを押して、運用者、研究者、マクロデスク、ビルダーがどこから始めるのが良いかを確認できます。',
      badges: ['役割ベース', '運用経路', 'クリック型'],
      bestSurfacesLabel: 'おすすめ画面',
      bestActionsLabel: '次の行動',
      docsLabel: '開くドキュメント',
      modes: [
        {
          id: 'ops',
          label: '運用者',
          meta: 'ライブ監視',
          kicker: 'ライブ態勢',
          title: '製品をリアルタイムの指揮面として使う方法',
          body: '運用者は、ライブ地図、ホットスポット検知、アラートスタック、リソース計測から始めて、変化する状況を先回りして追うべきです。',
          signals: ['アラート', '国別不安定指数', 'critical feed'],
          surfaces: ['ライブインテリジェンス', 'Signal Ridge', 'リソースプロファイラ'],
          actions: ['アラートを仕分ける', '地域/テーマを固定する', '関連伝播経路を開く'],
          links: [{ label: 'ライブインテリジェンス', href: links.live }, { label: 'アーキテクチャ', href: links.arch }]
        },
        {
          id: 'research',
          label: '研究者',
          meta: '証拠 + グラフ',
          kicker: '証拠モード',
          title: 'グラフと AI 層で説明を組み立てる方法',
          body: '研究者はオントロジー、AI 推論、相互リンクされた文書を往復しながら、なぜこのテーマが存在し、どのソースが支えているかを確認するべきです。',
          signals: ['オントロジー状態', 'source credibility', 'graph theme'],
          surfaces: ['オントロジーグラフ', 'AI・バックテスト', '機能エクスプローラ'],
          actions: ['エンティティリンクを確認', '証拠ベース AI 文書を開く', '機能面を比較'],
          links: [{ label: 'AI・バックテスト', href: links.ai }, { label: '機能', href: links.features }]
        },
        {
          id: 'macro',
          label: 'マクロデスク',
          meta: '市場 + リプレイ',
          kicker: '意思決定支援',
          title: '伝播とリプレイを先に見てから確信度を作る方法',
          body: 'マクロと投資ワークフローは、伝播、投資カード、リプレイ検証を先に見てからでなければ、アイデアや市場ナラティブを信頼すべきではありません。',
          signals: ['regime 状態', '伝播経路', 'historical analog'],
          surfaces: ['投資・リプレイ', 'Backtest Lab', '伝播ネットワーク'],
          actions: ['regime バイアス確認', '類似 run の比較', 'サイズと無効化条件の確認'],
          links: [{ label: '投資・リプレイ', href: links.invest }, { label: 'AI・バックテスト', href: links.ai }]
        },
        {
          id: 'builder',
          label: 'ビルダー',
          meta: 'アーキテクチャ + ランタイム',
          kicker: 'システム層',
          title: 'トポロジーと文書で内部構造を理解する方法',
          body: '開発者と保守担当は、アーキテクチャスタック、機能接続グラフ、公開文書構造から各サブシステムの位置と責務を把握するべきです。',
          signals: ['ランタイム層', '公開面', 'アーカイブ経路'],
          surfaces: ['アーキテクチャ', 'Capability Constellation', 'Public Sync'],
          actions: ['サブシステムを追跡する', '保存/リプレイ境界を確認する', '内部 -> 公開同期を実行する'],
          links: [{ label: 'アーキテクチャ', href: links.arch }, { label: '機能', href: links.features }]
        }
      ]
    }
  };

  return localized[locale];
}

const content = computed(() => createCopy(props.locale));
const modes = computed(() => content.value.modes);
const copy = computed(() => content.value);
const activeId = ref(modes.value[0].id);
const active = computed(() => modes.value.find((mode) => mode.id === activeId.value) ?? modes.value[0]);
</script>

<style scoped>
.lc-workbench-tabs {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  margin-bottom: 18px;
}

.lc-workbench-tab {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 16px;
  background: rgba(15, 23, 42, 0.58);
  color: inherit;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.lc-workbench-tab:hover,
.lc-workbench-tab.is-active {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(30, 41, 59, 0.92);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.26);
}

.lc-workbench-tab-label {
  display: block;
  font-weight: 700;
  margin-bottom: 8px;
}

.lc-workbench-tab-meta {
  color: #8fd1ff;
  font-size: 12px;
}

.lc-workbench-panel {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
}

.lc-workbench-main,
.lc-mini-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 18px;
  background: rgba(15, 23, 42, 0.55);
}

.lc-workbench-main h3 {
  margin-top: 6px;
}

.lc-workbench-side {
  display: grid;
  gap: 12px;
}

@media (max-width: 860px) {
  .lc-workbench-panel {
    grid-template-columns: 1fr;
  }
}
</style>
