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
        v-for="layer in layers"
        :key="layer.id"
        class="lc-topology-layer"
        :class="{ 'is-active': layer.id === activeId }"
        type="button"
        @click="activeId = layer.id"
      >
        <div class="lc-topology-layer-head">
          <strong>{{ labelFor(layer.id) }}</strong>
          <span>{{ layer.runtime }}</span>
        </div>
        <p>{{ layer.summary }}</p>
        <div class="lc-chip-row">
          <span v-for="node in layer.nodes" :key="node.id" class="lc-chip">{{ node.title }}</span>
        </div>
      </button>
    </div>

    <div class="lc-topology-detail">
      <div class="lc-topology-main">
        <p class="lc-kicker">{{ active.runtime }}</p>
        <h3>{{ labelFor(active.id) }}</h3>
        <p>{{ active.body }}</p>

        <div class="lc-link-block">
          <p class="lc-mini-label">{{ current.responsibilitiesLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="item in active.responsibilities" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="lc-link-block">
          <p class="lc-mini-label">{{ current.nodesLabel }}</p>
          <div class="lc-link-row">
            <button
              v-for="node in active.nodes"
              :key="node.id"
              class="lc-link-pill lc-link-pill-button"
              :class="{ 'is-active': node.id === activeNodeId }"
              type="button"
              @click="activeNodeId = node.id"
            >
              {{ node.title }}
            </button>
          </div>
        </div>

        <article class="lc-topology-node-detail">
          <p class="lc-mini-label">{{ current.ownedNodeLabel }}</p>
          <h4>{{ activeNode.title }}</h4>
          <p>{{ activeNode.summary }}</p>
        </article>
      </div>

      <div class="lc-topology-side">
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.flowsLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="flow in active.flows" :key="flow">{{ flow }}</li>
          </ul>
        </div>

        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.storageLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="item in active.storage" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ current.securityLabel }}</p>
          <ul class="lc-topology-list">
            <li v-for="item in active.security" :key="item">{{ item }}</li>
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
import { computed, ref, watch } from 'vue';

type Locale = 'en' | 'ko' | 'ja';
type NodeDetail = { id: string; title: string; summary: string };
type Layer = {
  id: string;
  runtime: string;
  summary: string;
  body: string;
  nodes: NodeDetail[];
  flows: string[];
  responsibilities: string[];
  storage: string[];
  security: string[];
  links: { label: string; href: string }[];
};

type UiCopy = {
  kicker: string;
  title: string;
  lead: string;
  badges: string[];
  nodesLabel: string;
  ownedNodeLabel: string;
  responsibilitiesLabel: string;
  flowsLabel: string;
  storageLabel: string;
  securityLabel: string;
  docsLabel: string;
  layerLabels: Record<string, string>;
};

const props = withDefaults(defineProps<{ locale?: Locale }>(), { locale: 'en' });

function withLocale(locale: Locale, route: string) {
  return locale === 'en' ? route : `/${locale}${route}`;
}

