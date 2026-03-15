<template>
  <section class="lc-section lc-playground">
    <div class="lc-section-head">
      <div>
        <p class="lc-kicker">{{ copy.kicker }}</p>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.lead }}</p>
      </div>
      <div class="lc-badge-row">
        <span v-for="item in copy.badges" :key="item" class="lc-badge">{{ item }}</span>
      </div>
    </div>

    <div class="lc-playground-modebar">
      <button
        v-for="mode in copy.modes"
        :key="mode.id"
        class="lc-playground-mode"
        :class="{ 'is-active': activeMode === mode.id }"
        type="button"
        @click="activeMode = mode.id"
      >
        <strong>{{ mode.title }}</strong>
        <span>{{ mode.summary }}</span>
      </button>
    </div>

    <div v-if="activeMode === 'live'" class="lc-playground-grid">
      <div class="lc-playground-panel">
        <p class="lc-mini-label">{{ copy.feedLabel }}</p>
        <div class="lc-feed-list">
          <button
            v-for="item in feed"
            :key="item.id"
            class="lc-feed-card"
            :class="{ 'is-active': selectedFeedId === item.id }"
            type="button"
            @click="selectedFeedId = item.id"
          >
            <span class="lc-feed-card-tier">{{ item.severity }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.meta }}</p>
          </button>
        </div>
      </div>
      <div class="lc-playground-panel lc-playground-panel-strong">
        <p class="lc-mini-label">{{ copy.detailLabel }}</p>
        <h3>{{ activeFeed.title }}</h3>
        <p>{{ activeFeed.description }}</p>
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.regionLabel }}</span>
            <strong>{{ activeFeed.region }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.impactLabel }}</span>
            <strong>{{ activeFeed.impact }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.confidenceLabel }}</span>
            <strong>{{ activeFeed.confidence }}</strong>
          </div>
        </div>
        <div class="lc-chip-row">
          <span v-for="item in activeFeed.channels" :key="item" class="lc-chip lc-chip-strong">{{ item }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="activeMode === 'transmission'" class="lc-playground-grid">
      <div class="lc-playground-panel">
        <p class="lc-mini-label">{{ copy.transmissionLabel }}</p>
        <div class="lc-transmission-rail">
          <button
            v-for="path in transmissionPaths"
            :key="path.id"
            class="lc-transmission-card"
            :class="{ 'is-active': selectedPathId === path.id }"
            type="button"
            @click="selectedPathId = path.id"
          >
            <strong>{{ path.event }}</strong>
            <span>{{ path.theme }}</span>
          </button>
        </div>
      </div>
      <div class="lc-playground-panel lc-playground-panel-strong">
        <p class="lc-mini-label">{{ copy.pathLabel }}</p>
        <div class="lc-transmission-chain">
          <div class="lc-transmission-node">{{ activePath.event }}</div>
          <div class="lc-transmission-arrow"></div>
          <div class="lc-transmission-node">{{ activePath.theme }}</div>
          <div class="lc-transmission-arrow"></div>
          <div class="lc-transmission-node is-terminal">{{ activePath.asset }}</div>
        </div>
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.edgePowerLabel }}</span>
            <strong>{{ activePath.power }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.directionLabel }}</span>
            <strong>{{ activePath.direction }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.horizonLabel }}</span>
            <strong>{{ activePath.horizon }}</strong>
          </div>
        </div>
        <p>{{ activePath.note }}</p>
      </div>
    </div>

    <div v-else-if="activeMode === 'replay'" class="lc-playground-grid">
      <div class="lc-playground-panel">
        <p class="lc-mini-label">{{ copy.replayLabel }}</p>
        <div class="lc-feed-list">
          <button
            v-for="run in replayRuns"
            :key="run.id"
            class="lc-feed-card"
            :class="{ 'is-active': selectedReplayId === run.id }"
            type="button"
            @click="selectedReplayId = run.id"
          >
            <span class="lc-feed-card-tier">{{ run.window }}</span>
            <strong>{{ run.caseTitle }}</strong>
            <p>{{ run.meta }}</p>
          </button>
        </div>
      </div>
      <div class="lc-playground-panel lc-playground-panel-strong">
        <p class="lc-mini-label">{{ copy.replayDetailLabel }}</p>
        <h3>{{ activeReplay.caseTitle }}</h3>
        <p>{{ activeReplay.thesis }}</p>
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.bestDecisionLabel }}</span>
            <strong>{{ activeReplay.bestDecision }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.realizedLabel }}</span>
            <strong>{{ activeReplay.realized }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.hitRateLabel }}</span>
            <strong>{{ activeReplay.hitRate }}</strong>
          </div>
        </div>
        <ul class="lc-topology-list">
          <li v-for="line in activeReplay.notes" :key="line">{{ line }}</li>
        </ul>
      </div>
    </div>

    <div v-else class="lc-playground-grid">
      <div class="lc-playground-panel">
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
      <div class="lc-playground-panel lc-playground-panel-strong">
        <p class="lc-mini-label">{{ copy.scenarioOutputLabel }}</p>
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.riskScoreLabel }}</span>
            <strong>{{ scenarioRisk }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.regimeLabel }}</span>
            <strong>{{ scenarioRegime }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.postureLabel }}</span>
            <strong>{{ scenarioPosture }}</strong>
          </div>
        </div>
        <ul class="lc-topology-list">
          <li v-for="line in scenarioActions" :key="line">{{ line }}</li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type Locale = 'en' | 'ko' | 'ja';

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

