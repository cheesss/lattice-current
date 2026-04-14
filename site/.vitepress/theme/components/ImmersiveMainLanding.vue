<template>
  <div class="lc-prime-landing dark-mode-enforced">
    <!-- Ambient Background -->
    <div class="lc-ambient-bg"></div>
    <div class="lc-ambient-mesh"></div>

    <section class="lc-prime-band lc-prime-band-hero">
      <div class="lc-prime-breakout lc-prime-hero-grid">
        <div class="lc-prime-hero-copy">
          <p class="lc-prime-kicker reveal-up">{{ copy.heroKicker }}</p>
          <h1 class="reveal-up delay-1">{{ copy.heroTitle }}</h1>
          <p class="lc-prime-lead reveal-up delay-2">{{ copy.heroLead }}</p>

          <div class="lc-prime-button-row reveal-up delay-3">
            <a class="lc-prime-button lc-prime-button-brand" :href="copy.primaryHref">{{ copy.primaryCta }}</a>
            <a class="lc-prime-button" :href="copy.secondaryHref">{{ copy.secondaryCta }}</a>
          </div>

          <div class="lc-prime-stat-ribbon reveal-up delay-4">
            <div v-for="item in copy.heroStats" :key="item.label" class="lc-prime-stat-chip glass-panel glass-hover">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </div>

        <div class="lc-prime-hero-visual reveal-up delay-5">
          <div class="lc-prime-abstract-visual">
            <div class="lc-prime-floating-card lc-prime-floating-card-a glass-panel float-anim-1">
              <span>{{ copy.floatA.kicker }}</span>
              <strong>{{ copy.floatA.title }}</strong>
              <p>{{ copy.floatA.note }}</p>
            </div>

            <div class="lc-prime-floating-card lc-prime-floating-card-b glass-panel float-anim-2">
              <span>{{ copy.floatB.kicker }}</span>
              <strong>{{ copy.floatB.title }}</strong>
              <p>{{ copy.floatB.note }}</p>
            </div>

            <div class="lc-prime-floating-card lc-prime-floating-card-c glass-panel float-anim-3">
              <span>{{ copy.floatC.kicker }}</span>
              <strong>{{ copy.floatC.title }}</strong>
              <p>{{ copy.floatC.note }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-theater">
      <div class="lc-prime-breakout lc-prime-theater-head reveal-scroll">
        <div>
          <p class="lc-prime-kicker">{{ copy.theaterKicker }}</p>
          <h2>{{ copy.theaterTitle }}</h2>
        </div>
        <p>{{ copy.theaterLead }}</p>
      </div>

      <div class="lc-prime-breakout reveal-scroll">
        <div class="glass-panel spotlight-container p-0">
          <SignalLandingHero :locale="locale" />
        </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-story">
      <div class="lc-prime-breakout lc-prime-story-grid">
        <div class="lc-prime-story-column reveal-scroll">
          <p class="lc-prime-kicker">{{ copy.storyKicker }}</p>
          <h2>{{ copy.storyTitle }}</h2>
          <p class="lc-prime-story-lead">{{ copy.storyLead }}</p>
        </div>

        <div class="lc-prime-story-panels reveal-scroll">
          <article v-for="panel in copy.storyPanels" :key="panel.title" class="lc-prime-story-panel glass-panel glass-hover">
            <span>{{ panel.kicker }}</span>
            <strong>{{ panel.title }}</strong>
            <p>{{ panel.note }}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-globe">
      <div class="lc-prime-breakout lc-prime-section-head reveal-scroll">
        <div>
          <p class="lc-prime-kicker">{{ copy.mapKicker }}</p>
          <h2>{{ copy.mapTitle }}</h2>
        </div>
        <p>{{ copy.mapLead }}</p>
      </div>
      <div class="lc-prime-breakout reveal-scroll">
         <div class="glass-panel spotlight-container p-0">
           <AppGradeGlobeShowcase :locale="locale" />
         </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-control">
      <div class="lc-prime-breakout lc-prime-control-grid">
        <div class="lc-prime-control-copy reveal-scroll">
          <p class="lc-prime-kicker">{{ copy.controlKicker }}</p>
          <h2>{{ copy.controlTitle }}</h2>
          <p>{{ copy.controlLead }}</p>
          <div class="lc-prime-marquee" aria-hidden="true">
            <span v-for="item in copy.marquee" :key="item" class="glass-badge">{{ item }}</span>
          </div>
        </div>
        <div class="lc-prime-control-panel glass-panel spotlight-container p-0 reveal-scroll">
          <OperationsConsoleDemo />
        </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-replay">
      <div class="lc-prime-breakout lc-prime-section-head reveal-scroll">
        <div>
          <p class="lc-prime-kicker">{{ copy.replayKicker }}</p>
          <h2>{{ copy.replayTitle }}</h2>
        </div>
        <p>{{ copy.replayLead }}</p>
      </div>
      <div class="lc-prime-breakout reveal-scroll">
        <div class="glass-panel spotlight-container p-0">
          <ReplayScenarioWorkbench :locale="locale" />
        </div>
      </div>
    </section>

    <section class="lc-prime-band lc-prime-band-route">
      <div class="lc-prime-breakout lc-prime-route-shell glass-panel spotlight-container reveal-scroll">
        <div class="lc-prime-section-head">
          <div>
            <p class="lc-prime-kicker">{{ copy.routeKicker }}</p>
            <h2>{{ copy.routeTitle }}</h2>
          </div>
          <p>{{ copy.routeLead }}</p>
        </div>

        <div class="lc-prime-route-grid">
          <a v-for="item in copy.links" :key="item.href" class="lc-prime-route-card glass-panel glass-hover" :href="item.href">
            <span>{{ item.kicker }}</span>
            <strong>{{ item.title }}</strong>
            <p>{{ item.note }}</p>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type LocaleCode = 'en' | 'ko' | 'ja';

const props = withDefaults(defineProps<{ locale?: LocaleCode }>(), {
  locale: 'en',
});

const locale = computed<LocaleCode>(() => props.locale);

const localized = {
  en: {
    heroKicker: 'Event-driven alpha research',
    heroTitle: 'From news events to statistically validated trading signals',
    heroLead:
      'Lattice Current ingests 40+ real-time news sources, clusters articles into canonical events, measures abnormal returns against matched controls, and predicts alpha probability with a multi-task neural network.',
    primaryCta: 'Open Playground',
    primaryHref: '/lattice-current/playground',
    secondaryCta: 'Read Architecture',
    secondaryHref: '/lattice-current/architecture',
    heroStats: [
      { label: 'News sources', value: '40+' },
      { label: 'Canonical events', value: '53,734' },
      { label: 'Evidence-graded outcomes', value: '116k+' },
    ],
    floatA: {
      kicker: 'Canonical events',
      title: 'Deduplicate before you analyze',
      note: '10 articles about the same event become 1 canonical cluster. No more sample inflation.',
    },
    floatB: {
      kicker: 'Abnormal returns',
      title: 'Alpha, not raw return',
      note: 'Every outcome subtracts market and sector benchmarks. Only excess return counts.',
    },
    floatC: {
      kicker: 'Counterfactual controls',
      title: 'Compare against days without the event',
      note: 'Matched control days (same weekday, similar VIX/yield spread) measure true causal uplift.',
    },
    theaterKicker: 'Live dashboard',
    theaterTitle: 'One surface for signals, evidence grades, and geo context',
    theaterLead:
      'The event dashboard combines KPI strips, analytics charts, theme briefs, and an interactive geo lens into a single operational view.',
    storyKicker: 'How it works',
    storyTitle: 'Three layers turn noise into validated signals',
    storyLead:
      'Rules and statistics generate features, a meta-model learns the final prediction, and counterfactual validation grades the evidence.',
    storyPanels: [
      {
        kicker: 'Layer 1',
        title: '60 statistical formulas as features',
        note: 'Hawkes process, HMM regime, Kalman filter, transfer entropy, contextual bandits, and more — each produces a feature, not a final score.',
      },
      {
        kicker: 'Layer 2',
        title: 'Multi-task meta-model',
        note: 'A PyTorch MLP takes 17 features and simultaneously predicts P(alpha>0), E[alpha], downside risk, and time-to-peak.',
      },
      {
        kicker: 'Layer 3',
        title: 'Counterfactual evidence grading',
        note: 'Each event is compared against matched control days. Evidence grades range from E0 (noise) to E4 (mechanism confirmed).',
      },
    ],
    mapKicker: 'Geospatial context',
    mapTitle: 'Events mapped to their geographic and financial impact zones',
    mapLead:
      'The 2D geo lens shows event hotspots, transmission arcs to affected markets, and theme-filtered overlays with LOD-optimized rendering.',
    controlKicker: 'Pipeline automation',
    controlTitle: 'Continuous ingestion, analysis, and model updates',
    controlLead:
      'A 5-minute daemon runs the full pipeline: data collection, classification, event engine, Codex proposals, and signal snapshots. Python handles heavy compute; TypeScript orchestrates.',
    marquee: ['Canonical events', 'Abnormal returns', 'Matched controls', 'Evidence grades', 'Meta-model', 'NAS PostgreSQL'],
    replayKicker: 'Validation',
    replayTitle: 'Purged walk-forward cross-validation prevents overfitting',
    replayLead:
      'Event group splits, 14-day purge gaps, and inverse-frequency weighting ensure out-of-sample integrity. Current OOS Brier score: 0.216.',
    routeKicker: 'Documentation',
    routeTitle: 'Explore the technical details',
    routeLead:
      'Architecture docs, algorithm references, and API specifications for developers and researchers.',
    links: [
      {
        kicker: 'Playground',
        title: 'Interactive demo',
        note: 'Explore the dashboard, geo lens, and signal flow in the public workbench.',
        href: '/lattice-current/playground',
      },
      {
        kicker: 'Features',
        title: 'Platform capabilities',
        note: 'Full breakdown of ingestion, analysis, prediction, and validation features.',
        href: '/lattice-current/features/',
      },
      {
        kicker: 'Models & Validation',
        title: 'Meta-model and evidence system',
        note: 'Training methodology, model comparison, and evidence ladder specification.',
        href: '/lattice-current/ai-backtesting/',
      },
      {
        kicker: 'Architecture',
        title: 'System design and data flow',
        note: 'TypeScript/Python boundary, NAS storage, pipeline orchestration, and desktop runtime.',
        href: '/lattice-current/architecture',
      },
    ],
  },
  ko: {
    heroKicker: '이벤트 기반 알파 리서치',
    heroTitle: '뉴스 이벤트에서 통계적으로 검증된 트레이딩 시그널까지',
    heroLead:
      'Lattice Current는 40개+ 실시간 뉴스 소스에서 기사를 수집하고, 캐노니컬 이벤트로 클러스터링한 뒤, 대조군 대비 초과수익률을 측정하고, 멀티태스크 신경망으로 알파 확률을 예측합니다.',
    primaryCta: '플레이그라운드 열기',
    primaryHref: '/lattice-current/ko/playground',
    secondaryCta: '아키텍처 보기',
    secondaryHref: '/lattice-current/ko/architecture',
    heroStats: [
      { label: '뉴스 소스', value: '40+' },
      { label: '캐노니컬 이벤트', value: '53,734' },
      { label: '검증된 아웃컴', value: '116k+' },
    ],
    floatA: {
      kicker: '캐노니컬 이벤트',
      title: '분석 전에 중복을 제거한다',
      note: '같은 사건에 대한 기사 10개가 1개의 캐노니컬 클러스터로 합쳐진다. 샘플 부풀림 방지.',
    },
    floatB: {
      kicker: '초과수익률',
      title: 'raw return이 아니라 alpha',
      note: '모든 아웃컴에서 시장·섹터 벤치마크를 차감한다. 순수 초과수익만 측정.',
    },
    floatC: {
      kicker: '반사실 대조군',
      title: '이벤트 없는 날과 비교한다',
      note: '같은 요일, 비슷한 VIX/금리차의 대조군 날짜와 매칭하여 인과적 uplift를 추정.',
    },
    theaterKicker: '실시간 대시보드',
    theaterTitle: '시그널, 증거 등급, 지리 맥락을 하나의 화면에서',
    theaterLead:
      '이벤트 대시보드가 KPI 스트립, 분석 차트, 테마 브리프, 인터랙티브 지도를 하나의 운영 뷰로 통합합니다.',
    storyKicker: '작동 원리',
    storyTitle: '3개 레이어가 노이즈를 검증된 시그널로 바꾼다',
    storyLead:
      '규칙과 통계가 피처를 생성하고, 메타모델이 최종 예측을 학습하고, 반사실 검증이 증거를 등급화합니다.',
    storyPanels: [
      { kicker: '레이어 1', title: '60개 통계 수식을 피처로', note: 'Hawkes, HMM, Kalman, transfer entropy, contextual bandit 등 — 각각이 점수가 아닌 피처를 생성.' },
      { kicker: '레이어 2', title: '멀티태스크 메타모델', note: 'PyTorch MLP가 17개 피처로 P(alpha>0), E[alpha], 하방 리스크, time-to-peak을 동시 예측.' },
      { kicker: '레이어 3', title: '반사실 증거 등급', note: '각 이벤트를 대조군 날짜와 비교. E0(노이즈)에서 E4(메커니즘 확인)까지 등급화.' },
    ],
    mapKicker: '지리공간 맥락',
    mapTitle: '이벤트를 지리적·금융적 영향권에 매핑',
    mapLead: '2D 지오 렌즈가 이벤트 핫스팟, 시장 전파 아크, 테마 필터 오버레이를 LOD 최적화로 보여줍니다.',
    controlKicker: '파이프라인 자동화',
    controlTitle: '연속적인 수집, 분석, 모델 업데이트',
    controlLead: '5분 주기 데몬이 전체 파이프라인을 실행합니다: 데이터 수집, 분류, 이벤트 엔진, Codex 제안, 시그널 스냅샷. Python이 연산, TypeScript가 오케스트레이션.',
    marquee: ['캐노니컬 이벤트', '초과수익률', '대조군 매칭', '증거 등급', '메타모델', 'NAS PostgreSQL'],
    replayKicker: '검증',
    replayTitle: 'Purged walk-forward 교차검증으로 과적합 방지',
    replayLead: '이벤트 그룹 분할, 14일 퍼지 갭, 역빈도 가중치로 OOS 무결성 보장. 현재 OOS Brier 스코어: 0.216.',
    routeKicker: '문서',
    routeTitle: '기술적 세부사항 탐색',
    routeLead: '개발자와 연구자를 위한 아키텍처 문서, 알고리즘 레퍼런스, API 명세.',
    links: [
      { kicker: 'Playground', title: '인터랙티브 데모', note: '대시보드, 지오 렌즈, 시그널 흐름을 직접 체험.', href: '/lattice-current/ko/playground' },
      { kicker: 'Features', title: '플랫폼 기능', note: '수집, 분석, 예측, 검증 기능의 전체 분석.', href: '/lattice-current/ko/features/' },
      { kicker: 'Models', title: '메타모델과 증거 시스템', note: '학습 방법론, 모델 비교, 증거 등급 명세.', href: '/lattice-current/ko/ai-backtesting/' },
      { kicker: 'Architecture', title: '시스템 설계와 데이터 흐름', note: 'TS/Python 경계, NAS 저장, 파이프라인, 데스크톱 런타임.', href: '/lattice-current/ko/architecture' },
    ],
  },
  ja: {
    heroKicker: 'Event-driven alpha research',
    heroTitle: 'News event to statistically validated trading signal',
    heroLead:
      'Lattice Current collects articles from 40+ real-time sources, clusters them into canonical events, measures abnormal returns, and predicts alpha probability.',
    primaryCta: 'Playground',
    primaryHref: '/lattice-current/ja/playground',
    secondaryCta: 'Architecture',
    secondaryHref: '/lattice-current/ja/architecture',
    heroStats: [
      { label: 'News sources', value: '40+' },
      { label: 'Canonical events', value: '53,734' },
      { label: 'Evidence-graded', value: '116k+' },
    ],
    floatA: {
      kicker: 'Canonical events',
      title: 'Deduplicate before analysis',
      note: '10 articles about 1 event become 1 canonical cluster.',
    },
    floatB: {
      kicker: 'Abnormal returns',
      title: 'Alpha, not raw return',
      note: 'Market and sector benchmarks subtracted from every outcome.',
    },
    floatC: {
      kicker: 'Counterfactual controls',
      title: 'Compare against non-event days',
      note: 'Matched control days measure true causal uplift.',
    },
    theaterKicker: 'Live dashboard',
    theaterTitle: 'Signals, evidence grades, and geo context in one view',
    theaterLead: 'KPI strips, analytics charts, theme briefs, and interactive geo lens unified in one dashboard.',
    storyKicker: 'How it works',
    storyTitle: 'Three layers turn noise into validated signals',
    storyLead: 'Statistical features, meta-model prediction, and counterfactual evidence grading.',
    storyPanels: [
      { kicker: 'Layer 1', title: '60 statistical formulas as features', note: 'Hawkes, HMM, Kalman, transfer entropy, contextual bandits, and more.' },
      { kicker: 'Layer 2', title: 'Multi-task meta-model', note: 'PyTorch MLP predicts P(alpha>0), E[alpha], downside risk, time-to-peak.' },
      { kicker: 'Layer 3', title: 'Counterfactual evidence grading', note: 'Matched controls, evidence ladder E0 to E4.' },
    ],
    mapKicker: 'Geospatial context',
    mapTitle: 'Events mapped to geographic and financial impact zones',
    mapLead: '2D geo lens with event hotspots, transmission arcs, and LOD-optimized rendering.',
    controlKicker: 'Pipeline automation',
    controlTitle: 'Continuous ingestion, analysis, and model updates',
    controlLead: '5-minute daemon runs the full pipeline. Python handles compute; TypeScript orchestrates.',
    marquee: ['Canonical events', 'Abnormal returns', 'Matched controls', 'Evidence grades', 'Meta-model', 'NAS PostgreSQL'],
    replayKicker: 'Validation',
    replayTitle: 'Purged walk-forward cross-validation',
    replayLead: 'Event group splits, 14-day purge gaps, inverse-frequency weighting. OOS Brier: 0.216.',
    routeKicker: 'Documentation',
    routeTitle: 'Technical details',
    routeLead: 'Architecture, algorithm references, and API specifications.',
    links: [
      { kicker: 'Playground', title: 'Interactive demo', note: 'Dashboard, geo lens, signal flow.', href: '/lattice-current/ja/playground' },
      { kicker: 'Features', title: 'Platform capabilities', note: 'Ingestion, analysis, prediction, validation.', href: '/lattice-current/ja/features/' },
      { kicker: 'Models', title: 'Meta-model and evidence', note: 'Training, comparison, evidence ladder.', href: '/lattice-current/ja/ai-backtesting/' },
      { kicker: 'Architecture', title: 'System design', note: 'TS/Python boundary, NAS, pipeline, desktop.', href: '/lattice-current/ja/architecture' },
    ],
  },
} as const;

const copy = computed(() => localized[locale.value]);
</script>

<style scoped>
.lc-prime-landing {
  position: relative;
  overflow: hidden;
  color: #FAFAFA;
}

/* Apple/DeFi Style Glassmorphism & Backgrounds */
.lc-ambient-bg {
  position: absolute;
  inset: 0;
  background-color: #000000;
  z-index: -2;
}

.lc-ambient-mesh {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: 
    radial-gradient(circle at 15% 50%, rgba(255, 255, 255, 0.03), transparent 25%),
    radial-gradient(circle at 85% 30%, rgba(255, 255, 255, 0.04), transparent 25%);
  z-index: -1;
}

.glass-panel {
  background: rgba(20, 20, 20, 0.6);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}

.glass-hover {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.4s ease, box-shadow 0.4s ease;
}
.glass-hover:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
}