const ui: Record<Locale, UiCopy> = {
  en: {
    kicker: 'System topology',
    title: 'Click a layer to see where it runs and what it owns',
    lead: 'This view compresses the stack into interface, analytics, graph, replay, and storage. Clicking a layer now exposes owned nodes, storage boundaries, and security boundaries.',
    badges: ['Frontend', 'Sidecar', 'Historical archive'],
    nodesLabel: 'Owned nodes',
    ownedNodeLabel: 'Node detail',
    responsibilitiesLabel: 'Responsibilities',
    flowsLabel: 'Main flows',
    storageLabel: 'State and storage boundary',
    securityLabel: 'Security and ops boundary',
    docsLabel: 'Related docs',
    layerLabels: {
      interface: 'Interface layer',
      analytics: 'Analytics layer',
      graph: 'Graph and ontology layer',
      historical: 'Historical replay layer',
      storage: 'Storage and local runtime'
    }
  },
  ko: {
    kicker: '시스템 토폴로지',
    title: '레이어를 클릭하면 어디서 돌고 무엇을 담당하는지 볼 수 있습니다',
    lead: '인터페이스, 분석, 그래프, 리플레이, 저장 계층을 한 번에 보여주고, 클릭 시 책임과 저장/보안 경계까지 드러냅니다.',
    badges: ['프론트엔드', 'Sidecar', '히스토리컬 아카이브'],
    nodesLabel: '소유 노드',
    ownedNodeLabel: '노드 상세',
    responsibilitiesLabel: '핵심 책임',
    flowsLabel: '주요 흐름',
    storageLabel: '상태 · 저장 경계',
    securityLabel: '보안 · 운영 경계',
    docsLabel: '관련 문서',
    layerLabels: {
      interface: '인터페이스 계층',
      analytics: '분석 계층',
      graph: '그래프 · 온톨로지 계층',
      historical: '히스토리컬 리플레이 계층',
      storage: '저장 · 로컬 런타임 계층'
    }
  },
  ja: {
    kicker: 'System topology',
    title: 'Click a layer to inspect runtime, ownership, and boundaries',
    lead: 'This locale uses the same interactive topology while the deeper technical copy stays aligned with the English source.',
    badges: ['Frontend', 'Sidecar', 'Historical archive'],
    nodesLabel: 'Owned nodes',
    ownedNodeLabel: 'Node detail',
    responsibilitiesLabel: 'Responsibilities',
    flowsLabel: 'Main flows',
    storageLabel: 'State and storage boundary',
    securityLabel: 'Security and ops boundary',
    docsLabel: 'Related docs',
    layerLabels: {
      interface: 'Interface layer',
      analytics: 'Analytics layer',
      graph: 'Graph and ontology layer',
      historical: 'Historical replay layer',
      storage: 'Storage and local runtime'
    }
  }
};

const current = computed(() => ui[props.locale]);
const links = computed(() => ({
  arch: withLocale(props.locale, '/architecture'),
  features: withLocale(props.locale, '/features/'),
  ai: withLocale(props.locale, '/ai-backtesting/'),
  api: withLocale(props.locale, '/api'),
  algorithms: withLocale(props.locale, '/algorithms'),
  server: 'https://github.com/cheesss/lattice-current/blob/main/docs/service-server-plan.md'
}));

