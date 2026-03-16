<template>
  <section class="lc-section lc-app-globe-showcase">
    <div class="lc-section-head">
      <div>
        <p class="lc-kicker">{{ copy.kicker }}</p>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.lead }}</p>
      </div>
      <div class="lc-badge-row">
        <span v-for="badge in copy.badges" :key="badge" class="lc-badge">{{ badge }}</span>
      </div>
    </div>

    <div class="lc-app-globe-toolbar">
      <div class="lc-link-row">
        <button
          v-for="layer in copy.layers"
          :key="layer.id"
          class="lc-link-pill lc-link-pill-button"
          :class="{ 'is-active': activeLayers.includes(layer.id) }"
          type="button"
          @click="toggleLayer(layer.id)"
        >
          {{ layer.label }}
        </button>
      </div>
      <div class="lc-link-row">
        <button
          v-for="surface in copy.surfaces"
          :key="surface.id"
          class="lc-link-pill lc-link-pill-button"
          :class="{ 'is-active': activeSurface === surface.id }"
          type="button"
          @click="activeSurface = surface.id"
        >
          {{ surface.label }}
        </button>
      </div>
    </div>

    <div class="lc-app-globe-grid">
      <div class="lc-ops-panel lc-app-globe-visual">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.globeLabel }}</p>
            <h3>{{ activeHotspot.label }}</h3>
            <p>{{ activeHotspot.summary }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeHotspot.tone">{{ activeHotspot.risk }}</span>
        </div>

        <div ref="globeRef" class="lc-showcase-globe-shell">
          <div class="lc-showcase-globe-hud">
            <div class="lc-showcase-globe-stat">
              <span>{{ copy.windowLabel }}</span>
              <strong>{{ activeHotspot.window }}</strong>
            </div>
            <div class="lc-showcase-globe-stat">
              <span>{{ copy.pathLabel }}</span>
              <strong>{{ activeHotspot.path }}</strong>
            </div>
            <div class="lc-showcase-globe-stat">
              <span>{{ copy.modeLabel }}</span>
              <strong>{{ projectionLabel }}</strong>
            </div>
          </div>
        </div>

        <div class="lc-map-caption-row">
          <div class="lc-map-caption">
            <span>{{ copy.assetsLabel }}</span>
            <strong>{{ activeHotspot.assets.join(' / ') }}</strong>
          </div>
          <div class="lc-map-caption">
            <span>{{ copy.theaterLabel }}</span>
            <strong>{{ activeHotspot.theater }}</strong>
          </div>
          <div class="lc-map-caption">
            <span>{{ copy.triggerLabel }}</span>
            <strong>{{ activeHotspot.trigger }}</strong>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong lc-app-globe-detail">
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.signalLabel }}</span>
            <strong>{{ activeHotspot.signalMix }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.assetCountLabel }}</span>
            <strong>{{ activeHotspot.assets.length }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.connectionLabel }}</span>
            <strong>{{ activeRelations.length }}</strong>
          </div>
        </div>

        <div v-if="activeSurface === 'brief'" class="lc-ops-subcard">
          <p class="lc-mini-label">{{ copy.briefLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="line in activeHotspot.brief" :key="line">{{ line }}</li>
          </ul>
          <p class="lc-mini-label lc-mini-label-tight">{{ copy.feedLabel }}</p>
          <div class="lc-feed-list">
            <div v-for="item in activeHotspot.feed" :key="item" class="lc-static-card">{{ item }}</div>
          </div>
        </div>

        <div v-else-if="activeSurface === 'relations'" class="lc-ops-subcard">
          <p class="lc-mini-label">{{ copy.relationLabel }}</p>
          <div class="lc-relation-list">
            <div v-for="relation in activeRelations" :key="relation.id" class="lc-relation-item">
              <div class="lc-relation-head">
                <strong>{{ relation.label }}</strong>
                <span>{{ relation.score }}</span>
              </div>
              <div class="lc-relation-bar"><span :style="{ width: `${relation.score}%` }"></span></div>
              <p>{{ relation.note }}</p>
            </div>
          </div>
        </div>

        <div v-else class="lc-ops-subcard">
          <p class="lc-mini-label">{{ copy.hubLabel }}</p>
          <div class="lc-feed-list">
            <div v-for="card in activeHotspot.hubCards" :key="card.title" class="lc-static-card">
              <strong>{{ card.title }}</strong>
              <p>{{ card.note }}</p>
            </div>
          </div>
          <p class="lc-mini-label lc-mini-label-tight">{{ copy.ideaLabel }}</p>
          <div class="lc-globe-idea-panel">
            <div class="lc-globe-idea-row"><span>{{ copy.primaryLabel }}</span><strong>{{ activeHotspot.idea.primary }}</strong></div>
            <div class="lc-globe-idea-row"><span>{{ copy.hedgeLabel }}</span><strong>{{ activeHotspot.idea.hedge }}</strong></div>
            <div class="lc-globe-idea-row"><span>{{ copy.horizonLabel }}</span><strong>{{ activeHotspot.idea.horizon }}</strong></div>
            <p>{{ activeHotspot.idea.note }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type LayerId = 'nodes' | 'labels' | 'relations' | 'lanes' | 'cables' | 'rings';
type SurfaceId = 'brief' | 'relations' | 'hub';
type Tone = 'critical' | 'elevated' | 'watch';

interface Hotspot {
  id: string;
  label: string;
  lat: number;
  lng: number;
  tone: Tone;
  risk: string;
  theater: string;
  window: string;
  path: string;
  signalMix: string;
  trigger: string;
  summary: string;
  brief: string[];
  feed: string[];
  assets: string[];
  hubCards: Array<{ title: string; note: string }>;
  idea: { primary: string; hedge: string; horizon: string; note: string };
}

interface ArcRoute {
  id: string;
  source: string;
  target: string;
  kind: 'relation' | 'route';
  label: string;
  note: string;
  score: number;
}

interface PathRoute {
  id: string;
  kind: 'lane' | 'cable';
  label: string;
  coords: Array<{ lat: number; lng: number }>;
}

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

const copy = computed(() => ({
  en: {
    kicker: 'App-grade showcase',
    title: 'Read-only 3D globe built in the same visual language as the live app',
    lead: 'This page uses real globe rendering with textured earth, night background, animated arcs, route paths, and layered nodes so visitors can explore the map stack without a live backend.',
    badges: ['globe.gl', 'textured earth', 'read-only mock state'],
    globeLabel: 'Read-only showcase globe',
    windowLabel: 'Window',
    pathLabel: 'Impact path',
    modeLabel: 'Projection',
    assetsLabel: 'Linked assets',
    theaterLabel: 'Theater',
    triggerLabel: 'Primary trigger',
    signalLabel: 'Signal mix',
    assetCountLabel: 'Assets in route',
    connectionLabel: 'Connected arcs',
    briefLabel: 'Regional brief',
    feedLabel: 'Mock feed',
    relationLabel: 'Relation and route edges',
    hubLabel: 'Mock hub output',
    ideaLabel: 'Mock investment route',
    primaryLabel: 'Primary',
    hedgeLabel: 'Hedge',
    horizonLabel: 'Best horizon',
    layers: [
      { id: 'nodes', label: 'Nodes' },
      { id: 'labels', label: 'Labels' },
      { id: 'relations', label: 'Relation arcs' },
      { id: 'lanes', label: 'Trade lanes' },
      { id: 'cables', label: 'Subsea cables' },
      { id: 'rings', label: 'Alert rings' },
    ],
    surfaces: [
      { id: 'brief', label: 'Regional brief' },
      { id: 'relations', label: 'Relations' },
      { id: 'hub', label: 'Hub view' },
    ],
  },
  ko: {
    kicker: '앱 수준 쇼케이스',
    title: '실제 앱의 시각 언어를 따라가는 읽기 전용 3D 지구본',
    lead: '이 페이지는 텍스처 지구, 밤하늘 배경, 애니메이션 아크, 경로 선, 레이어 노드를 사용해 live backend 없이도 실제 앱의 지도 감각을 보여줍니다.',
    badges: ['globe.gl', '텍스처 지구', '읽기 전용 mock 상태'],
    globeLabel: '읽기 전용 쇼케이스 지구본',
    windowLabel: '윈도우',
    pathLabel: '영향 경로',
    modeLabel: '투영',
    assetsLabel: '연결 자산',
    theaterLabel: '전장',
    triggerLabel: '주요 트리거',
    signalLabel: '신호 구성',
    assetCountLabel: '경로 내 자산 수',
    connectionLabel: '연결 아크 수',
    briefLabel: '지역 브리프',
    feedLabel: '가상 피드',
    relationLabel: '관계 및 경로 엣지',
    hubLabel: '가상 허브 출력',
    ideaLabel: '가상 투자 경로',
    primaryLabel: '주요 후보',
    hedgeLabel: '헤지',
    horizonLabel: '적합 기간',
    layers: [
      { id: 'nodes', label: '노드' },
      { id: 'labels', label: '라벨' },
      { id: 'relations', label: '관계 아크' },
      { id: 'lanes', label: '무역 경로' },
      { id: 'cables', label: '해저 케이블' },
      { id: 'rings', label: '경보 링' },
    ],
    surfaces: [
      { id: 'brief', label: '지역 브리프' },
      { id: 'relations', label: '관계도' },
      { id: 'hub', label: '허브 뷰' },
    ],
  },
  ja: {
    kicker: 'アプリ級ショーケース',
    title: '実アプリの視覚言語に寄せた読み取り専用 3D グローブ',
    lead: 'このページは textured earth、night sky、animated arc、route path、layered node を使い、live backend なしで実アプリに近い地図体験を見せます。',
    badges: ['globe.gl', 'textured earth', 'read-only mock state'],
    globeLabel: 'Read-only showcase globe',
    windowLabel: 'Window',
    pathLabel: 'Impact path',
    modeLabel: 'Projection',
    assetsLabel: 'Linked assets',
    theaterLabel: 'Theater',
    triggerLabel: 'Primary trigger',
    signalLabel: 'Signal mix',
    assetCountLabel: 'Assets in route',
    connectionLabel: 'Connected arcs',
    briefLabel: 'Regional brief',
    feedLabel: 'Mock feed',
    relationLabel: 'Relation and route edges',
    hubLabel: 'Mock hub output',
    ideaLabel: 'Mock investment route',
    primaryLabel: 'Primary',
    hedgeLabel: 'Hedge',
    horizonLabel: 'Best horizon',
    layers: [
      { id: 'nodes', label: 'Nodes' },
      { id: 'labels', label: 'Labels' },
      { id: 'relations', label: 'Relation arcs' },
      { id: 'lanes', label: 'Trade lanes' },
      { id: 'cables', label: 'Subsea cables' },
      { id: 'rings', label: 'Alert rings' },
    ],
    surfaces: [
      { id: 'brief', label: 'Regional brief' },
      { id: 'relations', label: 'Relations' },
      { id: 'hub', label: 'Hub view' },
    ],
  },
}[props.locale]));

const HOTSPOTS: Hotspot[] = [
  {
    id: 'hormuz',
    label: 'Hormuz',
    lat: 26,
    lng: 56,
    tone: 'critical',
    risk: '87',
    theater: 'Gulf energy corridor',
    window: '24h to 72h',
    path: 'Shipping stress -> energy shock -> airline hedge',
    signalMix: 'Maritime 42 / Oil 33 / State media 25',
    trigger: 'Tanker seizure rhetoric',
    summary: 'High-detail mock node for a Gulf chokepoint shock.',
    brief: [
      'Use the chokepoint with shipping insurance and convoy behavior together rather than reading oil alone.',
      'The strongest mock route starts with energy beta, then checks airline hedge and tanker rerouting.',
      'The side panel compresses what the live app would spread across map, hub, and replay surfaces.',
    ],
    feed: [
      'Insurers raise tanker premium guidance after seizure warning.',
      'Customs chatter implies staggered convoy traffic through the Gulf.',
      'State media deterrence messaging accelerates across the same 12h window.',
    ],
    assets: ['USO', 'XLE', 'JETS'],
    hubCards: [
      { title: 'Analysis Hub', note: 'Convergence spikes across maritime, energy, and sanctions chatter.' },
      { title: 'Backtest Lab', note: 'Historical replay favors 24h and 72h follow-through for energy-linked baskets.' },
      { title: 'Resource Profiler', note: 'Arc and route layers dominate this theater in the live app.' },
    ],
    idea: {
      primary: 'USO / XLE long',
      hedge: 'JETS short',
      horizon: '24h / 72h',
      note: 'Mock route assumes route friction persists beyond the first impulse.',
    },
  },
  {
    id: 'red-sea',
    label: 'Red Sea',
    lat: 20,
    lng: 39,
    tone: 'elevated',
    risk: '74',
    theater: 'Maritime logistics corridor',
    window: '12h to 72h',
    path: 'Route diversion -> freight stress -> industrial margin pressure',
    signalMix: 'Ports 38 / Shipping 34 / Commodity 28',
    trigger: 'Convoy rerouting',
    summary: 'Logistics-heavy node for route diversion, insurer repricing, and importer stress.',
    brief: [
      'Treat rerouting as a duration problem, not a single-news event.',
      'Watch freight, insurer commentary, and customs friction as one route cluster.',
      'The live map would pair this theater with corridor arcs and cable overlays.',
    ],
    feed: [
      'Carriers extend Cape routing guidance for another week.',
      'Insurance desks point to a second premium step-up.',
      'Europe-facing importers begin warning on delivery windows.',
    ],
    assets: ['BDRY', 'XLE', 'IYT'],
    hubCards: [
      { title: 'Ontology Graph', note: 'Ports, carriers, insurers, and chokepoints form a dense corridor subgraph.' },
      { title: 'Codex Hub', note: 'Coverage checks look for missing freight and transport proxies.' },
      { title: 'Backtest Lab', note: 'Mock replay rewards duration-sensitive route proxies more than one-bar trades.' },
    ],
    idea: {
      primary: 'Freight and energy stress basket',
      hedge: 'Europe transport hedge',
      horizon: '24h / 168h',
      note: 'Mock path rewards route-duration sensitivity.',
    },
  },
  {
    id: 'taiwan',
    label: 'Taiwan Strait',
    lat: 24,
    lng: 121,
    tone: 'critical',
    risk: '82',
    theater: 'Semiconductor chokepoint',
    window: '24h to 168h',
    path: 'Drill activity -> semi supply chain -> global tech hedge',
    signalMix: 'Military 36 / Chips 34 / Export controls 30',
    trigger: 'Exercise envelope expansion',
    summary: 'Semiconductor theater linking military activity, fabs, shipping lanes, and export-control risk.',
    brief: [
      'This theater is intentionally multi-day. The first reaction is usually less useful than the next 72h.',
      'The detailed globe emphasizes why fabs, allied posture, and supply routes must be read together.',
      'Mock hub output favors semi beta and safe-haven pairing rather than instant all-clear logic.',
    ],
    feed: [
      'Exercise notice widens around fab-adjacent lanes.',
      'Supplier commentary points to longer inspection windows.',
      'Memory and equipment baskets begin to rerate across Asia and US tech.',
    ],
    assets: ['SOXX', 'NVDA', 'GLD'],
    hubCards: [
      { title: 'Analysis Hub', note: 'Fab geography, military posture, and export-control language overlap in the same cluster.' },
      { title: 'Codex Hub', note: 'Suggests memory and equipment proxies when coverage gaps appear.' },
      { title: 'Backtest Lab', note: 'Mock replay prefers 72h and 168h horizons for semiconductor dislocation themes.' },
    ],
    idea: {
      primary: 'SOXX / semi hedge rotation',
      hedge: 'GLD or duration',
      horizon: '72h / 168h',
      note: 'Mock route favors multi-session supply-chain repricing.',
    },
  },
  {
    id: 'silicon',
    label: 'Silicon Valley',
    lat: 37.39,
    lng: -122.08,
    tone: 'watch',
    risk: '61',
    theater: 'Technology capital node',
    window: '12h to 168h',
    path: 'AI capex pulse -> supply chain dependency -> semiconductor route',
    signalMix: 'AI capex 44 / Chips 30 / Cloud 26',
    trigger: 'Earnings and hardware guidance',
    summary: 'Technology node connecting AI capex, compute demand, and geopolitical chip dependency.',
    brief: [
      'This node is downstream confirmation for Taiwan and AI supply chain pressure.',
      'Detailed arcs connect capex narratives to fab concentration and component routing.',
      'The live app uses this style to merge tech and geopolitical surfaces without flattening either one.',
    ],
    feed: [
      'Hyperscaler commentary widens AI capacity guidance.',
      'Hardware desks reprice memory lead-time assumptions.',
      'Cloud narratives shift from growth alone to supply resilience.',
    ],
    assets: ['SOXX', 'SMH', 'GLD'],
    hubCards: [
      { title: 'Codex Hub', note: 'Finds missing AI hardware proxies when tracked coverage lags new narratives.' },
      { title: 'Resource Profiler', note: 'Cross-theme graph joins are heavier here than in corridor-only theaters.' },
      { title: 'Backtest Lab', note: 'Mock replay favors 72h plus horizons for capex and supply-route themes.' },
    ],
    idea: {
      primary: 'SOXX / AI supply route',
      hedge: 'Duration or gold hedge',
      horizon: '72h / 168h',
      note: 'Mock route waits for supply and capex narratives to align.',
    },
  },
  {
    id: 'eastern-europe',
    label: 'Eastern Europe',
    lat: 49,
    lng: 31,
    tone: 'elevated',
    risk: '71',
    theater: 'Security posture theater',
    window: '24h to 168h',
    path: 'Military posture -> defense rerating -> sanctions extension',
    signalMix: 'Defense 43 / Policy 31 / Energy 26',
    trigger: 'Air and missile posture shift',
    summary: 'Security theater for posture, logistics degradation, defense beta, and sanction overhang.',
    brief: [
      'The detailed globe keeps posture and logistics in the same theater because either alone is too noisy.',
      'This mock route is stronger for defense baskets than for broad-market calls.',
      'Multi-day horizons dominate once posture and sanctions lock into the same route set.',
    ],
    feed: [
      'Defense names lift on posture shift.',
      'Rail and energy infrastructure chatter extends stress.',
      'Policy desks prepare another sanctions round.',
    ],
    assets: ['ITA', 'XAR', 'IEF'],
    hubCards: [
      { title: 'Analysis Hub', note: 'Defense beta rises when posture and logistics degradation align.' },
      { title: 'Ontology Graph', note: 'Sanctions, transport, and defense entities now sit in one region graph.' },
      { title: 'Backtest Lab', note: 'Mock replay favors 72h and 168h for defense rerating themes.' },
    ],
    idea: {
      primary: 'ITA / defense basket',
      hedge: 'Rates hedge',
      horizon: '72h / 168h',
      note: 'Mock route stays focused on posture-sensitive defense proxies.',
    },
  },
];

const ARCS: ArcRoute[] = [
  { id: 'hormuz-redsea', source: 'hormuz', target: 'red-sea', kind: 'route', label: 'Hormuz -> Red Sea', note: 'Shipping detours amplify freight and insurance costs.', score: 84 },
  { id: 'hormuz-taiwan', source: 'hormuz', target: 'taiwan', kind: 'relation', label: 'Hormuz -> Taiwan inflation echo', note: 'Energy shock and chip freight pricing reinforce each other.', score: 49 },
  { id: 'redsea-europe', source: 'red-sea', target: 'eastern-europe', kind: 'relation', label: 'Red Sea -> Eastern Europe supply route', note: 'Industrial bottlenecks spill into wider security and policy routes.', score: 46 },
  { id: 'taiwan-silicon', source: 'taiwan', target: 'silicon', kind: 'route', label: 'Taiwan -> Silicon Valley AI route', note: 'AI capex inherits fab concentration risk.', score: 78 },
  { id: 'europe-taiwan', source: 'eastern-europe', target: 'taiwan', kind: 'relation', label: 'Eastern Europe -> Taiwan defense watch', note: 'Security theaters share defense and sanction attention.', score: 41 },
];

const PATHS: PathRoute[] = [
  { id: 'lane-gulf-redsea', kind: 'lane', label: 'Energy lane', coords: [{ lat: 26, lng: 56 }, { lat: 22, lng: 49 }, { lat: 19, lng: 42 }, { lat: 20, lng: 39 }] },
  { id: 'lane-redsea-europe', kind: 'lane', label: 'Europe supply lane', coords: [{ lat: 20, lng: 39 }, { lat: 24, lng: 34 }, { lat: 34, lng: 18 }, { lat: 43, lng: 14 }] },
  { id: 'lane-taiwan-silicon', kind: 'lane', label: 'Semiconductor lane', coords: [{ lat: 24, lng: 121 }, { lat: 31, lng: 146 }, { lat: 37, lng: 170 }, { lat: 37.39, lng: -122.08 }] },
  { id: 'cable-gulf-asia', kind: 'cable', label: 'Subsea cable corridor', coords: [{ lat: 25, lng: 55 }, { lat: 16, lng: 73 }, { lat: 10, lng: 95 }, { lat: 20, lng: 118 }] },
  { id: 'cable-europe-us', kind: 'cable', label: 'Atlantic backbone', coords: [{ lat: 51, lng: -8 }, { lat: 49, lng: -28 }, { lat: 43, lng: -52 }, { lat: 40, lng: -74 }] },
];

const globeRef = ref<HTMLDivElement | null>(null);
const activeLayers = ref<LayerId[]>(['nodes', 'labels', 'relations', 'lanes', 'cables', 'rings']);
const activeSurface = ref<SurfaceId>('brief');
const selectedHotspotId = ref('hormuz');
const projectionLabel = '3D globe';
const activeHotspot = computed(() => HOTSPOTS.find((item) => item.id === selectedHotspotId.value) || HOTSPOTS[0]);
const activeRelations = computed(() => ARCS.filter((route) => route.source === selectedHotspotId.value || route.target === selectedHotspotId.value));

let globe: any = null;
let resizeObserver: ResizeObserver | null = null;

function toggleLayer(layer: LayerId): void {
  const next = new Set(activeLayers.value);
  next.has(layer) ? next.delete(layer) : next.add(layer);
  activeLayers.value = Array.from(next) as LayerId[];
}

function toneColor(tone: Tone): string {
  if (tone === 'critical') return '#ff6b57';
  if (tone === 'elevated') return '#f6b84e';
  return '#67b2ff';
}

function refreshGlobeData(): void {
  if (!globe) return;
  const showNodes = activeLayers.value.includes('nodes');
  const showLabels = activeLayers.value.includes('labels');
  const showRelations = activeLayers.value.includes('relations');
  const showLanes = activeLayers.value.includes('lanes');
  const showCables = activeLayers.value.includes('cables');
  const showRings = activeLayers.value.includes('rings');

  const points = showNodes ? HOTSPOTS.map((item) => ({
    ...item,
    altitude: item.id === selectedHotspotId.value ? 0.22 : 0.14,
    radius: item.id === selectedHotspotId.value ? 0.34 : 0.24,
    color: toneColor(item.tone),
  })) : [];

  globe
    .pointsData(points)
    .pointLat('lat')
    .pointLng('lng')
    .pointAltitude('altitude')
    .pointRadius('radius')
    .pointColor('color')
    .pointResolution(14)
    .pointsMerge(false)
    .pointLabel((d: any) => `${d.label}<br/>Risk ${d.risk}<br/>${d.path}`)
    .onPointClick((d: any) => {
      selectedHotspotId.value = d.id;
    });

  globe
    .labelsData(showLabels ? HOTSPOTS.map((item) => ({ ...item, size: item.id === selectedHotspotId.value ? 1.45 : 1.1 })) : [])
    .labelLat('lat')
    .labelLng('lng')
    .labelText('label')
    .labelColor(() => '#cfe9ff')
    .labelDotRadius(0.16)
    .labelSize('size')
    .labelAltitude(() => 0.025);

  globe
    .arcsData(showRelations ? ARCS.map((route) => {
      const source = HOTSPOTS.find((item) => item.id === route.source)!;
      const target = HOTSPOTS.find((item) => item.id === route.target)!;
      return {
        ...route,
        startLat: source.lat,
        startLng: source.lng,
        endLat: target.lat,
        endLng: target.lng,
        color: route.kind === 'route' ? ['#74d0ff', '#6ce5b7'] : ['#ffb45c', '#ff7b7b'],
      };
    }) : [])
    .arcStartLat('startLat')
    .arcStartLng('startLng')
    .arcEndLat('endLat')
    .arcEndLng('endLng')
    .arcColor('color')
    .arcAltitude((d: any) => 0.14 + d.score / 800)
    .arcStroke((d: any) => 0.45 + d.score / 180)
    .arcDashLength(0.65)
    .arcDashGap(0.25)
    .arcDashAnimateTime(3800);

  globe
    .pathsData(PATHS.filter((path) => (path.kind === 'lane' ? showLanes : showCables)))
    .pathPoints('coords')
    .pathPointLat('lat')
    .pathPointLng('lng')
    .pathColor((d: any) => (d.kind === 'lane' ? '#81d4ff' : '#f7b955'))
    .pathStroke((d: any) => (d.kind === 'lane' ? 1.2 : 0.95))
    .pathDashLength((d: any) => (d.kind === 'lane' ? 0.18 : 0.12))
    .pathDashGap((d: any) => (d.kind === 'lane' ? 0.08 : 0.16))
    .pathDashAnimateTime((d: any) => (d.kind === 'lane' ? 5000 : 6200))
    .pathLabel((d: any) => d.label);

  globe
    .ringsData(showRings ? [activeHotspot.value] : [])
    .ringLat('lat')
    .ringLng('lng')
    .ringColor(() => (t: number) => (t < 0.55 ? 'rgba(116,208,255,0.34)' : 'rgba(116,208,255,0)'))
    .ringMaxRadius(10)
    .ringPropagationSpeed(2.4)
    .ringRepeatPeriod(1300);
}

function focusSelected(): void {
  if (!globe) return;
  globe.pointOfView(
    {
      lat: activeHotspot.value.lat,
      lng: activeHotspot.value.lng,
      altitude: 1.7,
    },
    1200,
  );
}

onMounted(async () => {
  if (!globeRef.value) return;
  const GlobeModule = await import('globe.gl');
  const GlobeFactory = GlobeModule.default as any;
  const base = (import.meta as any).env.BASE_URL || '/';
  globe = GlobeFactory()(globeRef.value)
    .globeImageUrl(`${base}textures/earth-topo-bathy.jpg`)
    .backgroundImageUrl(`${base}textures/night-sky.png`)
    .showAtmosphere(true)
    .atmosphereColor('#72c5ff')
    .atmosphereAltitude(0.17)
    .width(globeRef.value.clientWidth)
    .height(globeRef.value.clientHeight);

  const controls = globe.controls?.();
  if (controls) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.36;
    controls.enablePan = false;
    controls.minDistance = 140;
    controls.maxDistance = 420;
  }

  refreshGlobeData();
  focusSelected();
  resizeObserver = new ResizeObserver(() => {
    if (!globe || !globeRef.value) return;
    globe.width(globeRef.value.clientWidth).height(globeRef.value.clientHeight);
  });
  resizeObserver.observe(globeRef.value);
});

watch(selectedHotspotId, () => {
  refreshGlobeData();
  focusSelected();
});

watch(activeLayers, () => {
  refreshGlobeData();
}, { deep: true });

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (globe?._destructor) {
    try { globe._destructor(); } catch { /* ignore */ }
  }
  globe = null;
});
</script>
