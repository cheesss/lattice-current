<template>
  <section class="lc-section lc-ops-demo">
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

    <div class="lc-ops-toolbar">
      <div class="lc-ops-modebar">
        <button
          v-for="mode in copy.modes"
          :key="mode.id"
          class="lc-ops-mode"
          :class="{ 'is-active': activeMode === mode.id }"
          type="button"
          @click="activeMode = mode.id"
        >
          <strong>{{ mode.title }}</strong>
          <span>{{ mode.summary }}</span>
        </button>
      </div>
      <div class="lc-hotspot-strip">
        <button
          v-for="spot in hotspots"
          :key="spot.id"
          class="lc-hotspot-pill"
          :class="{ 'is-active': spot.id === selectedHotspotId }"
          type="button"
          @click="selectedHotspotId = spot.id"
        >
          <span>{{ spot.label }}</span>
          <strong>{{ spot.risk }}</strong>
        </button>
      </div>
    </div>

    <div v-if="activeMode === 'map'" class="lc-ops-grid">
      <div class="lc-ops-panel lc-ops-panel-map">
        <div class="lc-console-header-row">
          <p class="lc-mini-label">{{ copy.layersLabel }}</p>
          <div class="lc-link-row">
            <button
              v-for="layer in layerOptions"
              :key="layer.id"
              class="lc-link-pill lc-link-pill-button"
              :class="{ 'is-active': activeLayers.includes(layer.id) }"
              type="button"
              @click="toggleLayer(layer.id)"
            >
              {{ layer.label }}
            </button>
          </div>
        </div>

        <div class="lc-map-frame">
          <svg class="lc-map-base" viewBox="0 0 1000 540" aria-hidden="true">
            <rect width="1000" height="540" rx="28" class="lc-map-ocean" />
            <path class="lc-map-land" d="M58 122c53-33 128-40 197-29 57 10 98 43 110 84 12 40-6 98-49 120-44 22-111 10-162 12-42 1-83 8-113-11-41-26-68-76-56-113 6-18 14-41 73-63z" />
            <path class="lc-map-land" d="M266 290c36-19 83-12 108 16 19 20 29 55 23 92-6 35-28 74-57 93-31 22-62 10-78-26-21-49-25-147 4-175z" />
            <path class="lc-map-land" d="M432 92c49-21 121-23 170-8 34 12 57 35 51 56-8 27-53 35-88 36-41 1-73 8-108 3-37-5-69-26-68-46 2-18 18-29 43-41z" />
            <path class="lc-map-land" d="M520 154c54-31 140-34 217-18 58 11 105 39 145 77 31 30 75 42 95 71 25 34 18 76-17 100-43 30-116 29-169 22-60-7-114 12-166 14-70 2-122-22-128-68-5-35 6-69 0-105-5-35-20-67 23-93z" />
            <path class="lc-map-land" d="M800 305c42-10 100 2 126 27 20 18 24 50 8 73-18 27-60 35-97 26-30-8-57-28-62-52-6-26 3-62 25-74z" />
          </svg>

          <svg class="lc-map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line
              v-for="connection in activeHotspot.connections"
              :key="connection.id"
              :x1="activeHotspot.x"
              :y1="activeHotspot.y"
              :x2="connection.x"
              :y2="connection.y"
              class="lc-map-arc"
              :style="{ opacity: String(0.2 + connection.strength / 130) }"
            />
            <circle
              v-for="connection in activeHotspot.connections"
              :key="`${connection.id}-point`"
              :cx="connection.x"
              :cy="connection.y"
              r="1.4"
              class="lc-map-connection-node"
            />
          </svg>

          <button
            v-for="spot in visibleHotspots"
            :key="spot.id"
            class="lc-map-marker"
            :class="{ 'is-active': spot.id === selectedHotspotId }"
            :style="{ left: `${spot.x}%`, top: `${spot.y}%` }"
            type="button"
            @click="selectedHotspotId = spot.id"
          >
            <span class="lc-map-marker-dot"></span>
            <span class="lc-map-marker-label">{{ spot.label }}</span>
          </button>
        </div>

        <div class="lc-map-caption-row">
          <div class="lc-map-caption">
            <span>{{ copy.mapCaption }}</span>
            <strong>{{ activeHotspot.path }}</strong>
          </div>
          <div class="lc-map-caption">
            <span>{{ copy.windowLabel }}</span>
            <strong>{{ activeHotspot.window }}</strong>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.regionLabel }}</p>
            <h3>{{ activeHotspot.label }}</h3>
            <p>{{ activeHotspot.summary }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeHotspot.tone">{{ activeHotspot.risk }}</span>
        </div>

        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.theaterLabel }}</span>
            <strong>{{ activeHotspot.theater }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.exposureLabel }}</span>
            <strong>{{ activeHotspot.exposure }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.signalLabel }}</span>
            <strong>{{ activeHotspot.signalMix }}</strong>
          </div>
        </div>

        <div class="lc-ops-subgrid">
          <div class="lc-ops-subcard">
            <p class="lc-mini-label">{{ copy.relationsLabel }}</p>
            <div class="lc-relation-list">
              <div v-for="relation in activeHotspot.relations" :key="relation.pair" class="lc-relation-item">
                <div class="lc-relation-head">
                  <strong>{{ relation.pair }}</strong>
                  <span>{{ relation.score }}</span>
                </div>
                <div class="lc-relation-bar"><span :style="{ width: `${relation.score}%` }"></span></div>
                <p>{{ relation.note }}</p>
              </div>
            </div>
          </div>

          <div class="lc-ops-subcard">
            <p class="lc-mini-label">{{ copy.guidanceLabel }}</p>
            <ul class="lc-topology-list">
              <li v-for="line in activeHotspot.guidance" :key="line">{{ line }}</li>
            </ul>

            <p class="lc-mini-label lc-mini-label-tight">{{ copy.eventsLabel }}</p>
            <div class="lc-feed-list">
              <div v-for="event in activeHotspot.events" :key="event" class="lc-static-card">{{ event }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activeMode === 'hubs'" class="lc-ops-grid">
      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.hubsLabel }}</p>
        <div class="lc-feed-list">
          <button
            v-for="hub in hubTabs"
            :key="hub.id"
            class="lc-feed-card"
            :class="{ 'is-active': activeHub === hub.id }"
            type="button"
            @click="activeHub = hub.id"
          >
            <span class="lc-feed-card-tier">{{ hub.tag }}</span>
            <strong>{{ hub.title }}</strong>
            <p>{{ hub.summary }}</p>
          </button>
        </div>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.hubDetailLabel }}</p>
            <h3>{{ hubView.title }}</h3>
            <p>{{ hubView.summary }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeHotspot.tone">{{ activeHotspot.label }}</span>
        </div>

        <div v-if="hubView.metrics" class="lc-metric-row">
          <div v-for="metric in hubView.metrics" :key="metric.label" class="lc-metric-card">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        </div>

        <div v-if="hubView.nodes" class="lc-chip-row">
          <span v-for="node in hubView.nodes" :key="node" class="lc-chip lc-chip-strong">{{ node }}</span>
        </div>

        <div v-if="hubView.lines" class="lc-feed-list">
          <div v-for="line in hubView.lines" :key="line" class="lc-static-card">{{ line }}</div>
        </div>

        <div v-if="hubView.cards" class="lc-feed-list">
          <div v-for="card in hubView.cards" :key="card.title" class="lc-static-card">
            <strong>{{ card.title }}</strong>
            <p>{{ card.note }}</p>
          </div>
        </div>

        <div v-if="hubView.ops" class="lc-relation-list">
          <div v-for="op in hubView.ops" :key="op.label" class="lc-relation-item">
            <div class="lc-relation-head">
              <strong>{{ op.label }}</strong>
              <span>{{ op.value }}</span>
            </div>
            <div class="lc-relation-bar"><span :style="{ width: `${op.width}%` }"></span></div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activeMode === 'replay'" class="lc-ops-grid">
      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.replayLabel }}</p>
        <div class="lc-feed-list">
          <button
            v-for="step in activeHotspot.replay"
            :key="step.id"
            class="lc-feed-card"
            :class="{ 'is-active': activeReplayId === step.id }"
            type="button"
            @click="activeReplayId = step.id"
          >
            <span class="lc-feed-card-tier">{{ step.when }}</span>
            <strong>{{ step.title }}</strong>
            <p>{{ step.summary }}</p>
          </button>
        </div>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.replayDetailLabel }}</p>
            <h3>{{ replayStep.title }}</h3>
            <p>{{ replayStep.summary }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeHotspot.tone">{{ replayStep.when }}</span>
        </div>

        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.bestDecisionLabel }}</span>
            <strong>{{ replayStep.decision }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.realizedLabel }}</span>
            <strong>{{ replayStep.return }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.hitRateLabel }}</span>
            <strong>{{ replayStep.hitRate }}</strong>
          </div>
        </div>

        <div class="lc-replay-track">
          <div
            v-for="step in activeHotspot.replay"
            :key="`${step.id}-bar`"
            class="lc-replay-track-item"
            :class="{ 'is-active': step.id === activeReplayId }"
          >
            <span>{{ step.title }}</span>
            <strong>{{ step.return }}</strong>
          </div>
        </div>

        <ul class="lc-topology-list">
          <li v-for="note in replayStep.notes" :key="note">{{ note }}</li>
        </ul>
      </div>
    </div>

    <div v-else class="lc-ops-grid">
      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.scenarioLabel }}</p>
        <label class="lc-slider-group">
          <span>{{ copy.oilLabel }} <strong>{{ oilDelta }}%</strong></span>
          <input v-model="oilDelta" type="range" min="-10" max="25" step="1" />
        </label>
        <label class="lc-slider-group">
          <span>{{ copy.vixLabel }} <strong>{{ vixLevel }}</strong></span>
          <input v-model="vixLevel" type="range" min="12" max="45" step="1" />
        </label>
        <label class="lc-slider-group">
          <span>{{ copy.shippingLabel }} <strong>{{ shippingStress }}</strong></span>
          <input v-model="shippingStress" type="range" min="0" max="100" step="5" />
        </label>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.scenarioOutputLabel }}</p>
            <h3>{{ scenarioRegime }}</h3>
            <p>{{ copy.scenarioLead }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="scenarioRisk >= 78 ? 'critical' : scenarioRisk >= 62 ? 'elevated' : 'watch'">{{ scenarioRisk }}</span>
        </div>

        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.riskScoreLabel }}</span>
            <strong>{{ scenarioRisk }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.postureLabel }}</span>
            <strong>{{ scenarioPosture }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.mapCaption }}</span>
            <strong>{{ activeHotspot.path }}</strong>
          </div>
        </div>

        <div class="lc-relation-list">
          <div class="lc-relation-item">
            <div class="lc-relation-head"><strong>{{ copy.oilLabel }}</strong><span>{{ oilDelta }}%</span></div>
            <div class="lc-relation-bar"><span :style="{ width: `${Math.max(10, ((oilDelta + 10) / 35) * 100)}%` }"></span></div>
          </div>
          <div class="lc-relation-item">
            <div class="lc-relation-head"><strong>{{ copy.vixLabel }}</strong><span>{{ vixLevel }}</span></div>
            <div class="lc-relation-bar"><span :style="{ width: `${((vixLevel - 12) / 33) * 100}%` }"></span></div>
          </div>
          <div class="lc-relation-item">
            <div class="lc-relation-head"><strong>{{ copy.shippingLabel }}</strong><span>{{ shippingStress }}</span></div>
            <div class="lc-relation-bar"><span :style="{ width: `${shippingStress}%` }"></span></div>
          </div>
        </div>

        <div class="lc-feed-list">
          <div v-for="action in scenarioActions" :key="action.title" class="lc-static-card">
            <strong>{{ action.title }}</strong>
            <p>{{ action.note }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type ModeId = 'map' | 'hubs' | 'replay' | 'scenario';
type HubId = 'analysis' | 'codex' | 'ontology' | 'backtest' | 'resources';

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

const copyMap = {
  en: {
    kicker: 'Interactive operations console',
    title: 'Use a realistic 2D mission view instead of reading static product copy',
    lead: 'Click a theater, switch hubs, inspect a replay chain, and push scenario sliders. This is still safe mock data, but the interaction model now mirrors the actual product much more closely.',
    badges: ['Map drilldown', 'Hub switching', 'Replay review', 'Scenario controls'],
    modes: [
      { id: 'map', title: 'Map', summary: 'Open a 2D theater view with layers, hotspots, and country relations.' },
      { id: 'hubs', title: 'Hubs', summary: 'Move across Analysis, Codex, Ontology, Backtest, and Resource views.' },
      { id: 'replay', title: 'Replay', summary: 'Step through mock point-in-time decisions and outcomes.' },
      { id: 'scenario', title: 'Scenario', summary: 'Stress a region with macro sliders and watch posture change.' }
    ],
    layersLabel: 'Visible layers', regionLabel: 'Selected region', theaterLabel: 'Theater', exposureLabel: 'Primary exposure', signalLabel: 'Signal mix',
    mapCaption: 'Operator path', windowLabel: 'Decision window', relationsLabel: 'Country relations', guidanceLabel: 'Regional guidance', eventsLabel: 'Recent mock events',
    hubsLabel: 'Internal hubs', hubDetailLabel: 'Selected hub view', replayLabel: 'Replay timeline', replayDetailLabel: 'Replay decision', bestDecisionLabel: 'Best decision', realizedLabel: 'Realized return', hitRateLabel: 'Hit rate',
    scenarioLabel: 'Macro stress inputs', scenarioOutputLabel: 'Scenario output', scenarioLead: 'The posture panel updates the way an analyst would re-rank the same region under higher stress.', oilLabel: 'Oil shock', vixLabel: 'VIX', shippingLabel: 'Shipping stress', riskScoreLabel: 'Risk score', postureLabel: 'Suggested posture',
    analysisTag: 'Explain', codexTag: 'Plan', ontologyTag: 'Graph', backtestTag: 'Replay', resourcesTag: 'Ops'
  },
  ko: {
    kicker: '인터랙티브 오퍼레이션 콘솔',
    title: '정적인 설명 대신 실제 제품처럼 2D 지도와 허브를 눌러가며 살펴볼 수 있습니다',
    lead: '지역을 클릭하고, 허브를 전환하고, 리플레이 흐름을 열고, 시나리오 슬라이더를 움직여 보세요. 가상 데이터이지만 상호작용 구조는 실제 제품 흐름에 훨씬 가깝습니다.',
    badges: ['지도 드릴다운', '허브 전환', '리플레이 검토', '시나리오 제어'],
    modes: [
      { id: 'map', title: '지도', summary: '2D 지도에서 레이어, 핫스팟, 국가 관계를 봅니다.' },
      { id: 'hubs', title: '허브', summary: 'Analysis, Codex, Ontology, Backtest, Resource 뷰를 전환합니다.' },
      { id: 'replay', title: '리플레이', summary: '과거 의사결정과 결과를 단계별로 봅니다.' },
      { id: 'scenario', title: '시나리오', summary: '매크로 슬라이더로 지역 스트레스를 바꿉니다.' }
    ],
    layersLabel: '표시 레이어', regionLabel: '선택 지역', theaterLabel: '전장', exposureLabel: '주요 노출', signalLabel: '신호 구성',
    mapCaption: '운영 경로', windowLabel: '판단 윈도우', relationsLabel: '국가 관계도', guidanceLabel: '지역 안내', eventsLabel: '최근 가상 이벤트',
    hubsLabel: '내부 허브', hubDetailLabel: '선택 허브 상세', replayLabel: '리플레이 타임라인', replayDetailLabel: '리플레이 판단', bestDecisionLabel: '최적 결정', realizedLabel: '실현 수익률', hitRateLabel: '적중률',
    scenarioLabel: '매크로 스트레스 입력', scenarioOutputLabel: '시나리오 출력', scenarioLead: '같은 지역도 스트레스가 올라가면 분석 우선순위와 태세가 어떻게 달라지는지 보여줍니다.', oilLabel: '유가 충격', vixLabel: 'VIX', shippingLabel: '해운 스트레스', riskScoreLabel: '리스크 점수', postureLabel: '권장 태세',
    analysisTag: '설명', codexTag: '계획', ontologyTag: '그래프', backtestTag: '리플레이', resourcesTag: '운영'
  },
  ja: {
    kicker: 'Interactive operations console',
    title: 'Static text を読む代わりに 2D map と hubs を触れます',
    lead: '地域を選び、hub を切り替え、replay を追い、scenario slider を動かせます。mock data ですが操作感は実製品に近づけています。',
    badges: ['Map drilldown', 'Hub switching', 'Replay review', 'Scenario controls'],
    modes: [
      { id: 'map', title: 'Map', summary: '2D map で layers, hotspots, relations を見ます。' },
      { id: 'hubs', title: 'Hubs', summary: 'Analysis, Codex, Ontology, Backtest, Resource を切り替えます。' },
      { id: 'replay', title: 'Replay', summary: '過去の判断と結果を段階で見ます。' },
      { id: 'scenario', title: 'Scenario', summary: 'macro slider で stress を変えます。' }
    ],
    layersLabel: 'Visible layers', regionLabel: 'Selected region', theaterLabel: 'Theater', exposureLabel: 'Primary exposure', signalLabel: 'Signal mix',
    mapCaption: 'Operator path', windowLabel: 'Decision window', relationsLabel: 'Country relations', guidanceLabel: 'Regional guidance', eventsLabel: 'Recent mock events',
    hubsLabel: 'Internal hubs', hubDetailLabel: 'Selected hub view', replayLabel: 'Replay timeline', replayDetailLabel: 'Replay decision', bestDecisionLabel: 'Best decision', realizedLabel: 'Realized return', hitRateLabel: 'Hit rate',
    scenarioLabel: 'Macro stress inputs', scenarioOutputLabel: 'Scenario output', scenarioLead: 'The posture panel shows how the same region would be re-ranked under higher stress.', oilLabel: 'Oil shock', vixLabel: 'VIX', shippingLabel: 'Shipping stress', riskScoreLabel: 'Risk score', postureLabel: 'Suggested posture',
    analysisTag: 'Explain', codexTag: 'Plan', ontologyTag: 'Graph', backtestTag: 'Replay', resourcesTag: 'Ops'
  }
} as const;

const layerOptions = [
  { id: 'conflict', label: 'Conflict' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'cyber', label: 'Cyber' },
  { id: 'markets', label: 'Markets' },
  { id: 'infrastructure', label: 'Infrastructure' }
];

const hotspots = [
  {
    id: 'hormuz', label: 'Hormuz', theater: 'Middle East', risk: 'Critical', tone: 'critical', x: 69, y: 48,
    path: 'Energy -> shipping -> inflation', exposure: 'Oil / shipping / airlines', signalMix: 'News 42 · AIS 7 · Rates 5', window: '24-72h',
    summary: 'Shipping, insurance, and energy channels are converging around a chokepoint narrative. This mock region behaves like a live command view with route stress and country-pair tension.',
    layers: ['conflict', 'shipping', 'markets', 'infrastructure'],
    connections: [
      { id: 'saudi', x: 63, y: 47, label: 'Saudi Arabia', strength: 82 },
      { id: 'india', x: 78, y: 56, label: 'India', strength: 71 },
      { id: 'europe', x: 52, y: 34, label: 'Europe', strength: 58 }
    ],
    relations: [
      { pair: 'Iran -> US', score: 88, note: 'Military and shipping channels are tightly coupled.' },
      { pair: 'Iran -> Saudi Arabia', score: 67, note: 'Energy market signaling dominates direct cross-border risk.' },
      { pair: 'Iran -> India', score: 54, note: 'Import exposure rises faster than direct security exposure.' }
    ],
    guidance: [
      'Watch oil-linked ETFs and airline pressure paths before chasing broad risk-off.',
      'Use shipping and insurance chatter as confirmation, not first trigger.',
      'Operator review should separate physical closure risk from narrative escalation.'
    ],
    events: [
      'Clustered strike chatter lifts marine insurance quotes.',
      'Carrier rerouting headlines push freight and bunker sensitivity.',
      'Gulf infrastructure mentions widen inflation-shock posture.'
    ],
    analysis: {
      title: 'Analysis Hub: chokepoint view',
      summary: 'The analysis surface compresses live headlines, source confidence, country exposure, and event transmission into one regional brief.',
      metrics: [
        { label: 'Source credibility', value: '81/100' },
        { label: 'Transmission depth', value: '3 hops' },
        { label: 'Regime posture', value: 'Inflation shock' }
      ],
      lines: [
        'Energy and shipping are reinforcing each other faster than broad equity fear.',
        'Airline and petrochemical exposure should be treated as second-wave effects.',
        'The summary stays evidence-first: no escalation call without route or asset confirmation.'
      ]
    },
    codex: {
      title: 'Codex Hub: operator checklist',
      summary: 'A pragmatic decision path turns a noisy cluster into a controlled response plan.',
      lines: [
        'Check source diversity before promotion to alert tier.',
        'Open event-to-asset map and compare energy versus airlines sensitivity.',
        'Review replay analog before increasing conviction or size.'
      ]
    },
    ontology: {
      title: 'Ontology Hub: relation state',
      summary: 'The graph view resolves entities and preserves only high-confidence relation grammar.',
      nodes: ['Iran', 'Strait of Hormuz', 'Saudi Arabia', 'Shipping lanes', 'Crude oil'],
      lines: [
        'Conflict edges dominate, but shipping and infrastructure nodes amplify spillover.',
        'Unknown phrase-level noise is suppressed before graph promotion.',
        'Timeslice history lets the operator compare current and prior topology.'
      ]
    },
    backtest: {
      title: 'Backtest Lab: analog book',
      summary: 'Historical cases suggest that shipping + oil convergence matters more than the first missile headline.',
      cards: [
        { title: 'Red Sea reroute cycle', note: 'Best posture was energy long plus airline caution after transport confirmation.' },
        { title: 'Kharg infrastructure scare', note: 'False positives dropped when physical asset mentions were required.' }
      ]
    },
    resources: {
      title: 'Resource Profiler: operational load',
      summary: 'This view shows how much compute the region would consume when replay, graph, and transmission models all run together.',
      ops: [
        { label: 'Collection', value: '18 MB heap delta', width: 44 },
        { label: 'Analytics', value: '420 ms', width: 72 },
        { label: 'Graph build', value: '31 nodes / 24 edges', width: 58 }
      ]
    },
    replay: [
      { id: 'hormuz-a', when: 'T-18h', title: 'Narrative lift only', summary: 'Headline volume rose before route evidence appeared.', decision: 'Watchlist only', return: '+0.4%', hitRate: '41%', notes: ['Low confidence because shipping telemetry had not moved yet.', 'The best decision at this step was restraint, not early long exposure.'] },
      { id: 'hormuz-b', when: 'T-8h', title: 'Shipping confirmation', summary: 'Route shifts and insurance chatter confirmed spillover.', decision: 'Long energy / hedge airlines', return: '+3.8%', hitRate: '68%', notes: ['Transmission depth became reliable once shipping routes changed.', 'Country relations supported cross-asset rather than broad market panic.'] },
      { id: 'hormuz-c', when: 'T+1d', title: 'Inflation shock posture', summary: 'Market started pricing second-wave cost pressure.', decision: 'Trim size, keep energy bias', return: '+2.1%', hitRate: '62%', notes: ['Past this point, conviction rises slower than volatility.', 'The right move is usually to reduce size before narrative saturation.'] }
    ]
  },
  {
    id: 'taiwan', label: 'Taiwan Strait', theater: 'East Asia', risk: 'Elevated', tone: 'elevated', x: 83, y: 37,
    path: 'Semis -> cloud -> logistics', exposure: 'AI compute / semis / freight', signalMix: 'News 26 · Policy 9 · Supply chain 6', window: '2-5d',
    summary: 'Export-control chatter, naval signaling, and supplier concentration create a tech-first regional picture rather than an immediate broad-risk picture.',
    layers: ['conflict', 'cyber', 'markets', 'infrastructure'],
    connections: [
      { id: 'china', x: 79, y: 35, label: 'China', strength: 83 },
      { id: 'japan', x: 87, y: 31, label: 'Japan', strength: 64 },
      { id: 'us', x: 22, y: 28, label: 'US', strength: 78 }
    ],
    relations: [
      { pair: 'China -> Taiwan', score: 92, note: 'Policy, military signaling, and logistics all point to high sensitivity.' },
      { pair: 'US -> Taiwan', score: 81, note: 'Security and semiconductor dependency reinforce each other.' },
      { pair: 'Japan -> Taiwan', score: 57, note: 'Logistics and supplier continuity matter more than direct conflict framing.' }
    ],
    guidance: [
      'Do not treat every geopolitical headline as an immediate broad equity short.',
      'Check supplier and cloud hardware concentration before sector rotation decisions.',
      'Map export-control language separately from physical shipping disruption.'
    ],
    events: [
      'Policy chatter revives AI chip allocation risk.',
      'Naval posture headlines widen supply-chain uncertainty.',
      'Cloud capex dependency becomes the dominant second-order theme.'
    ],
    analysis: {
      title: 'Analysis Hub: compute bottleneck view',
      summary: 'The regional brief pivots from security headlines into semiconductor and cloud dependency fast enough for operator use.',
      metrics: [
        { label: 'Supply-chain density', value: 'High' },
        { label: 'Transmission depth', value: '2 hops' },
        { label: 'False-positive risk', value: 'Moderate' }
      ],
      lines: [
        'Supplier concentration matters more than raw headline count.',
        'The best signals are export-control specificity and dependency overlap.',
        'Market spillover tends to start in semis, then propagate into cloud hardware names.'
      ]
    },
    codex: {
      title: 'Codex Hub: review path',
      summary: 'This region benefits from a review path that separates policy narrative from actual production bottlenecks.',
      lines: [
        'Check whether the event is policy-only, physical-only, or both.',
        'Compare supplier basket stress against cloud capex names.',
        'Use replay analogs before assigning a broad Taiwan-risk thesis.'
      ]
    },
    ontology: {
      title: 'Ontology Hub: technology relations',
      summary: 'The graph emphasizes semiconductors, policy entities, suppliers, and compute demand nodes.',
      nodes: ['Taiwan', 'China', 'Semiconductors', 'Cloud capex', 'Export controls'],
      lines: [
        'Entity resolution matters because supplier aliases distort graph quality quickly.',
        'The ontology view helps separate country-level risk from company-level dependency.'
      ]
    },
    backtest: {
      title: 'Backtest Lab: export-control analogs',
      summary: 'Historical cases favor selective dispersion trades over broad risk-off calls.',
      cards: [
        { title: 'AI chip ban cycle', note: 'Best outcome came from selective supplier underweight, not blanket tech short.' },
        { title: 'Semiconductor shipping delay', note: 'Logistics pressure mattered only after confirmed route or customs friction.' }
      ]
    },
    resources: {
      title: 'Resource Profiler: tech branch',
      summary: 'Tech-heavy regions spend more compute on entity resolution and alias cleanup than on pure conflict graphs.',
      ops: [
        { label: 'Collection', value: '14 MB heap delta', width: 35 },
        { label: 'Analytics', value: '390 ms', width: 64 },
        { label: 'Graph build', value: '44 nodes / 38 edges', width: 78 }
      ]
    },
    replay: [
      { id: 'taiwan-a', when: 'T-12h', title: 'Policy noise build-up', summary: 'The story was still headline-led and not yet dependency-led.', decision: 'Map suppliers only', return: '+0.6%', hitRate: '45%', notes: ['Early stage policy chatter created many false broad calls.', 'Selective supplier mapping outperformed trying to trade the entire region.'] },
      { id: 'taiwan-b', when: 'T-2h', title: 'Dependency confirmation', summary: 'Supplier and cloud hardware links aligned in the graph.', decision: 'Long dispersion / short weakest suppliers', return: '+2.9%', hitRate: '64%', notes: ['Graph resolution improved the operator decision more than raw article volume.', 'This was the first stage where conviction could be raised safely.'] },
      { id: 'taiwan-c', when: 'T+2d', title: 'Narrative saturation', summary: 'Headline count kept rising after the best window had already passed.', decision: 'Reduce risk, keep monitoring', return: '+1.1%', hitRate: '57%', notes: ['The replay teaches that the best decision is not always the loudest one.', 'Posture becomes selective as dispersion narrows.'] }
    ]
  },
  {
    id: 'ukraine', label: 'Ukraine Grid', theater: 'Eastern Europe', risk: 'Watch', tone: 'watch', x: 56, y: 27,
    path: 'Grid -> cyber -> utilities', exposure: 'Utilities / cyber / EU rates', signalMix: 'News 19 · Infra 6 · Cyber 4', window: '12-48h',
    summary: 'Infrastructure and cyber chatter can matter, but broad market spillover often stays shallow unless physical utility stress becomes credible.',
    layers: ['conflict', 'cyber', 'infrastructure'],
    connections: [
      { id: 'poland', x: 52, y: 24, label: 'Poland', strength: 61 },
      { id: 'germany', x: 46, y: 24, label: 'Germany', strength: 49 },
      { id: 'russia', x: 63, y: 25, label: 'Russia', strength: 79 }
    ],
    relations: [
      { pair: 'Russia -> Ukraine', score: 90, note: 'Direct conflict and infrastructure references remain the core driver.' },
      { pair: 'Ukraine -> EU utilities', score: 58, note: 'Utility and power network sensitivity matters more than broad equity risk.' },
      { pair: 'Cyber -> markets', score: 43, note: 'This stays local unless physical outages confirm it.' }
    ],
    guidance: [
      'Treat cyber-only narratives as provisional until utility evidence appears.',
      'Physical grid mentions matter more than generic attack language.',
      'Utility hedges usually dominate broad risk-off moves in this setup.'
    ],
    events: [
      'Grid and substation mentions rise alongside cyber chatter.',
      'Regional utility exposure edges up without full cross-asset contagion.',
      'Backtest analogs favor focused hedges over broad market positioning.'
    ],
    analysis: {
      title: 'Analysis Hub: infrastructure posture',
      summary: 'The operator sees when a cyber-flavored event becomes a real utility risk rather than staying a noisy local narrative.',
      metrics: [
        { label: 'Infra confidence', value: 'Moderate' },
        { label: 'Market spillover', value: 'Shallow' },
        { label: 'Replay match', value: '2 analogs' }
      ],
      lines: [
        'Physical infrastructure references carry more weight than cyber jargon.',
        'The region often requires less capital but more careful false-positive screening.'
      ]
    },
    codex: {
      title: 'Codex Hub: response plan',
      summary: 'The right plan is usually controlled triage, not all-market escalation.',
      lines: [
        'Verify whether the event is power disruption or pure cyber narrative.',
        'Open the resource panel if importer or graph jobs spike during crisis replay.',
        'Keep utility hedge paths visible while broad market posture remains light.'
      ]
    },
    ontology: {
      title: 'Ontology Hub: infrastructure graph',
      summary: 'Utilities, grid assets, cyber indicators, and regional entities remain separated until evidence warrants fusion.',
      nodes: ['Ukraine', 'Grid assets', 'Cyber indicators', 'Utilities', 'Europe'],
      lines: [
        'This reduces graph hallucination when headlines overuse vague cyber language.',
        'The graph helps preserve a narrower risk surface.'
      ]
    },
    backtest: {
      title: 'Backtest Lab: utility analogs',
      summary: 'Historical cases reward focused hedges and punish broad, late panic positioning.',
      cards: [
        { title: 'Regional grid scare', note: 'Utility hedge beat broad risk-off after confirmation arrived.' },
        { title: 'Cyber-only panic', note: 'Most broad moves faded when physical impact did not follow.' }
      ]
    },
    resources: {
      title: 'Resource Profiler: replay weight',
      summary: 'This region spends comparatively less on market transmission and more on graph validation and replay filtering.',
      ops: [
        { label: 'Collection', value: '9 MB heap delta', width: 26 },
        { label: 'Analytics', value: '270 ms', width: 48 },
        { label: 'Graph build', value: '28 nodes / 19 edges', width: 42 }
      ]
    },
    replay: [
      { id: 'ukraine-a', when: 'T-10h', title: 'Cyber rumor phase', summary: 'The story led with cyber language before utility proof.', decision: 'Keep on watch', return: '+0.2%', hitRate: '39%', notes: ['This phase produced many shallow false positives.', 'The correct move was to demand physical confirmation.'] },
      { id: 'ukraine-b', when: 'T-1h', title: 'Utility confirmation', summary: 'Power-network evidence tightened the scenario.', decision: 'Utility hedge / narrow risk', return: '+1.7%', hitRate: '61%', notes: ['Focused hedges worked better than broad risk-off.', 'Replay helped prevent over-sizing.'] },
      { id: 'ukraine-c', when: 'T+1d', title: 'Contagion fails to widen', summary: 'The event stayed regionally contained.', decision: 'Exit broad thesis', return: '+0.9%', hitRate: '59%', notes: ['A narrow posture preserved gains better than forcing a global macro thesis.', 'Resource load stayed modest because spillover remained local.'] }
    ]
  }
] as const;

const copy = computed(() => copyMap[props.locale]);
const activeMode = ref<ModeId>('map');
const activeHub = ref<HubId>('analysis');
const selectedHotspotId = ref(hotspots[0].id);
const activeLayers = ref<string[]>(['conflict', 'shipping', 'markets']);
const activeReplayId = ref(hotspots[0].replay[0].id);
const oilDelta = ref(8);
const vixLevel = ref(24);
const shippingStress = ref(55);

const activeHotspot = computed(() => hotspots.find((spot) => spot.id === selectedHotspotId.value) ?? hotspots[0]);
const visibleHotspots = computed(() => hotspots.filter((spot) => spot.layers.some((layer) => activeLayers.value.includes(layer))));

watch(visibleHotspots, (next) => {
  if (!next.some((spot) => spot.id === selectedHotspotId.value)) selectedHotspotId.value = next[0]?.id ?? hotspots[0].id;
}, { immediate: true });

watch(activeHotspot, (next) => {
  activeReplayId.value = next.replay[0].id;
  activeHub.value = 'analysis';
}, { immediate: true });

const replayStep = computed(() => activeHotspot.value.replay.find((step) => step.id === activeReplayId.value) ?? activeHotspot.value.replay[0]);

const hubTabs = computed(() => [
  { id: 'analysis', tag: copy.value.analysisTag, title: 'Analysis Hub', summary: activeHotspot.value.analysis.summary },
  { id: 'codex', tag: copy.value.codexTag, title: 'Codex Hub', summary: activeHotspot.value.codex.summary },
  { id: 'ontology', tag: copy.value.ontologyTag, title: 'Ontology', summary: activeHotspot.value.ontology.summary },
  { id: 'backtest', tag: copy.value.backtestTag, title: 'Backtest Lab', summary: activeHotspot.value.backtest.summary },
  { id: 'resources', tag: copy.value.resourcesTag, title: 'Resource Profiler', summary: activeHotspot.value.resources.summary }
] as const);

const hubView = computed(() => {
  if (activeHub.value === 'analysis') return activeHotspot.value.analysis;
  if (activeHub.value === 'codex') return activeHotspot.value.codex;
  if (activeHub.value === 'ontology') return activeHotspot.value.ontology;
  if (activeHub.value === 'backtest') return activeHotspot.value.backtest;
  return activeHotspot.value.resources;
});

const scenarioRisk = computed(() => {
  const hotspotBias = activeHotspot.value.tone === 'critical' ? 14 : activeHotspot.value.tone === 'elevated' ? 8 : 3;
  return Math.round(34 + hotspotBias + oilDelta.value * 1.15 + (vixLevel.value - 12) * 0.88 + shippingStress.value * 0.18);
});

const scenarioRegime = computed(() => {
  if (oilDelta.value >= 12 && vixLevel.value >= 27) return 'Inflation shock';
  if (vixLevel.value >= 30 || shippingStress.value >= 78) return 'Risk-off';
  if (activeHotspot.value.id === 'taiwan' && oilDelta.value < 8 && vixLevel.value < 24) return 'Tech dispersion';
  return 'Transition';
});

const scenarioPosture = computed(() => {
  if (scenarioRisk.value >= 84) return 'Defensive / hedge';
  if (scenarioRisk.value >= 68) return 'Selective risk';
  return 'Normal monitoring';
});

const scenarioActions = computed(() => {
  const actions = [] as Array<{ title: string; note: string }>;
  if (activeHotspot.value.id === 'hormuz') actions.push({ title: 'Energy path first', note: 'Keep energy and shipping transmission on top until broad market stress is actually confirmed.' });
  if (activeHotspot.value.id === 'taiwan') actions.push({ title: 'Supplier dispersion check', note: 'Review suppliers and cloud hardware concentration before switching into a broad tech thesis.' });
  if (activeHotspot.value.id === 'ukraine') actions.push({ title: 'Require physical utility evidence', note: 'Do not overreact to cyber language without grid or power confirmation.' });
  if (oilDelta.value >= 10) actions.push({ title: 'Lift inflation shock watch', note: 'Higher oil levels widen second-wave cost pressure across transport and industrial chains.' });
  if (vixLevel.value >= 28) actions.push({ title: 'Reduce conviction sizing', note: 'High volatility should lower size even when the directional thesis still holds.' });
  if (shippingStress.value >= 60) actions.push({ title: 'Promote shipping and insurance tracks', note: 'Route stress is now strong enough to be treated as confirmation rather than secondary noise.' });
  return actions.slice(0, 4);
});

function toggleLayer(layerId: string) {
  const exists = activeLayers.value.includes(layerId);
  if (exists) {
    if (activeLayers.value.length === 1) return;
    activeLayers.value = activeLayers.value.filter((layer) => layer !== layerId);
    return;
  }
  activeLayers.value = [...activeLayers.value, layerId];
}
</script>

<style scoped>
.lc-ops-demo{position:relative;overflow:hidden}
.lc-ops-toolbar{display:grid;gap:14px;margin-bottom:18px}
.lc-ops-modebar{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.lc-ops-mode,.lc-hotspot-pill,.lc-feed-card,.lc-link-pill-button{cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease}
.lc-ops-mode{width:100%;text-align:left;border:1px solid rgba(148,163,184,.18);border-radius:18px;padding:14px 16px;background:rgba(15,23,42,.58);color:inherit}
.lc-ops-mode strong{display:block}
.lc-ops-mode span{display:block;margin-top:6px;color:var(--vp-c-text-2);font-size:13px}
.lc-ops-mode:hover,.lc-ops-mode.is-active,.lc-hotspot-pill:hover,.lc-hotspot-pill.is-active,.lc-feed-card:hover,.lc-feed-card.is-active,.lc-link-pill-button:hover,.lc-link-pill-button.is-active{transform:translateY(-2px);border-color:rgba(45,212,191,.34);background:rgba(30,41,59,.94);box-shadow:0 14px 34px rgba(2,6,23,.18)}
.lc-hotspot-strip{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.lc-hotspot-pill{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 14px;border-radius:16px;border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.48);color:inherit;text-align:left}
.lc-hotspot-pill span{font-size:13px;color:var(--vp-c-text-2)}
.lc-hotspot-pill strong{font-size:13px}
.lc-ops-grid{display:grid;gap:16px;grid-template-columns:minmax(300px,1.05fr) minmax(0,1fr)}
.lc-ops-panel{border:1px solid rgba(148,163,184,.14);border-radius:22px;padding:18px;background:rgba(15,23,42,.55)}
.lc-ops-panel-strong{background:linear-gradient(180deg,rgba(15,23,42,.84),rgba(15,23,42,.6));border-color:rgba(45,212,191,.18)}
.lc-ops-panel-map{background:linear-gradient(180deg,rgba(7,15,28,.9),rgba(12,20,37,.78));border-color:rgba(96,165,250,.2)}
.lc-map-frame{position:relative;overflow:hidden;margin-top:14px;aspect-ratio:1.7;border-radius:24px;border:1px solid rgba(96,165,250,.18);background:radial-gradient(circle at top left,rgba(96,165,250,.12),transparent 34%),linear-gradient(180deg,rgba(8,15,29,.98),rgba(15,23,42,.96))}
.lc-map-base,.lc-map-overlay{position:absolute;inset:0;width:100%;height:100%}
.lc-map-ocean{fill:#07111f}
.lc-map-land{fill:rgba(96,165,250,.12);stroke:rgba(143,209,255,.22);stroke-width:2}
.lc-map-arc{stroke:#7dd3fc;stroke-width:.35;fill:none;stroke-linecap:round;stroke-dasharray:1.8 1.4}
.lc-map-connection-node{fill:#fde68a}
.lc-map-marker{position:absolute;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;border:1px solid rgba(148,163,184,.2);background:rgba(8,15,29,.86);color:#fff;box-shadow:0 12px 28px rgba(2,6,23,.22)}
.lc-map-marker.is-active{border-color:rgba(251,191,36,.4);background:rgba(15,23,42,.98)}
.lc-map-marker-dot{width:12px;height:12px;border-radius:999px;background:radial-gradient(circle at center,#fde68a,#fb7185 58%,rgba(251,113,133,.2) 70%);box-shadow:0 0 0 6px rgba(251,113,133,.12),0 0 18px rgba(251,113,133,.5);animation:lc-pulse 1.8s ease-in-out infinite}
.lc-map-marker-label{font-size:12px;font-weight:700;letter-spacing:.02em}
.lc-map-caption-row{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px}
.lc-map-caption{border:1px solid rgba(148,163,184,.14);border-radius:16px;padding:12px 14px;background:rgba(15,23,42,.4)}
.lc-map-caption span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--vp-c-text-2)}
.lc-map-caption strong{display:block;margin-top:6px}
.lc-console-header-row{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
.lc-mini-label{margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24}
.lc-mini-label-tight{margin-top:16px}
.lc-risk-pill{display:inline-flex;align-items:center;justify-content:center;padding:7px 12px;border-radius:999px;border:1px solid rgba(148,163,184,.18);background:rgba(148,163,184,.08);font-size:12px;white-space:nowrap}
.lc-risk-pill[data-tone='critical']{border-color:rgba(248,113,113,.34);background:rgba(127,29,29,.26);color:#fecaca}
.lc-risk-pill[data-tone='elevated']{border-color:rgba(251,191,36,.34);background:rgba(120,53,15,.22);color:#fde68a}
.lc-risk-pill[data-tone='watch']{border-color:rgba(96,165,250,.34);background:rgba(30,58,138,.22);color:#bfdbfe}
.lc-metric-row,.lc-chip-row,.lc-link-row,.lc-badge-row{display:flex;gap:8px;flex-wrap:wrap}
.lc-metric-row{margin:16px 0}
.lc-metric-card{min-width:124px;flex:1 1 0;padding:12px 14px;border-radius:16px;border:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.5)}
.lc-metric-card span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--vp-c-text-2)}
.lc-metric-card strong{display:block;margin-top:6px;font-size:18px}
.lc-ops-subgrid{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}
.lc-ops-subcard{padding:16px;border-radius:18px;border:1px solid rgba(148,163,184,.12);background:rgba(15,23,42,.4)}
.lc-relation-list{display:grid;gap:12px}
.lc-relation-item{padding:12px 0;border-top:1px solid rgba(148,163,184,.1)}
.lc-relation-item:first-child{padding-top:0;border-top:none}
.lc-relation-head{display:flex;justify-content:space-between;gap:8px;font-size:13px}
.lc-relation-bar{height:10px;margin:8px 0 6px;border-radius:999px;background:rgba(148,163,184,.1);overflow:hidden}
.lc-relation-bar span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#60a5fa,#f59e0b)}
.lc-topology-list{margin:0;padding-left:18px}
.lc-topology-list li+li{margin-top:7px}
.lc-feed-list{display:grid;gap:12px}
.lc-feed-card,.lc-static-card{border:1px solid rgba(148,163,184,.18);border-radius:18px;padding:14px 16px;background:rgba(15,23,42,.58)}
.lc-feed-card{width:100%;text-align:left;color:inherit}
.lc-feed-card-tier{display:inline-flex;margin-bottom:8px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8fd1ff}
.lc-feed-card strong,.lc-static-card strong{display:block}
.lc-feed-card p,.lc-static-card p{margin:.45rem 0 0;color:var(--vp-c-text-2);font-size:13px}
.lc-static-card{background:rgba(15,23,42,.42)}
.lc-chip,.lc-link-pill{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;font-size:12px;border:1px solid rgba(148,163,184,.24);background:rgba(148,163,184,.08)}
.lc-chip-strong{border-color:rgba(45,212,191,.24);background:rgba(45,212,191,.1)}
.lc-link-pill-button{color:inherit}
.lc-replay-track{display:grid;gap:10px;margin:18px 0}
.lc-replay-track-item{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;border:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.34)}
.lc-replay-track-item.is-active{border-color:rgba(251,191,36,.3);background:rgba(120,53,15,.18)}
.lc-slider-group{display:grid;gap:8px;margin-top:16px}
.lc-slider-group span{display:flex;justify-content:space-between;gap:12px;align-items:center}
.lc-slider-group input{width:100%}
@keyframes lc-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.08);opacity:.84}}
@media (max-width: 960px){
  .lc-ops-grid,.lc-ops-subgrid{grid-template-columns:1fr}
  .lc-console-header-row{flex-direction:column}
  .lc-map-caption-row{grid-template-columns:1fr}
}
</style>