const layers = computed<Layer[]>(() => [
  {
    id: 'interface',
    runtime: 'Browser / desktop shell',
    summary: 'Panels, maps, overlays, and operator navigation.',
    body: 'The operator surface renders maps, panels, hover states, replay controls, and focus-preserving navigation. It should stay responsive while exposing high-density signals.',
    nodes: [
      { id: 'panel-layout', title: 'panel layout', summary: 'Owns panel composition, variants, and shell mounts.' },
      { id: 'map-container', title: 'map container', summary: 'Owns map lifecycle, layer toggles, and theater focus.' },
      { id: 'analysis-hub', title: 'analysis hub', summary: 'Cross-panel synthesis, AI summaries, and operator review.' }
    ],
    flows: ['renders normalized state', 'routes focus and click events', 'surfaces alerts and replay outputs'],
    responsibilities: ['keep variants coherent', 'preserve context across pivots', 'keep dense data readable'],
    storage: ['short-lived browser state and UI preferences', 'desktop shell bridges into sidecar-only actions'],
    security: ['never expose credentials client-side', 'use sanitized public screenshots only', 'avoid leaking local-only endpoints'],
    links: [
      { label: 'Architecture', href: links.value.arch },
      { label: 'Features', href: links.value.features }
    ]
  },
  {
    id: 'analytics',
    runtime: 'TypeScript services',
    summary: 'Scoring, credibility, transmission, and investment logic.',
    body: 'Analytics turns normalized events into credibility, instability, transmission paths, regime-aware investment ideas, and replay-ready summaries.',
    nodes: [
      { id: 'source-credibility', title: 'source credibility', summary: 'Corroboration, posterior updates, and propaganda penalties.' },
      { id: 'country-instability', title: 'country instability', summary: 'Aggregates unrest, conflict, security, and information velocity.' },
      { id: 'event-transmission', title: 'event transmission', summary: 'Maps events into assets, sectors, and macro channels.' }
    ],
    flows: ['consumes events, clusters, and market snapshots', 'produces scores and paths', 'feeds both live UI and replay'],
    responsibilities: ['convert noise into weighted signals', 'update adaptive priors', 'stay evidence-linked and reviewable'],
    storage: ['persistent cache for scores and priors', 'optional Postgres / Timescale persistence'],
    security: ['resolve secrets server-side or in sidecar', 'enforce rate limits', 'keep model outputs auditable'],
    links: [
      { label: 'Algorithms', href: links.value.algorithms },
      { label: 'AI & Backtesting', href: links.value.ai },
      { label: 'Server plan', href: links.value.server }
    ]
  },
  {
    id: 'graph',
    runtime: 'Client analysis + persisted snapshots',
    summary: 'Entity resolution, constraints, graph slices, and STIX/export views.',
    body: 'The graph layer explains relationship structure, accepted versus rejected links, and time-sliced graph state for replay and audit.',
    nodes: [
      { id: 'entity-ontology', title: 'entity ontology', summary: 'Canonical IDs, alias merge/split, and typed entities.' },
      { id: 'keyword-registry', title: 'keyword registry', summary: 'Term extraction, filters, promotion rules, and phrase suppression.' },
      { id: 'ontology-graph', title: 'ontology graph', summary: 'Constraint-aware visible graph, event reification, and snapshots.' }
    ],
    flows: ['normalizes aliases into canonical state', 'enforces relation grammar', 'feeds AI, transmission, and replay context'],
    responsibilities: ['keep graph state interpretable', 'show accepted/inferred/rejected links', 'preserve graph history'],
    storage: ['graph snapshots, event ledgers, optional STIX bundles', 'persisted graph timeslices for replay previews'],
    security: ['avoid high-confidence inference from low-confidence evidence', 'sanitize provenance in public exports', 'respect PiT boundaries'],
    links: [
      { label: 'Architecture', href: links.value.arch },
      { label: 'Algorithms', href: links.value.algorithms }
    ]
  },
  {
    id: 'historical',
    runtime: 'Local jobs + archive adapters',
    summary: 'Point-in-time replay, walk-forward validation, and archive sync.',
    body: 'Historical services import past data, enforce point-in-time constraints, run replay jobs, and preserve backtest traces for comparison.',
    nodes: [
      { id: 'historical-importer', title: 'historical importer', summary: 'Builds replay-safe frames with bitemporal boundaries and warm-up handling.' },
      { id: 'walk-forward-runner', title: 'walk-forward runner', summary: 'Splits train/validate/test windows and records outcome-aware runs.' },
      { id: 'archive-adapters', title: 'archive adapters', summary: 'Write runs into DuckDB cold storage and optional Postgres.' }
    ],
    flows: ['loads replay frames under valid and transaction time', 'updates priors from outcomes', 'stores run summaries and forward returns'],
    responsibilities: ['prevent look-ahead bias', 'separate warm-up from evaluation', 'make validation reproducible'],
    storage: ['DuckDB for local cold archive', 'Postgres / Timescale for shared run history'],
    security: ['preserve PiT integrity', 'use bounded-memory chunked ingest', 'authenticate replay endpoints before service exposure'],
    links: [
      { label: 'AI & Backtesting', href: links.value.ai },
      { label: 'API', href: links.value.api },
      { label: 'Server plan', href: links.value.server }
    ]
  },
  {
    id: 'storage',
    runtime: 'IndexedDB / local sidecar / optional Postgres',
    summary: 'Persistent cache, archive files, resource telemetry, and local APIs.',
    body: 'Storage and runtime services preserve caches, snapshots, archives, resource stats, and sidecar endpoints across sessions and long-running jobs.',
    nodes: [
      { id: 'persistent-cache', title: 'persistent cache', summary: 'Durable UI state, scores, preferences, and learned stats.' },
      { id: 'duckdb-archive', title: 'DuckDB archive', summary: 'Local cold store for frames, runs, and replay outputs.' },
      { id: 'local-api-server', title: 'local API server', summary: 'Desktop-only jobs, archive access, replay controls, and telemetry.' }
    ],
    flows: ['stores caches and replay runs between sessions', 'bridges desktop-only features into UI', 'reports archive and memory pressure'],
    responsibilities: ['make the system recoverable', 'provide observability', 'support local and service-backed persistence'],
    storage: ['IndexedDB and persistent cache', 'DuckDB files', 'optional Postgres / Timescale'],
    security: ['do not commit DB credentials or tokens', 'define backup and retention before service launch', 'apply auth, audit, and quotas to archive APIs'],
    links: [
      { label: 'Architecture', href: links.value.arch },
      { label: 'API', href: links.value.api },
      { label: 'Server plan', href: links.value.server }
    ]
  }
]);