const copyMap = {
  en: {
    kicker: 'Interactive playground',
    title: 'Click through realistic product flows with mock data',
    lead: 'This is a frontend-only sandbox built from synthetic examples. It lets visitors test the product model without access to live feeds or private infrastructure.',
    badges: ['Mock data', 'Operator flow', 'Public safe'],
    modes: [
      { id: 'live', title: 'Live desk', summary: 'Select a live event and inspect its operator summary.' },
      { id: 'transmission', title: 'Transmission', summary: 'Follow how an event spills into a theme and an asset.' },
      { id: 'replay', title: 'Replay lab', summary: 'Open a historical case and compare the best decision.' },
      { id: 'scenario', title: 'Scenario', summary: 'Move macro sliders and watch the posture update.' }
    ],
    feedLabel: 'Mock live feed', detailLabel: 'Selected event', regionLabel: 'Region', impactLabel: 'Primary channel', confidenceLabel: 'Confidence',
    transmissionLabel: 'Transmission paths', pathLabel: 'Selected path', edgePowerLabel: 'Edge power', directionLabel: 'Direction', horizonLabel: 'Horizon',
    replayLabel: 'Historical cases', replayDetailLabel: 'Replay detail', bestDecisionLabel: 'Best decision', realizedLabel: 'Realized return', hitRateLabel: 'Hit rate',
    scenarioLabel: 'What-if controls', scenarioOutputLabel: 'Scenario output', oilLabel: 'Oil move', vixLabel: 'VIX', shippingLabel: 'Shipping stress', riskScoreLabel: 'Risk score', regimeLabel: 'Regime', postureLabel: 'Suggested posture'
  },
  ko: {
    kicker: '인터랙티브 플레이그라운드',
    title: '가상 데이터로 실제 제품 흐름을 눌러보며 체험할 수 있습니다',
    lead: '이 섹션은 synthetic example 기반의 프론트엔드 전용 샌드박스입니다. 라이브 피드나 private 인프라 없이도 제품 구조를 직접 눌러볼 수 있습니다.',
    badges: ['가상 데이터', '운영 흐름', '공개 안전'],
    modes: [
      { id: 'live', title: 'Live desk', summary: '실시간 이벤트를 선택하고 운영 요약을 확인합니다.' },
      { id: 'transmission', title: 'Transmission', summary: '이벤트가 테마와 자산으로 번지는 경로를 봅니다.' },
      { id: 'replay', title: 'Replay lab', summary: '과거 사례를 열고 최적 결정을 비교합니다.' },
      { id: 'scenario', title: 'Scenario', summary: '매크로 슬라이더를 움직여 태세 변화를 확인합니다.' }
    ],
    feedLabel: '가상 실시간 피드', detailLabel: '선택한 이벤트', regionLabel: '지역', impactLabel: '주요 채널', confidenceLabel: '신뢰도',
    transmissionLabel: '전이 경로', pathLabel: '선택 경로', edgePowerLabel: '전이 강도', directionLabel: '방향', horizonLabel: '관측 구간',
    replayLabel: '과거 사례', replayDetailLabel: '리플레이 상세', bestDecisionLabel: '최적 결정', realizedLabel: '실현 수익률', hitRateLabel: '적중률',
    scenarioLabel: '가정 시나리오', scenarioOutputLabel: '시나리오 출력', oilLabel: '유가 변동', vixLabel: 'VIX', shippingLabel: '해운 스트레스', riskScoreLabel: '리스크 점수', regimeLabel: '체제', postureLabel: '권장 태세'
  },
  ja: {
    kicker: 'Interactive playground',
    title: 'Mock data で製品フローをクリックして試せます',
    lead: 'これは synthetic example による frontend-only sandbox です。ライブ feed や private infrastructure がなくても製品構造を体験できます。',
    badges: ['Mock data', 'Operator flow', 'Public safe'],
    modes: [
      { id: 'live', title: 'Live desk', summary: 'ライブイベントを選び運用サマリーを確認します。' },
      { id: 'transmission', title: 'Transmission', summary: 'イベントがテーマと資産に伝播する流れを見ます。' },
      { id: 'replay', title: 'Replay lab', summary: '過去ケースを開き最適判断を比較します。' },
      { id: 'scenario', title: 'Scenario', summary: 'マクロ slider を動かして posture 変化を見ます。' }
    ],
    feedLabel: 'Mock live feed', detailLabel: 'Selected event', regionLabel: 'Region', impactLabel: 'Primary channel', confidenceLabel: 'Confidence',
    transmissionLabel: 'Transmission paths', pathLabel: 'Selected path', edgePowerLabel: 'Edge power', directionLabel: 'Direction', horizonLabel: 'Horizon',
    replayLabel: 'Historical cases', replayDetailLabel: 'Replay detail', bestDecisionLabel: 'Best decision', realizedLabel: 'Realized return', hitRateLabel: 'Hit rate',
    scenarioLabel: 'What-if controls', scenarioOutputLabel: 'Scenario output', oilLabel: 'Oil move', vixLabel: 'VIX', shippingLabel: 'Shipping stress', riskScoreLabel: 'Risk score', regimeLabel: 'Regime', postureLabel: 'Suggested posture'
  }
} as const;

