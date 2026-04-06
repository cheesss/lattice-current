<template>
  <section class="lc-landing-shell" :style="landingStyle">
    <div class="lc-landing-noise"></div>
    <div class="lc-landing-aurora lc-landing-aurora-a"></div>
    <div class="lc-landing-aurora lc-landing-aurora-b"></div>
    <div class="lc-landing-gridline"></div>

    <div class="lc-landing-grid">
      <div class="lc-landing-copy">
        <p class="lc-landing-kicker">{{ copy.kicker }}</p>
        <h2>{{ copy.title }}</h2>
        <p class="lc-landing-lead">{{ copy.lead }}</p>

        <div class="lc-landing-ticker" aria-hidden="true">
          <span v-for="item in copy.ticker" :key="item">{{ item }}</span>
        </div>

        <div class="lc-landing-mode-row">
          <button
            v-for="mode in modes"
            :key="mode.id"
            class="lc-landing-mode-button"
            :class="{ 'is-active': activeModeId === mode.id }"
            type="button"
            @click="selectMode(mode.id)"
          >
            <span>{{ mode.label[locale] ?? mode.label.en }}</span>
            <strong>{{ mode.short[locale] ?? mode.short.en }}</strong>
          </button>
        </div>

        <div class="lc-landing-metric-grid">
          <div v-for="metric in activeMode.metrics" :key="metric.label.en" class="lc-landing-metric-card">
            <span>{{ metric.label[locale] ?? metric.label.en }}</span>
            <strong>{{ metric.value }}</strong>
            <p>{{ metric.note[locale] ?? metric.note.en }}</p>
          </div>
        </div>

        <div class="lc-landing-route-panel">
          <div class="lc-landing-panel-head">
            <div>
              <p class="lc-mini-label">{{ copy.routeLabel }}</p>
              <h3>{{ activeMode.routeTitle[locale] ?? activeMode.routeTitle.en }}</h3>
            </div>
            <span class="lc-risk-pill" :data-tone="activeMode.tone">{{ activeMode.badge[locale] ?? activeMode.badge.en }}</span>
          </div>

          <div class="lc-landing-route-steps">
            <div v-for="step in activeMode.steps" :key="step.title.en" class="lc-landing-route-step">
              <span class="lc-landing-step-index">{{ step.index }}</span>
              <div>
                <strong>{{ step.title[locale] ?? step.title.en }}</strong>
                <p>{{ step.note[locale] ?? step.note.en }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="lc-landing-visual">
        <div class="lc-landing-command-wall">
          <div class="lc-landing-command-head">
            <div>
              <p class="lc-mini-label">{{ copy.commandLabel }}</p>
              <h3>{{ activeMode.wallTitle[locale] ?? activeMode.wallTitle.en }}</h3>
            </div>
            <span class="lc-landing-command-status">{{ activeMode.status }}</span>
          </div>

          <div class="lc-landing-trace-shell">
            <svg viewBox="0 0 620 220" class="lc-landing-trace-svg" aria-hidden="true">
              <defs>
                <linearGradient id="landingTrace" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="rgba(130, 210, 255, 0.15)" />
                  <stop offset="42%" :stop-color="activeMode.color" />
                  <stop offset="100%" stop-color="rgba(255, 179, 84, 0.16)" />
                </linearGradient>
                <linearGradient id="landingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" :stop-color="activeMode.fillTop" />
                  <stop offset="100%" stop-color="rgba(10, 17, 29, 0.02)" />
                </linearGradient>
              </defs>
              <path d="M0 219 L620 219" class="lc-landing-trace-axis" />
              <path :d="activeMode.areaPath" fill="url(#landingFill)" />
              <path :d="activeMode.tracePath" class="lc-landing-trace-line" stroke="url(#landingTrace)" />
              <circle
                v-for="point in activeMode.tracePoints"
                :key="`${point.x}-${point.y}`"
                class="lc-landing-trace-node"
                :cx="point.x"
                :cy="point.y"
                r="5"
              />
            </svg>
            <div class="lc-landing-trace-overlay">
              <div class="lc-landing-trace-tag">
                <span>{{ copy.traceLabel }}</span>
                <strong>{{ activeMode.traceTag[locale] ?? activeMode.traceTag.en }}</strong>
              </div>
              <div class="lc-landing-trace-tag">
                <span>{{ copy.traceSubLabel }}</span>
                <strong>{{ activeMode.traceSubTag[locale] ?? activeMode.traceSubTag.en }}</strong>
              </div>
            </div>
          </div>

          <div class="lc-landing-stack-grid">
            <div v-for="card in activeMode.wallCards" :key="card.title.en" class="lc-landing-stack-card">
              <span>{{ card.kicker[locale] ?? card.kicker.en }}</span>
              <strong>{{ card.title[locale] ?? card.title.en }}</strong>
              <p>{{ card.note[locale] ?? card.note.en }}</p>
            </div>
          </div>
        </div>

        <div class="lc-landing-float-grid" aria-hidden="true">
          <div class="lc-landing-float-card">
            <span>{{ copy.floatA }}</span>
            <strong>{{ activeMode.floatA }}</strong>
          </div>
          <div class="lc-landing-float-card">
            <span>{{ copy.floatB }}</span>
            <strong>{{ activeMode.floatB }}</strong>
          </div>
          <div class="lc-landing-float-card">
            <span>{{ copy.floatC }}</span>
            <strong>{{ activeMode.floatC }}</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type LocaleCode = 'en' | 'ko' | 'ja';
type ModeId = 'live' | 'research' | 'replay';

interface LocalizedText {
  en: string;
  ko: string;
  ja: string;
}

interface LandingMode {
  id: ModeId;
  short: LocalizedText;
  label: LocalizedText;
  badge: LocalizedText;
  tone: 'positive' | 'warning' | 'critical';
  status: string;
  color: string;
  fillTop: string;
  traceTag: LocalizedText;
  traceSubTag: LocalizedText;
  routeTitle: LocalizedText;
  wallTitle: LocalizedText;
  floatA: string;
  floatB: string;
  floatC: string;
  metrics: Array<{ label: LocalizedText; value: string; note: LocalizedText }>;
  steps: Array<{ index: string; title: LocalizedText; note: LocalizedText }>;
  wallCards: Array<{ kicker: LocalizedText; title: LocalizedText; note: LocalizedText }>;
  tracePath: string;
  areaPath: string;
  tracePoints: Array<{ x: number; y: number }>;
}

const props = withDefaults(defineProps<{ locale?: LocaleCode }>(), {
  locale: 'en',
});

const locale = computed<LocaleCode>(() => props.locale);
const activeModeId = ref<ModeId>('live');
let rotateTimer: ReturnType<typeof setInterval> | null = null;

const copyMap: Record<LocaleCode, {
  kicker: string;
  title: string;
  lead: string;
  ticker: string[];
  routeLabel: string;
  commandLabel: string;
  traceLabel: string;
  traceSubLabel: string;
  floatA: string;
  floatB: string;
  floatC: string;
}> = {
  en: {
    kicker: 'Product landing',
    title: 'A signal workspace that looks and behaves like an operations system, not a docs site',
    lead: 'Live map context, research surfaces, and replay-backed decisions sit inside one visual system. The landing surface now demonstrates the product loop instead of listing pages.',
    ticker: ['Live workspace', 'Research desk', 'Replay studio', 'Ontology graph', 'Automation ops', 'Scenario workbench'],
    routeLabel: 'Operating route',
    commandLabel: 'Command wall',
    traceLabel: 'Signal trace',
    traceSubLabel: 'Operator frame',
    floatA: 'Surface',
    floatB: 'Best route',
    floatC: 'Posture',
  },
  ko: {
    kicker: '제품 랜딩',
    title: '문서 사이트가 아니라 실제 운영 시스템처럼 보이고 움직이는 신호 워크스페이스',
    lead: '라이브 지도 맥락, 리서치 표면, 리플레이 기반 의사결정을 하나의 시각 체계로 묶었습니다. 이제 홈은 페이지 목록이 아니라 제품 루프를 보여줍니다.',
    ticker: ['라이브 워크스페이스', '리서치 데스크', '리플레이 스튜디오', '온톨로지 그래프', '자동화 운영', '시나리오 워크벤치'],
    routeLabel: '운영 경로',
    commandLabel: '커맨드 월',
    traceLabel: '신호 트레이스',
    traceSubLabel: '운영 프레임',
    floatA: '표면',
    floatB: '추천 경로',
    floatC: '자세',
  },
  ja: {
    kicker: 'Product landing',
    title: 'Docs site ではなく、実際の運用システムのように見えて動く signal workspace',
    lead: 'ライブ地図、研究サーフェス、リプレイ起点の判断をひとつの視覚言語で束ね、ホームで製品ループを直接見せます。',
    ticker: ['Live workspace', 'Research desk', 'Replay studio', 'Ontology graph', 'Automation ops', 'Scenario workbench'],
    routeLabel: 'Operating route',
    commandLabel: 'Command wall',
    traceLabel: 'Signal trace',
    traceSubLabel: 'Operator frame',
    floatA: 'Surface',
    floatB: 'Best route',
    floatC: 'Posture',
  },
};

const copy = computed(() => copyMap[locale.value]);

const modes: LandingMode[] = [
  {
    id: 'live',
    short: { en: 'Map-first', ko: '맵 우선', ja: 'Map-first' },
    label: { en: 'Live Workspace', ko: '라이브 워크스페이스', ja: 'Live Workspace' },
    badge: { en: 'Live posture', ko: '실시간 자세', ja: 'Live posture' },
    tone: 'critical',
    status: 'Routing alerts through live context',
    color: 'rgba(116, 212, 255, 0.98)',
    fillTop: 'rgba(116, 212, 255, 0.28)',
    traceTag: { en: 'Cross-asset spillover', ko: '교차 자산 파급', ja: 'Cross-asset spillover' },
    traceSubTag: { en: 'Map -> route -> desk', ko: '지도 -> 경로 -> 데스크', ja: 'Map -> route -> desk' },
    routeTitle: { en: 'See the map before the summary', ko: '요약보다 지도를 먼저 본다', ja: 'See the map before the summary' },
    wallTitle: { en: 'Live operating picture', ko: '실시간 운영 그림', ja: 'Live operating picture' },
    floatA: 'Live Workspace',
    floatB: 'Map -> Briefing',
    floatC: 'Priority routing',
    metrics: [
      {
        label: { en: 'Map surfaces', ko: '지도 표면', ja: 'Map surfaces' },
        value: '3',
        note: { en: '3D globe, flat map, operational overlays', ko: '3D 지구본, 평면 지도, 운영 오버레이', ja: '3D globe, flat map, operational overlays' },
      },
      {
        label: { en: 'Signal lanes', ko: '신호 레인', ja: 'Signal lanes' },
        value: '11',
        note: { en: 'Chokepoints, routes, outages, military, macro spillover', ko: '초크포인트, 경로, 장애, 군사, 거시 파급', ja: 'Chokepoints, routes, outages, military, macro spillover' },
      },
      {
        label: { en: 'Operator loop', ko: '운영 루프', ja: 'Operator loop' },
        value: 'Map -> Desk',
        note: { en: 'Geography drives context before synthesis', ko: '지리가 합성보다 먼저 맥락을 만든다', ja: 'Geography drives context before synthesis' },
      },
    ],
    steps: [
      { index: '01', title: { en: 'Detect theater stress', ko: '전장 스트레스 탐지', ja: 'Detect theater stress' }, note: { en: 'Open the globe and click the corridor before reading the feed.', ko: '피드를 읽기 전에 지구본에서 해당 회랑을 먼저 연다.', ja: 'Open the globe and click the corridor before reading the feed.' } },
      { index: '02', title: { en: 'Follow relation paths', ko: '관계 경로 추적', ja: 'Follow relation paths' }, note: { en: 'Shift from geography to connected assets and chokepoints.', ko: '지리 맥락에서 연결 자산과 초크포인트로 이동한다.', ja: 'Shift from geography to connected assets and chokepoints.' } },
      { index: '03', title: { en: 'Escalate into desk surfaces', ko: '데스크 표면으로 승격', ja: 'Escalate into desk surfaces' }, note: { en: 'Only then open Research or Replay for validation and action.', ko: '그 다음에야 Research나 Replay를 열어 검증과 행동으로 간다.', ja: 'Only then open Research or Replay for validation and action.' } },
    ],
    wallCards: [
      {
        kicker: { en: 'Live map', ko: '라이브 맵', ja: 'Live map' },
        title: { en: 'The geography itself is the first UI primitive', ko: '지리 자체가 첫 번째 UI primitive', ja: 'The geography itself is the first UI primitive' },
        note: { en: 'Route arcs, cable paths, alert rings, and node labels respond as one surface.', ko: '경로 아크, 케이블 경로, 경보 링, 노드 라벨이 하나의 표면으로 반응한다.', ja: 'Route arcs, cable paths, alert rings, and node labels respond as one surface.' },
      },
      {
        kicker: { en: 'Context split', ko: '컨텍스트 분리', ja: 'Context split' },
        title: { en: 'Briefing follows geography, not the other way around', ko: '브리핑은 지리를 따라오고 그 반대가 아니다', ja: 'Briefing follows geography, not the other way around' },
        note: { en: 'This keeps the landing page closer to how the product is actually used.', ko: '이렇게 해야 소개 페이지도 실제 제품 사용 방식에 가까워진다.', ja: 'This keeps the landing page closer to how the product is actually used.' },
      },
    ],
    tracePath: 'M0 166 C42 158 65 126 108 110 C162 90 198 108 242 96 C292 84 330 36 386 42 C438 47 470 112 525 108 C560 106 590 82 620 54',
    areaPath: 'M0 219 L0 166 C42 158 65 126 108 110 C162 90 198 108 242 96 C292 84 330 36 386 42 C438 47 470 112 525 108 C560 106 590 82 620 54 L620 219 Z',
    tracePoints: [{ x: 108, y: 110 }, { x: 242, y: 96 }, { x: 386, y: 42 }, { x: 525, y: 108 }],
  },
  {
    id: 'research',
    short: { en: 'Research', ko: '리서치', ja: 'Research' },
    label: { en: 'Research Desk', ko: '리서치 데스크', ja: 'Research Desk' },
    badge: { en: 'Synthesis stack', ko: '합성 스택', ja: 'Synthesis stack' },
    tone: 'warning',
    status: 'Running evidence shaping and source governance',
    color: 'rgba(255, 188, 86, 0.98)',
    fillTop: 'rgba(255, 188, 86, 0.26)',
    traceTag: { en: 'Signal -> score -> graph', ko: '신호 -> 점수 -> 그래프', ja: 'Signal -> score -> graph' },
    traceSubTag: { en: 'Research Desk', ko: '리서치 데스크', ja: 'Research Desk' },
    routeTitle: { en: 'Turn raw feeds into governable evidence', ko: '원시 피드를 통제 가능한 증거로 바꾼다', ja: 'Turn raw feeds into governable evidence' },
    wallTitle: { en: 'Research and governance wall', ko: '리서치 및 거버넌스 월', ja: 'Research and governance wall' },
    floatA: 'Research Desk',
    floatB: 'Source -> score',
    floatC: 'Governance on',
    metrics: [
      {
        label: { en: 'Graph surfaces', ko: '그래프 표면', ja: 'Graph surfaces' },
        value: 'Ontology',
        note: { en: 'Narratives, relations, and source dependence stay visible.', ko: '내러티브, 관계, 소스 종속성이 계속 보인다.', ja: 'Narratives, relations, and source dependence stay visible.' },
      },
      {
        label: { en: 'Automation layer', ko: '자동화 레이어', ja: 'Automation layer' },
        value: 'Ops ready',
        note: { en: 'Theme discovery, dataset health, and blocked routes show up directly.', ko: '테마 발견, 데이터셋 상태, 막힌 경로가 바로 드러난다.', ja: 'Theme discovery, dataset health, and blocked routes show up directly.' },
      },
      {
        label: { en: 'Reasoning frame', ko: '추론 프레임', ja: 'Reasoning frame' },
        value: 'Evidence first',
        note: { en: 'The site should show that this is a governed reasoning stack, not a toy dashboard.', ko: '이 사이트가 장난감 대시보드가 아니라 통제된 추론 스택임을 보여줘야 한다.', ja: 'The site should show that this is a governed reasoning stack, not a toy dashboard.' },
      },
    ],
    steps: [
      { index: '01', title: { en: 'Shape evidence', ko: '증거 구조화', ja: 'Shape evidence' }, note: { en: 'Convert streams into candidates, graphs, and scored source posture.', ko: '스트림을 후보, 그래프, 점수화된 소스 자세로 변환한다.', ja: 'Convert streams into candidates, graphs, and scored source posture.' } },
      { index: '02', title: { en: 'Expose uncertainty', ko: '불확실성 노출', ja: 'Expose uncertainty' }, note: { en: 'Show disagreement, dependency, and operator-facing caution in the same frame.', ko: '불일치, 종속성, 운영자 주의점을 같은 프레임에서 보여준다.', ja: 'Show disagreement, dependency, and operator-facing caution in the same frame.' } },
      { index: '03', title: { en: 'Open replay only after evidence is coherent', ko: '증거가 정합적일 때만 리플레이로 이동', ja: 'Open replay only after evidence is coherent' }, note: { en: 'Landing copy should reflect the actual product discipline.', ko: '랜딩도 실제 제품 규율을 반영해야 한다.', ja: 'Landing copy should reflect the actual product discipline.' } },
    ],
    wallCards: [
      {
        kicker: { en: 'Source ops', ko: '소스 운영', ja: 'Source ops' },
        title: { en: 'Dependency, novelty, and corroboration are visible by design', ko: '종속성, 새로움, corroboration이 설계상 보인다', ja: 'Dependency, novelty, and corroboration are visible by design' },
        note: { en: 'The landing page can signal that this is an operator tool with real guardrails.', ko: '소개 페이지 자체가 이 도구가 실제 가드레일을 가진 운영 도구임을 보여줄 수 있다.', ja: 'The landing page can signal that this is an operator tool with real guardrails.' },
      },
      {
        kicker: { en: 'Narrative graph', ko: '내러티브 그래프', ja: 'Narrative graph' },
        title: { en: 'Themes are treated as living structures, not just tags', ko: '테마를 단순 태그가 아니라 살아 있는 구조로 다룬다', ja: 'Themes are treated as living structures, not just tags' },
        note: { en: 'This is where the docs should feel more ambitious than a generic markdown site.', ko: '문서 사이트도 여기서는 일반 markdown 사이트보다 더 야심차게 보여야 한다.', ja: 'This is where the docs should feel more ambitious than a generic markdown site.' },
      },
    ],
    tracePath: 'M0 170 C38 154 88 142 126 116 C172 84 212 94 262 88 C316 82 358 126 404 108 C452 90 480 50 528 46 C570 42 594 52 620 76',
    areaPath: 'M0 219 L0 170 C38 154 88 142 126 116 C172 84 212 94 262 88 C316 82 358 126 404 108 C452 90 480 50 528 46 C570 42 594 52 620 76 L620 219 Z',
    tracePoints: [{ x: 126, y: 116 }, { x: 262, y: 88 }, { x: 404, y: 108 }, { x: 528, y: 46 }],
  },
  {
    id: 'replay',
    short: { en: 'Replay', ko: '리플레이', ja: 'Replay' },
    label: { en: 'Replay Studio', ko: '리플레이 스튜디오', ja: 'Replay Studio' },
    badge: { en: 'Validation loop', ko: '검증 루프', ja: 'Validation loop' },
    tone: 'positive',
    status: 'Comparing scenarios and backtest routes',
    color: 'rgba(135, 255, 190, 0.98)',
    fillTop: 'rgba(135, 255, 190, 0.24)',
    traceTag: { en: 'Scenario -> replay -> allocator', ko: '시나리오 -> 리플레이 -> 할당기', ja: 'Scenario -> replay -> allocator' },
    traceSubTag: { en: 'Replay Studio', ko: '리플레이 스튜디오', ja: 'Replay Studio' },
    routeTitle: { en: 'Show the validation loop on the landing page itself', ko: '검증 루프 자체를 랜딩에서 보여준다', ja: 'Show the validation loop on the landing page itself' },
    wallTitle: { en: 'Replay and scenario wall', ko: '리플레이 및 시나리오 월', ja: 'Replay and scenario wall' },
    floatA: 'Replay Studio',
    floatB: 'Scenario compare',
    floatC: 'Drift visible',
    metrics: [
      {
        label: { en: 'Backtest posture', ko: '백테스트 자세', ja: 'Backtest posture' },
        value: 'Live-linked',
        note: { en: 'Scenario, replay, and data lifecycle stay on the same surface.', ko: '시나리오, 리플레이, 데이터 라이프사이클이 같은 표면에 붙어 있다.', ja: 'Scenario, replay, and data lifecycle stay on the same surface.' },
      },
      {
        label: { en: 'Decision output', ko: '의사결정 출력', ja: 'Decision output' },
        value: 'Operator readable',
        note: { en: 'Curves, posture, and routes are understandable without opening the app.', ko: '앱을 열지 않아도 곡선, 자세, 경로를 읽을 수 있다.', ja: 'Curves, posture, and routes are understandable without opening the app.' },
      },
      {
        label: { en: 'Storage story', ko: '저장 계층', ja: 'Storage story' },
        value: 'Hot / Warm / Cold',
        note: { en: 'The docs can explain state, storage, and replay together instead of splitting them.', ko: '문서가 상태, 저장, 리플레이를 따로 떼지 않고 함께 설명할 수 있다.', ja: 'The docs can explain state, storage, and replay together instead of splitting them.' },
      },
    ],
    steps: [
      { index: '01', title: { en: 'Load historical frame sets', ko: '과거 프레임셋 로드', ja: 'Load historical frame sets' }, note: { en: 'Replay starts from stored state, not from hand-wavy screenshots.', ko: '리플레이는 막연한 스크린샷이 아니라 저장된 상태에서 출발한다.', ja: 'Replay starts from stored state, not from hand-wavy screenshots.' } },
      { index: '02', title: { en: 'Compare posture and drift', ko: '자세와 드리프트 비교', ja: 'Compare posture and drift' }, note: { en: 'Show how current context diverges from replay expectations.', ko: '현재 맥락이 과거 리플레이 기대치와 어떻게 갈라지는지 보여준다.', ja: 'Show how current context diverges from replay expectations.' } },
      { index: '03', title: { en: 'Route into scenario workbench', ko: '시나리오 워크벤치로 연결', ja: 'Route into scenario workbench' }, note: { en: 'The landing page should already preview the interaction quality of the product.', ko: '랜딩 페이지 자체가 제품 상호작용 품질을 먼저 보여줘야 한다.', ja: 'The landing page should already preview the interaction quality of the product.' } },
    ],
    wallCards: [
      {
        kicker: { en: 'Scenario console', ko: '시나리오 콘솔', ja: 'Scenario console' },
        title: { en: 'Visitors should feel the replay loop, not just read about it', ko: '방문자가 리플레이 루프를 읽는 게 아니라 느껴야 한다', ja: 'Visitors should feel the replay loop, not just read about it' },
        note: { en: 'Landing needs visible consequence, not only explanation.', ko: '랜딩은 설명뿐 아니라 눈에 보이는 결과를 줘야 한다.', ja: 'Landing needs visible consequence, not only explanation.' },
      },
      {
        kicker: { en: 'Portfolio path', ko: '포트폴리오 경로', ja: 'Portfolio path' },
        title: { en: 'Validation, allocator, and storage should appear as one chain', ko: '검증, 할당기, 저장을 하나의 체인처럼 보여준다', ja: 'Validation, allocator, and storage should appear as one chain' },
        note: { en: 'This makes the site feel closer to a product console than a static brochure.', ko: '이렇게 해야 사이트가 정적 브로셔보다 제품 콘솔처럼 느껴진다.', ja: 'This makes the site feel closer to a product console than a static brochure.' },
      },
    ],
    tracePath: 'M0 176 C46 156 84 158 132 128 C186 94 220 48 278 56 C334 64 372 138 428 126 C478 114 510 60 566 58 C590 57 606 58 620 62',
    areaPath: 'M0 219 L0 176 C46 156 84 158 132 128 C186 94 220 48 278 56 C334 64 372 138 428 126 C478 114 510 60 566 58 C590 57 606 58 620 62 L620 219 Z',
    tracePoints: [{ x: 132, y: 128 }, { x: 278, y: 56 }, { x: 428, y: 126 }, { x: 566, y: 58 }],
  },
];

const activeMode = computed(() => modes.find((mode) => mode.id === activeModeId.value) || modes[0]);

const landingStyle = computed(() => ({
  '--lc-landing-accent': activeMode.value.color,
  '--lc-landing-fill': activeMode.value.fillTop,
}));

function selectMode(modeId: ModeId): void {
  activeModeId.value = modeId;
}

onMounted(() => {
  const sequence: ModeId[] = ['live', 'research', 'replay'];
  let index = 0;
  rotateTimer = setInterval(() => {
    index = (index + 1) % sequence.length;
    activeModeId.value = sequence[index]!;
  }, 5200);
});

onBeforeUnmount(() => {
  if (rotateTimer) clearInterval(rotateTimer);
});
</script>
