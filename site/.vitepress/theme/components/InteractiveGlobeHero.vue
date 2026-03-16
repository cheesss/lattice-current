<template>
  <section class="lc-section lc-globe-console">
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

    <div class="lc-globe-toolbar">
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

    <div class="lc-globe-grid">
      <div class="lc-ops-panel lc-globe-panel-visual">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.globeLabel }}</p>
            <h3>{{ activeHotspot.label }}</h3>
            <p>{{ activeHotspot.summary }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeHotspot.tone">{{ activeHotspot.risk }}</span>
        </div>

        <div
          ref="stageRef"
          class="lc-globe-stage"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="handlePointerUp"
          @pointerleave="handlePointerUp"
        >
          <canvas ref="canvasRef" class="lc-globe-canvas" />
          <button
            v-for="marker in markerLayout"
            :key="marker.id"
            class="lc-globe-marker"
            :class="{ 'is-active': marker.id === selectedHotspotId }"
            :style="{ left: `${marker.x}px`, top: `${marker.y}px`, '--marker-scale': String(marker.scale) }"
            type="button"
            @click.stop="selectedHotspotId = marker.id"
          >
            <span class="lc-globe-marker-core"></span>
            <span class="lc-globe-marker-label">{{ marker.label }}</span>
          </button>
          <div class="lc-globe-overlay-note">
            <span>{{ copy.dragHint }}</span>
            <strong>{{ copy.clickHint }}</strong>
          </div>
        </div>

        <div class="lc-map-caption-row">
          <div class="lc-map-caption">
            <span>{{ copy.windowLabel }}</span>
            <strong>{{ activeHotspot.window }}</strong>
          </div>
          <div class="lc-map-caption">
            <span>{{ copy.pathLabel }}</span>
            <strong>{{ activeHotspot.path }}</strong>
          </div>
          <div class="lc-map-caption">
            <span>{{ copy.assetsLabel }}</span>
            <strong>{{ activeHotspot.assets.join(' / ') }}</strong>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel lc-ops-panel-strong lc-globe-panel-detail">
        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.theaterLabel }}</span>
            <strong>{{ activeHotspot.theater }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.signalLabel }}</span>
            <strong>{{ activeHotspot.signalMix }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.triggerLabel }}</span>
            <strong>{{ activeHotspot.trigger }}</strong>
          </div>
        </div>

        <div v-if="activeSurface === 'brief'" class="lc-ops-subcard">
          <p class="lc-mini-label">{{ copy.briefLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="line in activeHotspot.guidance" :key="line">{{ line }}</li>
          </ul>
          <p class="lc-mini-label lc-mini-label-tight">{{ copy.eventsLabel }}</p>
          <div class="lc-feed-list">
            <div v-for="event in activeHotspot.events" :key="event" class="lc-static-card">{{ event }}</div>
          </div>
        </div>

        <div v-else-if="activeSurface === 'relations'" class="lc-ops-subcard">
          <p class="lc-mini-label">{{ copy.relationsLabel }}</p>
          <div class="lc-relation-list">
            <div v-for="relation in activeHotspot.relations" :key="relation.label" class="lc-relation-item">
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
          <p class="lc-mini-label">{{ copy.mockHubLabel }}</p>
          <div class="lc-feed-list">
            <div v-for="card in activeHotspot.hubCards" :key="card.title" class="lc-static-card">
              <strong>{{ card.title }}</strong>
              <p>{{ card.note }}</p>
            </div>
          </div>
          <p class="lc-mini-label lc-mini-label-tight">{{ copy.investmentLabel }}</p>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type LayerId = 'alerts' | 'routes' | 'relations' | 'heat';
type SurfaceId = 'brief' | 'relations' | 'hub';
type Tone = 'critical' | 'elevated' | 'watch';

interface RelationDef { label: string; targetId: string; score: number; note: string }
interface HubCard { title: string; note: string }
interface Hotspot {
  id: string; label: string; lat: number; lon: number; tone: Tone; risk: string; window: string; path: string;
  theater: string; signalMix: string; trigger: string; summary: string; guidance: string[]; events: string[];
  relations: RelationDef[]; hubCards: HubCard[]; idea: { primary: string; hedge: string; horizon: string; note: string }; assets: string[];
}

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

const COPY = {
  en: {
    kicker: 'Interactive globe',
    title: 'Click a 3D globe before you read the docs',
    lead: 'This mock globe mirrors the product surface: alerts, route arcs, relations, and mock hub summaries all change when you click a node.',
    badges: ['Mock data', 'Clickable hotspots', '3D globe demo'],
    layers: [{ id: 'alerts', label: 'Alerts' }, { id: 'routes', label: 'Routes' }, { id: 'relations', label: 'Relations' }, { id: 'heat', label: 'Heat' }],
    surfaces: [{ id: 'brief', label: 'Regional brief' }, { id: 'relations', label: 'Country links' }, { id: 'hub', label: 'Mock hub' }],
    globeLabel: 'Mock operator globe', dragHint: 'Drag to rotate.', clickHint: 'Click a node to open the regional brief.',
    windowLabel: 'Window', pathLabel: 'Impact path', assetsLabel: 'Linked assets', theaterLabel: 'Theater', signalLabel: 'Signal mix',
    triggerLabel: 'Primary trigger', briefLabel: 'Regional guidance', eventsLabel: 'Recent mock events', relationsLabel: 'Country and network links',
    mockHubLabel: 'Internal hub snapshot', investmentLabel: 'Mock investment route', primaryLabel: 'Primary', hedgeLabel: 'Hedge', horizonLabel: 'Best horizon',
  },
  ko: {
    kicker: '인터랙티브 지구본',
    title: '문서를 읽기 전에 3D 지구본부터 눌러볼 수 있게 했습니다',
    lead: '이 mock 지구본은 실제 제품 표면을 따라갑니다. 노드를 클릭하면 알림, 연결선, 관계도, 허브 요약이 함께 바뀝니다.',
    badges: ['가상 데이터', '클릭 가능한 지역', '3D 지구본 데모'],
    layers: [{ id: 'alerts', label: '알림' }, { id: 'routes', label: '경로' }, { id: 'relations', label: '관계' }, { id: 'heat', label: '열지도' }],
    surfaces: [{ id: 'brief', label: '지역 브리프' }, { id: 'relations', label: '국가 연결' }, { id: 'hub', label: '가상 허브' }],
    globeLabel: '가상 운영 지구본', dragHint: '드래그해서 회전합니다.', clickHint: '노드를 클릭하면 지역 브리프가 열립니다.',
    windowLabel: '윈도우', pathLabel: '영향 경로', assetsLabel: '연결 자산', theaterLabel: '전장', signalLabel: '신호 구성',
    triggerLabel: '주요 트리거', briefLabel: '지역 가이던스', eventsLabel: '최근 가상 이벤트', relationsLabel: '국가 및 네트워크 연결',
    mockHubLabel: '내부 허브 스냅샷', investmentLabel: '가상 투자 경로', primaryLabel: '주요 후보', hedgeLabel: '헤지', horizonLabel: '적합 기간',
  },
  ja: {
    kicker: 'インタラクティブ地球儀',
    title: '文書を読む前に 3D グローブを直接触れる構成にしました',
    lead: 'この mock globe は製品の表面を再現します。ノードをクリックすると alert、接続線、関係図、hub summary が一緒に切り替わります。',
    badges: ['モックデータ', 'クリック可能な地域', '3D グローブデモ'],
    layers: [{ id: 'alerts', label: 'Alerts' }, { id: 'routes', label: 'Routes' }, { id: 'relations', label: 'Relations' }, { id: 'heat', label: 'Heat' }],
    surfaces: [{ id: 'brief', label: 'Regional brief' }, { id: 'relations', label: 'Country links' }, { id: 'hub', label: 'Mock hub' }],
    globeLabel: 'Mock operator globe', dragHint: 'ドラッグで回転します。', clickHint: 'ノードをクリックすると地域ブリーフが開きます。',
    windowLabel: 'Window', pathLabel: 'Impact path', assetsLabel: 'Linked assets', theaterLabel: 'Theater', signalLabel: 'Signal mix',
    triggerLabel: 'Primary trigger', briefLabel: 'Regional guidance', eventsLabel: 'Recent mock events', relationsLabel: 'Country and network links',
    mockHubLabel: 'Internal hub snapshot', investmentLabel: 'Mock investment route', primaryLabel: 'Primary', hedgeLabel: 'Hedge', horizonLabel: 'Best horizon',
  },
} as const;

const HOTSPOTS: Hotspot[] = [
  {
    id: 'hormuz', label: 'Hormuz', lat: 26, lon: 56, tone: 'critical', risk: '87', window: '24h to 72h',
    path: 'Shipping stress -> energy shock -> airline hedge', theater: 'Gulf energy corridor', signalMix: 'Maritime 42 / Oil 33 / State media 25',
    trigger: 'Tanker seizure rhetoric', summary: 'Mock Gulf chokepoint node for energy and shipping stress.', assets: ['USO', 'XLE', 'JETS'],
    guidance: ['Watch tanker routing and naval posture together.', 'Separate shipping stress from broader alliance escalation.', 'Energy beta leads before airline hedge.'],
    events: ['Insurers lift tanker premium guidance.', 'Convoy traffic is staggered through the corridor.', 'State media deterrence messaging accelerates.'],
    relations: [{ label: 'Hormuz -> Red Sea reroute', targetId: 'red-sea', score: 84, note: 'Detours amplify freight and insurance costs.' }, { label: 'Hormuz -> Taiwan inflation spillover', targetId: 'taiwan', score: 49, note: 'Energy shock bleeds into global chip and freight pricing.' }],
    hubCards: [{ title: 'Analysis Hub', note: 'Convergence spikes across maritime, energy, and sanctions chatter.' }, { title: 'Backtest Lab', note: 'Mock replay prefers 24h and 72h follow-through for energy-linked baskets.' }],
    idea: { primary: 'USO / XLE long', hedge: 'JETS short', horizon: '24h / 72h', note: 'Mock route assumes shipping friction persists beyond the first headline.' },
  },
  {
    id: 'red-sea', label: 'Red Sea', lat: 20, lon: 39, tone: 'elevated', risk: '74', window: '12h to 72h',
    path: 'Route diversion -> freight stress -> industrial margin pressure', theater: 'Maritime logistics corridor', signalMix: 'Ports 38 / Shipping 34 / Commodity 28',
    trigger: 'Convoy rerouting', summary: 'Mock logistics corridor for shipping, insurance, and importer stress.', assets: ['BDRY', 'XLE', 'IYT'],
    guidance: ['Treat rerouting as a duration problem.', 'Compare freight and insurer commentary before raising the scenario score.', 'Europe-facing industrials absorb the second-order pressure.'],
    events: ['Carriers extend Cape routing guidance.', 'Insurance desks point to a second premium step-up.', 'Industrial importers warn on delivery windows.'],
    relations: [{ label: 'Red Sea -> Hormuz spillover', targetId: 'hormuz', score: 79, note: 'Shared route stress compounds energy sensitivity.' }, { label: 'Red Sea -> Eastern Europe supply route', targetId: 'eastern-europe', score: 46, note: 'Industrial bottlenecks and policy responses begin to overlap.' }],
    hubCards: [{ title: 'Ontology Graph', note: 'Ports, carriers, insurers, and chokepoints form a dense corridor subgraph.' }, { title: 'Resource Profiler', note: 'Container and route layers dominate compute on the live map surface.' }],
    idea: { primary: 'Freight and energy stress basket', hedge: 'Europe transport hedge', horizon: '24h / 168h', note: 'Mock path rewards duration-sensitive route proxies.' },
  },
  {
    id: 'taiwan', label: 'Taiwan Strait', lat: 24, lon: 121, tone: 'critical', risk: '82', window: '24h to 168h',
    path: 'Drill activity -> semi supply chain -> global tech hedge', theater: 'Semiconductor chokepoint', signalMix: 'Military 36 / Chips 34 / Export controls 30',
    trigger: 'Exercise envelope expansion', summary: 'Mock semiconductor theater for military activity, fabs, and export-control stress.', assets: ['SOXX', 'NVDA', 'GLD'],
    guidance: ['Watch fabs and shipping lanes together.', 'Use the mock hub to compare chip beta and safe havens.', 'Expect slower, multi-day validation.'],
    events: ['Exercise notice widens around fab-adjacent lanes.', 'Supplier commentary points to longer inspection windows.', 'Memory and equipment baskets start to rerate.'],
    relations: [{ label: 'Taiwan -> Silicon Valley AI route', targetId: 'silicon', score: 78, note: 'AI capex inherits fab concentration risk.' }, { label: 'Taiwan -> Hormuz inflation echo', targetId: 'hormuz', score: 49, note: 'Semiconductor and energy shocks can reinforce each other.' }],
    hubCards: [{ title: 'Codex Hub', note: 'Suggests missing semi, memory, and equipment proxies when coverage gaps appear.' }, { title: 'Backtest Lab', note: 'Mock replay prefers 72h and 168h for semiconductor dislocation themes.' }],
    idea: { primary: 'SOXX / semi hedge rotation', hedge: 'GLD or duration', horizon: '72h / 168h', note: 'Mock route favors multi-session supply-chain repricing.' },
  },
  {
    id: 'eastern-europe', label: 'Eastern Europe', lat: 49, lon: 31, tone: 'elevated', risk: '71', window: '24h to 168h',
    path: 'Military posture -> defense rerating -> sanctions extension', theater: 'Security posture theater', signalMix: 'Defense 43 / Policy 31 / Energy 26',
    trigger: 'Air and missile posture shift', summary: 'Mock security theater for posture, defense beta, and sanctions overhang.', assets: ['ITA', 'XAR', 'IEF'],
    guidance: ['Use posture plus logistics degradation together.', 'This node is better for defense baskets than broad market calls.', 'Multi-day horizons dominate when posture and sanctions align.'],
    events: ['Defense names lift on posture shift.', 'Rail and energy infrastructure chatter extends stress.', 'Policy desks prepare another sanctions round.'],
    relations: [{ label: 'Eastern Europe -> Red Sea logistics route', targetId: 'red-sea', score: 46, note: 'Industrial bottlenecks and policy responses can overlap.' }, { label: 'Eastern Europe -> Taiwan defense watch', targetId: 'taiwan', score: 41, note: 'Security theaters share defense and sanction attention.' }],
    hubCards: [{ title: 'Analysis Hub', note: 'Defense beta rises when posture and logistics degradation align.' }, { title: 'Backtest Lab', note: 'Mock replay favors 72h and 168h for defense rerating themes.' }],
    idea: { primary: 'ITA / defense basket', hedge: 'Rates hedge', horizon: '72h / 168h', note: 'Mock route stays focused on posture-sensitive defense proxies.' },
  },
];

const copy = computed(() => COPY[props.locale]);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const selectedHotspotId = ref('hormuz');
const activeLayers = ref<LayerId[]>(['alerts', 'routes', 'relations', 'heat']);
const activeSurface = ref<SurfaceId>('brief');
const markerLayout = ref<Array<{ id: string; label: string; x: number; y: number; scale: number }>>([]);
const activeHotspot = computed(() => HOTSPOTS.find((item) => item.id === selectedHotspotId.value) || HOTSPOTS[0]);

let rotation = -0.8;
let dragging = false;
let pointerStartX = 0;
let animationFrame = 0;
let resizeObserver: ResizeObserver | null = null;

function toggleLayer(layer: LayerId): void {
  const next = new Set(activeLayers.value);
  next.has(layer) ? next.delete(layer) : next.add(layer);
  activeLayers.value = Array.from(next) as LayerId[];
}

function project(latDeg: number, lonDeg: number, width: number, height: number) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const x3 = Math.cos(lat) * Math.sin(lon + rotation);
  const y3 = Math.sin(lat);
  const z3 = Math.cos(lat) * Math.cos(lon + rotation);
  const radius = Math.min(width, height) * 0.32;
  return { visible: z3 > 0, x: width * 0.5 + radius * x3, y: height * 0.53 - radius * y3, z: z3, radius };
}

function drawArc(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, width: number, alpha: number): void {
  const midX = (from.x + to.x) * 0.5;
  const midY = (from.y + to.y) * 0.5 - Math.min(120, width * 0.08);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(midX, midY, to.x, to.y);
  ctx.strokeStyle = `rgba(116, 208, 255, ${alpha})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function renderGlobe(): void {
  const canvas = canvasRef.value;
  const stage = stageRef.value;
  if (!canvas || !stage) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const { radius } = project(0, 0, width, height);
  const cx = width * 0.5;
  const cy = height * 0.53;

  const glow = ctx.createRadialGradient(cx - radius * 0.2, cy - radius * 0.3, radius * 0.1, cx, cy, radius * 1.18);
  glow.addColorStop(0, 'rgba(86, 182, 255, 0.30)');
  glow.addColorStop(1, 'rgba(2, 8, 18, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.4, 0, Math.PI * 2);
  ctx.fill();

  const globe = ctx.createRadialGradient(cx - radius * 0.24, cy - radius * 0.36, radius * 0.22, cx, cy, radius);
  globe.addColorStop(0, 'rgba(78, 171, 255, 0.94)');
  globe.addColorStop(0.38, 'rgba(18, 64, 126, 0.98)');
  globe.addColorStop(1, 'rgba(5, 15, 31, 1)');
  ctx.fillStyle = globe;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  if (activeLayers.value.includes('heat')) {
    for (const item of HOTSPOTS) {
      const point = project(item.lat, item.lon, width, height);
      if (!point.visible) continue;
      const heat = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 34 + point.z * 18);
      heat.addColorStop(0, item.tone === 'critical' ? 'rgba(255, 105, 79, 0.24)' : 'rgba(255, 196, 87, 0.18)');
      heat.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = heat;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 34 + point.z * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = 'rgba(144, 198, 255, 0.18)';
  ctx.lineWidth = 1;
  for (let lon = -150; lon <= 150; lon += 30) {
    ctx.beginPath();
    let started = false;
    for (let lat = -80; lat <= 80; lat += 4) {
      const point = project(lat, lon, width, height);
      if (!point.visible) { started = false; continue; }
      if (!started) { ctx.moveTo(point.x, point.y); started = true; } else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 20) {
    ctx.beginPath();
    let started = false;
    for (let lon = -180; lon <= 180; lon += 4) {
      const point = project(lat, lon, width, height);
      if (!point.visible) { started = false; continue; }
      if (!started) { ctx.moveTo(point.x, point.y); started = true; } else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }

  if (activeLayers.value.includes('routes') || activeLayers.value.includes('relations')) {
    const current = activeHotspot.value;
    const from = project(current.lat, current.lon, width, height);
    for (const relation of current.relations) {
      const target = HOTSPOTS.find((item) => item.id === relation.targetId);
      if (!target) continue;
      const to = project(target.lat, target.lon, width, height);
      if (!from.visible && !to.visible) continue;
      drawArc(ctx, from, to, width, activeLayers.value.includes('relations') ? 0.18 + relation.score / 140 : 0.12 + relation.score / 220);
    }
  }

  ctx.restore();

  markerLayout.value = HOTSPOTS
    .map((item) => {
      const point = project(item.lat, item.lon, width, height);
      return point.visible ? { id: item.id, label: item.label, x: point.x, y: point.y, scale: 0.84 + point.z * 0.44 } : null;
    })
    .filter((item): item is { id: string; label: string; x: number; y: number; scale: number } => Boolean(item));

  if (!dragging) rotation += 0.0035;
  animationFrame = window.requestAnimationFrame(renderGlobe);
}

function handlePointerDown(event: PointerEvent): void { dragging = true; pointerStartX = event.clientX; }
function handlePointerMove(event: PointerEvent): void {
  if (!dragging) return;
  const delta = event.clientX - pointerStartX;
  rotation += delta * 0.0022;
  pointerStartX = event.clientX;
}
function handlePointerUp(): void { dragging = false; }

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(animationFrame);
    renderGlobe();
  });
  if (stageRef.value) resizeObserver.observe(stageRef.value);
  renderGlobe();
});

onBeforeUnmount(() => {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
});
</script>