const copy = computed(() => copyMap[props.locale]);
const activeMode = ref<'live' | 'transmission' | 'replay' | 'scenario'>('live');

const feed = [
  { id: 'hormuz', severity: 'ALERT', title: 'Hormuz shipping risk rises after clustered strikes', meta: 'Middle East · 12 sources · updated 04:10 UTC', description: 'The system groups shipping disruption, insurance chatter, and energy spillover into one operator summary for rapid review.', region: 'Middle East', impact: 'Energy / shipping', confidence: '84%', channels: ['shipping', 'oil', 'insurance'] },
  { id: 'semis', severity: 'WATCH', title: 'Export-control chatter lifts chip supply-chain stress', meta: 'East Asia · 8 sources · updated 04:34 UTC', description: 'A tech-oriented operator sees policy signals, supplier exposure, and cloud hardware dependencies in one place.', region: 'East Asia', impact: 'Semiconductors', confidence: '76%', channels: ['semis', 'cloud', 'trade policy'] },
  { id: 'grid', severity: 'BREAK', title: 'Grid attack narrative triggers cyber and utility monitoring', meta: 'Europe · 6 sources · updated 04:41 UTC', description: 'The UI combines cyber indicators, grid assets, and second-order market effects without requiring a private data connection.', region: 'Europe', impact: 'Cyber / utilities', confidence: '71%', channels: ['cyber', 'utilities', 'infrastructure'] }
];
const selectedFeedId = ref(feed[0].id);
const activeFeed = computed(() => feed.find((item) => item.id === selectedFeedId.value) ?? feed[0]);