const activeId = ref('interface');
const activeNodeId = ref('panel-layout');
const active = computed(() => layers.value.find((layer) => layer.id === activeId.value) ?? layers.value[0]);
const activeNode = computed(() => active.value.nodes.find((node) => node.id === activeNodeId.value) ?? active.value.nodes[0]);
const labelFor = (id: string) => current.value.layerLabels[id] ?? id;

watch(
  active,
  (next) => {
    activeNodeId.value = next.nodes[0]?.id ?? '';
  },
  { immediate: true }
);
</script>

<style scoped>
.lc-section{position:relative;margin:28px 0;padding:24px;border-radius:24px;border:1px solid rgba(96,165,250,.18);background:radial-gradient(circle at top left,rgba(45,212,191,.12),transparent 34%),radial-gradient(circle at bottom right,rgba(251,191,36,.12),transparent 34%),linear-gradient(180deg,rgba(8,15,29,.95),rgba(15,23,42,.92));box-shadow:0 24px 72px rgba(2,6,23,.24)}
.lc-section-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}
.lc-kicker{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#8fd1ff}.lc-section-head h2{margin:4px 0 8px}
.lc-badge-row,.lc-chip-row,.lc-link-row{display:flex;gap:8px;flex-wrap:wrap}
.lc-badge,.lc-chip,.lc-link-pill{display:inline-flex;align-items:center;padding:7px 12px;border-radius:999px;font-size:12px;border:1px solid rgba(148,163,184,.24);background:rgba(148,163,184,.08)}
.lc-link-pill{text-decoration:none;color:inherit}.lc-link-pill-button{color:inherit;cursor:pointer}.lc-link-pill-button.is-active{background:rgba(45,212,191,.12);border-color:rgba(45,212,191,.36)}
.lc-topology-stack{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:18px}
.lc-topology-layer{text-align:left;border:1px solid rgba(148,163,184,.14);border-radius:18px;padding:16px;background:rgba(15,23,42,.58);color:inherit;cursor:pointer;transition:transform 160ms ease,border-color 160ms ease,background 160ms ease,box-shadow 160ms ease}
.lc-topology-layer:hover,.lc-topology-layer.is-active{transform:translateY(-2px);border-color:rgba(45,212,191,.36);background:rgba(30,41,59,.92);box-shadow:0 12px 30px rgba(15,23,42,.28)}
.lc-topology-layer-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:10px}.lc-topology-layer-head span{font-size:12px;color:#8fd1ff}
.lc-topology-detail{display:grid;gap:16px;grid-template-columns:minmax(0,1.35fr) minmax(280px,.95fr)}
.lc-topology-main,.lc-mini-card{border:1px solid rgba(148,163,184,.14);border-radius:18px;padding:18px;background:rgba(15,23,42,.55)}
.lc-topology-main h3{margin-top:6px}.lc-topology-side{display:grid;gap:12px}.lc-link-block{margin-top:18px}
.lc-mini-label{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24}
.lc-topology-list{margin:0;padding-left:18px}.lc-topology-list li+li{margin-top:6px}
.lc-topology-node-detail{margin-top:18px;padding:18px;border-radius:18px;border:1px solid rgba(45,212,191,.18);background:linear-gradient(180deg,rgba(15,23,42,.7),rgba(15,23,42,.52))}.lc-topology-node-detail h4{margin:6px 0 10px}
@media (max-width:860px){.lc-section-head,.lc-topology-detail{display:grid;grid-template-columns:1fr}}
</style>