.spotlight-container {
  overflow: hidden;
  position: relative;
}
.spotlight-container::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
  opacity: 0.5;
}

.p-0 {
  padding: 0 !important;
}

/* Animations */
.reveal-up {
  animation: revealUp 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  opacity: 0;
  transform: translateY(20px);
}
.delay-1 { animation-delay: 0.1s; }
.delay-2 { animation-delay: 0.2s; }
.delay-3 { animation-delay: 0.3s; }
.delay-4 { animation-delay: 0.4s; }
.delay-5 { animation-delay: 0.5s; }

@keyframes revealUp {
  0% { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* Layout */
.lc-prime-band {
  position: relative;
  padding: 60px 0;
}
.lc-prime-band-hero {
  padding-top: 80px;
  padding-bottom: 120px;
}

.lc-prime-breakout {
  width: min(1600px, calc(100vw - 64px));
  margin: 0 auto;
}

/* Grids */
.lc-prime-hero-grid,
.lc-prime-story-grid,
.lc-prime-control-grid,
.lc-prime-section-head {
  display: grid;
  gap: 40px;
  grid-template-columns: 1fr 1.2fr;
  align-items: center;
}
@media (max-width: 1024px) {
  .lc-prime-hero-grid,
  .lc-prime-story-grid,
  .lc-prime-control-grid,
  .lc-prime-section-head {
    grid-template-columns: 1fr;
  }
}

/* Typography */
.lc-prime-kicker {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #A0A0A0;
  margin-bottom: 16px;
}

h1, h2 {
  margin: 0;
  font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  letter-spacing: -0.04em !important;
  line-height: 1.05;
  color: #FFFFFF;
}
h1 { font-size: clamp(48px, 6vw, 96px); font-weight: 700; }
h2 { font-size: clamp(36px, 4vw, 64px); font-weight: 600; }

.lc-prime-lead,
.lc-prime-story-lead,
.lc-prime-control-copy p,
.lc-prime-section-head > p {
  margin-top: 24px;
  font-size: 20px;
  line-height: 1.6;
  color: #A0A0A0;
  max-width: 600px;
}

/* Buttons */
.lc-prime-button-row {
  display: flex;
  gap: 16px;
  margin-top: 40px;
}

.lc-prime-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 52px;
  padding: 0 28px;
  border-radius: 26px;
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.lc-prime-button-brand {
  background: #FFFFFF;
  color: #000000;
}
.lc-prime-button-brand:hover {
  background: #E0E0E0;
  transform: scale(1.02);
}
.lc-prime-button:not(.lc-prime-button-brand) {
  background: rgba(255, 255, 255, 0.1);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.lc-prime-button:not(.lc-prime-button-brand):hover {
  background: rgba(255, 255, 255, 0.15);
  transform: scale(1.02);
}

/* Stat Ribbon */
.lc-prime-stat-ribbon {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 48px;
}
.lc-prime-stat-chip {
  flex: 1;
  min-width: 120px;
  padding: 20px;
}
.lc-prime-stat-chip span {
  font-size: 12px;
  color: #888888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.lc-prime-stat-chip strong {
  display: block;
  font-size: 24px;
  font-weight: 600;
  color: #FFFFFF;
  margin-top: 8px;
}

/* Hero Abstract Visual (replaces orbs) */
.lc-prime-hero-visual {
  position: relative;
  height: 600px;
  width: 100%;
}
.lc-prime-abstract-visual {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(255,255,255,0.05) 0%, transparent 60%);
}

.lc-prime-floating-card {
  position: absolute;
  padding: 24px;
  width: 280px;
}
.lc-prime-floating-card-a { top: 10%; left: 10%; }
.lc-prime-floating-card-b { top: 40%; right: 5%; }
.lc-prime-floating-card-c { bottom: 10%; left: 30%; }

.lc-prime-floating-card span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #A0A0A0;
}
.lc-prime-floating-card strong {
  display: block;
  margin-top: 8px;
  font-size: 20px;
  color: #FFFFFF;
}
.lc-prime-floating-card p {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.5;
  color: #888888;
}

/* Float Animations */
.float-anim-1 { animation: float1 8s ease-in-out infinite; }
.float-anim-2 { animation: float2 9s ease-in-out infinite reverse; }
.float-anim-3 { animation: float3 7s ease-in-out infinite; }

@keyframes float1 { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }
@keyframes float2 { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }
@keyframes float3 { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }

/* Story Panels */
.lc-prime-story-panels {
  display: grid;
  gap: 24px;
}
.lc-prime-story-panel {
  padding: 32px;
}
.lc-prime-story-panel span { font-size: 12px; color: #A0A0A0; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; display: block; }
.lc-prime-story-panel strong { font-size: 28px; color: #FFFFFF; display: block; letter-spacing: -0.02em; }
.lc-prime-story-panel p { margin-top: 12px; font-size: 16px; color: #888888; line-height: 1.6; }

/* Control Marquee */
.lc-prime-marquee {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}
.glass-badge {
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 13px;
  color: #E0E0E0;
}

/* Routing Cards */
.lc-prime-route-shell {
  padding: 64px;
}
@media (max-width: 768px) {
  .lc-prime-route-shell {
    padding: 32px;
  }
}
.lc-prime-route-grid {
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  margin-top: 48px;
}
.lc-prime-route-card {
  padding: 32px;
  text-decoration: none;
  display: block;
}
.lc-prime-route-card span { font-size: 12px; color: #A0A0A0; text-transform: uppercase; letter-spacing: 0.1em; display: block; }
.lc-prime-route-card strong { font-size: 20px; color: #FFFFFF; display: block; margin-top: 12px; }
.lc-prime-route-card p { font-size: 15px; color: #888888; margin-top: 12px; line-height: 1.5; }
</style>