const transmissionPaths = [
  { id: 'oil', event: 'Hormuz disruption', theme: 'Energy shock', asset: 'XLE / Brent', power: '0.72', direction: 'Long energy', horizon: '3D', note: 'High shipping stress and insurance repricing raise oil-linked sensitivity.' },
  { id: 'chips', event: 'Export controls', theme: 'Compute bottleneck', asset: 'SOXX / logistics', power: '0.61', direction: 'Mixed', horizon: '5D', note: 'Policy pressure lifts semiconductor dispersion and supplier-screening risk.' },
  { id: 'grid', event: 'Grid outage narrative', theme: 'Critical infrastructure risk', asset: 'Utilities / cyber ETF', power: '0.55', direction: 'Hedge utilities', horizon: '2D', note: 'Cyber uncertainty increases defensive utility and infrastructure monitoring demand.' }
];
const selectedPathId = ref(transmissionPaths[0].id);
const activePath = computed(() => transmissionPaths.find((item) => item.id === selectedPathId.value) ?? transmissionPaths[0]);

const replayRuns = [
  { id: 'red-sea', window: '2024 Q1', caseTitle: 'Red Sea shipping disruption', meta: 'walk-forward · 7D horizon', thesis: 'Shipping disruption widened into insurance and energy channels before broader inflation pressure surfaced.', bestDecision: 'Long shipping hedge / watch airlines', realized: '+4.8%', hitRate: '67%', notes: ['Best path appeared after transmission convergence, not first headline.', 'Short airline sensitivity improved only when fuel pressure crossed risk threshold.', 'Warm-up windows were excluded from evaluation.'] },
  { id: 'chip-ban', window: '2025 Q3', caseTitle: 'AI chip export-control cycle', meta: 'replay · 5D horizon', thesis: 'Supplier dependency and cloud capex narratives mattered more than headline count alone.', bestDecision: 'Long dispersion / short weakest supplier basket', realized: '+3.1%', hitRate: '63%', notes: ['Graph context improved alias resolution on supplier names.', 'Posterior mapping quality mattered more than raw article volume.', 'False-positive filters removed opinion-only coverage.'] },
  { id: 'grid-attack', window: '2025 Q4', caseTitle: 'Regional grid attack scare', meta: 'walk-forward · 2D horizon', thesis: 'Cyber chatter alone was weak until infrastructure references and utility exposure aligned.', bestDecision: 'Utility hedge, not broad risk-off', realized: '+1.9%', hitRate: '58%', notes: ['Convergence and ontology validation raised confidence.', 'Cross-asset spillover remained shallow without physical outage evidence.', 'Replay highlighted where operator review prevented overreaction.'] }
];
const selectedReplayId = ref(replayRuns[0].id);
const activeReplay = computed(() => replayRuns.find((item) => item.id === selectedReplayId.value) ?? replayRuns[0]);

const oilDelta = ref(8);
const vixLevel = ref(24);
const shippingStress = ref(55);
const scenarioRisk = computed(() => Math.round(38 + oilDelta.value * 1.2 + (vixLevel.value - 12) * 0.9 + shippingStress.value * 0.18));
const scenarioRegime = computed(() => {
  if (oilDelta.value >= 12 && vixLevel.value >= 28) return 'Inflation shock';
  if (vixLevel.value >= 30) return 'Risk-off';
  if (oilDelta.value <= 0 && shippingStress.value < 30) return 'Risk-on';
  return 'Transition';
});
const scenarioPosture = computed(() => {
  if (scenarioRisk.value >= 82) return 'Defensive / hedge';
  if (scenarioRisk.value >= 68) return 'Selective risk';
  return 'Normal watch';
});
const scenarioActions = computed(() => {
  const actions = [] as string[];
  if (oilDelta.value >= 10) actions.push('Increase energy and transport sensitivity monitoring.');
  if (vixLevel.value >= 28) actions.push('Reduce conviction sizing and widen invalidation review.');
  if (shippingStress.value >= 60) actions.push('Promote shipping and insurance transmission paths in watchlists.');
  if (actions.length === 0) actions.push('Conditions remain contained; maintain standard monitoring posture.');
  return actions;
});
</script>

<style scoped>
.lc-section{position:relative;margin:28px 0;padding:24px;border-radius:24px;border:1px solid rgba(96,165,250,.18);background:radial-gradient(circle at top left,rgba(45,212,191,.12),transparent 34%),radial-gradient(circle at bottom right,rgba(251,191,36,.12),transparent 34%),linear-gradient(180deg,rgba(8,15,29,.95),rgba(15,23,42,.92));box-shadow:0 24px 72px rgba(2,6,23,.24)}
.lc-section-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}
.lc-kicker{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#8fd1ff}
.lc-badge-row,.lc-chip-row,.lc-metric-row,.lc-link-row{display:flex;gap:8px;flex-wrap:wrap}
.lc-badge,.lc-chip,.lc-link-pill{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;font-size:12px;border:1px solid rgba(148,163,184,.24);background:rgba(148,163,184,.08)}
.lc-playground-modebar{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px}
.lc-playground-mode,.lc-feed-card,.lc-transmission-card{width:100%;text-align:left;border:1px solid rgba(148,163,184,.18);border-radius:18px;padding:14px 16px;background:rgba(15,23,42,.58);color:inherit;cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease}
.lc-playground-mode:hover,.lc-playground-mode.is-active,.lc-feed-card:hover,.lc-feed-card.is-active,.lc-transmission-card:hover,.lc-transmission-card.is-active{transform:translateY(-2px);border-color:rgba(45,212,191,.34);background:rgba(30,41,59,.92);box-shadow:0 14px 34px rgba(2,6,23,.18)}
.lc-playground-mode strong,.lc-feed-card strong,.lc-transmission-card strong{display:block}
.lc-playground-mode span,.lc-feed-card p,.lc-transmission-card span{display:block;margin-top:6px;color:var(--vp-c-text-2);font-size:13px}
.lc-playground-grid{display:grid;gap:16px;grid-template-columns:minmax(280px,.9fr) minmax(0,1.2fr)}
.lc-playground-panel{border:1px solid rgba(148,163,184,.14);border-radius:20px;padding:18px;background:rgba(15,23,42,.55)}
.lc-playground-panel-strong{background:linear-gradient(180deg,rgba(15,23,42,.8),rgba(15,23,42,.58));border-color:rgba(45,212,191,.18)}
.lc-mini-label{margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24}
.lc-feed-list,.lc-transmission-rail{display:grid;gap:10px}
.lc-feed-card-tier{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.22);margin-bottom:8px}
.lc-chip-strong{background:rgba(45,212,191,.12);border-color:rgba(45,212,191,.28)}
.lc-metric-card{flex:1 1 150px;border:1px solid rgba(148,163,184,.16);border-radius:16px;padding:12px 14px;background:rgba(9,17,31,.46)}
.lc-metric-card span{display:block;font-size:12px;color:var(--vp-c-text-2);text-transform:uppercase;letter-spacing:.08em}
.lc-metric-card strong{display:block;margin-top:6px;font-size:22px;letter-spacing:-.03em}
.lc-transmission-chain{display:grid;gap:12px;grid-template-columns:1fr 40px 1fr 40px 1fr;align-items:center;margin:12px 0 18px}
.lc-transmission-node{padding:16px;border-radius:16px;border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.62);text-align:center;font-weight:700}
.lc-transmission-node.is-terminal{border-color:rgba(45,212,191,.34);background:rgba(45,212,191,.12)}
.lc-transmission-arrow{height:2px;background:linear-gradient(90deg,rgba(96,165,250,.18),rgba(45,212,191,.58));position:relative}
.lc-transmission-arrow::after{content:'';position:absolute;right:0;top:-4px;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:8px solid rgba(45,212,191,.7)}
.lc-slider-group{display:block}.lc-slider-group+.lc-slider-group{margin-top:16px}
.lc-slider-group span{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;font-size:14px}
.lc-slider-group input{width:100%}
.lc-topology-list{margin:0;padding-left:18px}.lc-topology-list li+li{margin-top:6px}
@media (max-width:860px){.lc-section-head,.lc-playground-grid{display:grid;grid-template-columns:1fr}.lc-transmission-chain{grid-template-columns:1fr;}.lc-transmission-arrow{width:2px;height:24px;justify-self:center;background:linear-gradient(180deg,rgba(96,165,250,.18),rgba(45,212,191,.58))}.lc-transmission-arrow::after{right:-3px;top:auto;bottom:-2px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:8px solid rgba(45,212,191,.7);border-bottom:0}}
</style>
