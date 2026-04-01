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
    heroKicker: 'Immersive product landing',
    heroTitle: 'Intelligence, replay, and operator control in one cinematic surface',
    heroLead:
      'The root page now behaves like a flagship product launch: massive spatial context, visible signal motion, and a clear route into research, replay, and operations.',
    primaryCta: 'Open Playground',
    primaryHref: '/lattice-current/playground',
    secondaryCta: 'Read Architecture',
    secondaryHref: '/lattice-current/architecture',
    heroStats: [
      { label: 'Live surfaces', value: 'Map-first' },
      { label: 'Validation loop', value: 'Replay-native' },
      { label: 'Reasoning model', value: 'Graph-backed' },
    ],
    floatA: {
      kicker: 'Global context',
      title: 'The world is the first interface',
      note: 'Routes, chokepoints, outages, and conflict posture are presented as one operating picture.',
    },
    floatB: {
      kicker: 'Decision control',
      title: 'Research does not leave the product surface',
      note: 'Source posture, graph structure, and decision state stay visible in the same visual system.',
    },
    floatC: {
      kicker: 'Replay discipline',
      title: 'Validation is designed in, not bolted on',
      note: 'The system shows how current posture and replay posture diverge before action.',
    },
    theaterKicker: 'Theater view',
    theaterTitle: 'A landing page should show the product loop, not just describe it',
    theaterLead:
      'This band sits where generic docs sites usually place a grid of links. Instead, it shows a live product-style sequence with motion and state.',
    storyKicker: 'Product narrative',
    storyTitle: 'The page is intentionally paced like a reveal, then a system, then a console',
    storyLead:
      'That pacing is deliberate. The product is complex, so the public front page has to establish hierarchy before it exposes documentation depth.',
    storyPanels: [
      {
        kicker: 'Reveal',
        title: 'Start with scale',
        note: 'Lead with world-scale context and a dominant visual object instead of a cluster of equal cards.',
      },
      {
        kicker: 'System',
        title: 'Then show the operating model',
        note: 'Introduce routing, governance, ontology, and replay as one chain rather than isolated features.',
      },
      {
        kicker: 'Console',
        title: 'Then expose the usable surfaces',
        note: 'The landing page should already feel like a control surface before the visitor opens the app.',
      },
    ],
    mapKicker: 'World-scale surface',
    mapTitle: 'The map now occupies the screen like a flagship product feature',
    mapLead:
      'The globe is no longer squeezed into a narrow documentation frame. It is treated as the visual anchor of the product story.',
    controlKicker: 'Control room',
    controlTitle: 'Operational state belongs in a wide, high-contrast band',
    controlLead:
      'This middle sequence is designed to feel like a control room wall: large, dense, and visibly alive rather than politely centered.',
    marquee: ['Signal routing', 'Operator posture', 'Source governance', 'Replay health', 'Scenario compare', 'Storage lifecycle'],
    replayKicker: 'Replay and scenario',
    replayTitle: 'Validation is shown as product behavior, not hidden as research plumbing',
    replayLead:
      'Visitors can see how scenario work and replay posture fit into the same system before reading any deeper page.',
    routeKicker: 'Documentation paths',
    routeTitle: 'Once the product story is clear, route into the deeper pages',
    routeLead:
      'The side pages remain technical references. They are now wider and better suited to app-grade visuals and console-like components.',
    links: [
      {
        kicker: 'Playground',
        title: 'Interactive product demos',
        note: 'Open the product-style public workbench and test the interaction flow directly.',
        href: '/lattice-current/playground',
      },
      {
        kicker: 'Features',
        title: 'Product capability index',
        note: 'Read the feature map after the landing establishes the operating model.',
        href: '/lattice-current/features/',
      },
      {
        kicker: 'AI & Backtesting',
        title: 'Signal logic and replay system',
        note: 'Follow the scoring, adaptation, and backtesting layers in detail.',
        href: '/lattice-current/ai-backtesting/',
      },
      {
        kicker: 'Architecture',
        title: 'Runtime, storage, and ownership',
        note: 'See how browser, server, archive, and replay infrastructure fit together.',
        href: '/lattice-current/architecture',
      },
    ],
  },
  ko: {
    heroKicker: 'Immersive product landing',
    heroTitle: '인텔리전스, 리플레이, 운영 제어를 하나의 시네마틱 표면으로',
    heroLead:
      '루트 페이지를 플래그십 제품 발표면처럼 다시 구성했다. 큰 공간감, 움직이는 신호, 그리고 연구·리플레이·운영으로 이어지는 명확한 경로를 한 화면에서 보여준다.',
    primaryCta: '플레이그라운드 열기',
    primaryHref: '/lattice-current/ko/playground',
    secondaryCta: '아키텍처 보기',
    secondaryHref: '/lattice-current/ko/architecture',
    heroStats: [
      { label: 'Live surfaces', value: 'Map-first' },
      { label: 'Validation loop', value: 'Replay-native' },
      { label: 'Reasoning model', value: 'Graph-backed' },
    ],
    floatA: {
      kicker: 'Global context',
      title: '세계가 첫 번째 인터페이스가 된다',
      note: '경로, 병목, 장애, 분쟁 자세를 하나의 운영 그림으로 보여준다.',
    },
    floatB: {
      kicker: 'Decision control',
      title: '리서치는 제품 표면을 떠나지 않는다',
      note: '소스 상태, 그래프 구조, 의사결정 상태가 같은 시각 체계 안에 남는다.',
    },
    floatC: {
      kicker: 'Replay discipline',
      title: '검증은 나중에 붙인 것이 아니다',
      note: '현재 자세와 리플레이 자세가 어떻게 갈리는지 행동 전에 보여준다.',
    },
    theaterKicker: 'Theater view',
    theaterTitle: '랜딩 페이지는 제품 루프를 보여줘야지, 설명만 해서는 안 된다',
    theaterLead: '링크 그리드 대신 실제 제품형 시퀀스를 메인 밴드에 배치했다.',
    storyKicker: 'Product narrative',
    storyTitle: '페이지는 공개면, 시스템, 콘솔 순서로 의도적으로 전개된다',
    storyLead:
      '제품이 복잡하기 때문에, 공개 랜딩도 먼저 계층을 세운 뒤에 문서 깊이를 열어야 한다.',
    storyPanels: [
      { kicker: 'Reveal', title: '먼저 스케일을 보여준다', note: '비슷한 카드 묶음 대신, 세계 규모 맥락과 지배적인 장면으로 시작한다.' },
      { kicker: 'System', title: '그 다음 운영 모델을 보여준다', note: '라우팅, 거버넌스, 온톨로지, 리플레이를 개별 기능이 아니라 하나의 체인으로 소개한다.' },
      { kicker: 'Console', title: '그 다음 실제 사용 표면을 노출한다', note: '앱을 열기 전부터 이 페이지가 제어면처럼 느껴져야 한다.' },
    ],
    mapKicker: 'World-scale surface',
    mapTitle: '지도는 이제 플래그십 제품 기능처럼 화면을 차지한다',
    mapLead: '글로브를 문서 칼럼에 끼워 넣지 않고, 제품 서사의 중심 앵커로 둔다.',
    controlKicker: 'Control room',
    controlTitle: '운영 상태는 넓고 대비가 큰 밴드 안에 있어야 한다',
    controlLead: '중간 구간을 관제실 벽처럼 설계해, 중앙 정렬된 문서보다 훨씬 강한 제품감을 만든다.',
    marquee: ['Signal routing', 'Operator posture', 'Source governance', 'Replay health', 'Scenario compare', 'Storage lifecycle'],
    replayKicker: 'Replay and scenario',
    replayTitle: '검증은 연구 배관이 아니라 제품 동작으로 보여준다',
    replayLead: '방문자가 깊은 문서를 읽기 전에 시나리오와 리플레이의 역할을 바로 이해하게 만든다.',
    routeKicker: 'Documentation paths',
    routeTitle: '제품 서사를 본 뒤, 필요한 깊이의 문서로 들어간다',
    routeLead: '옆 문서 페이지들은 더 넓은 작업면을 쓰도록 조정해서 앱형 비주얼과 콘솔 컴포넌트를 더 잘 담게 했다.',
    links: [
      { kicker: 'Playground', title: '인터랙티브 제품 데모', note: '공개 워크벤치와 시나리오 흐름을 직접 확인한다.', href: '/lattice-current/ko/playground' },
      { kicker: 'Features', title: '제품 기능 지도', note: '랜딩에서 운영 모델을 본 뒤 기능 지도로 이동한다.', href: '/lattice-current/ko/features/' },
      { kicker: 'AI & Backtesting', title: '신호 로직과 리플레이 시스템', note: '스코어링, 적응, 백테스트 레이어를 자세히 본다.', href: '/lattice-current/ko/ai-backtesting/' },
      { kicker: 'Architecture', title: '런타임, 저장, 소유권', note: '브라우저, 서버, 아카이브, 리플레이 인프라 구조를 확인한다.', href: '/lattice-current/ko/architecture' },
    ],
  },
  ja: {
    heroKicker: 'Immersive product landing',
    heroTitle: 'インテリジェンス、リプレイ、運用制御を一つのシネマティックな面にまとめる',
    heroLead:
      'ルートページを旗艦製品の公開面として再構成した。大きな空間感、動く信号、そして研究・リプレイ・運用へ続く明確な流れを一画面で見せる。',
    primaryCta: 'Playground を開く',
    primaryHref: '/lattice-current/ja/playground',
    secondaryCta: 'Architecture を見る',
    secondaryHref: '/lattice-current/ja/architecture',
    heroStats: [
      { label: 'Live surfaces', value: 'Map-first' },
      { label: 'Validation loop', value: 'Replay-native' },
      { label: 'Reasoning model', value: 'Graph-backed' },
    ],
    floatA: {
      kicker: 'Global context',
      title: '世界そのものが最初のインターフェースになる',
      note: '経路、ボトルネック、障害、紛争姿勢を一枚の運用図として見せる。',
    },
    floatB: {
      kicker: 'Decision control',
      title: 'リサーチは製品面の外に出ない',
      note: 'ソース状態、グラフ構造、判断状態が同じ視覚体系の中に残る。',
    },
    floatC: {
      kicker: 'Replay discipline',
      title: '検証は後付けではない',
      note: '現在姿勢とリプレイ姿勢の差分を、行動前に見せる。',
    },
    theaterKicker: 'Theater view',
    theaterTitle: 'ランディングは製品ループを見せるべきで、説明だけでは足りない',
    theaterLead: 'リンクの格子ではなく、製品らしいシーケンスをメイン帯に置いた。',
    storyKicker: 'Product narrative',
    storyTitle: 'ページは公開面、システム、コンソールの順に意図的に展開される',
    storyLead: '製品が複雑だからこそ、最初に階層を作ってから文書の深さへ進ませる必要がある。',
    storyPanels: [
      { kicker: 'Reveal', title: 'まずスケールを見せる', note: '似たカード群ではなく、世界規模の文脈と支配的な場面から始める。' },
      { kicker: 'System', title: '次に運用モデルを見せる', note: 'ルーティング、ガバナンス、オントロジー、リプレイを一つの連鎖として見せる。' },
      { kicker: 'Console', title: '最後に使える面を露出する', note: 'アプリを開く前から、このページ自体が制御面に感じられるべきだ。' },
    ],
    mapKicker: 'World-scale surface',
    mapTitle: '地図は今や旗艦機能として画面を支配する',
    mapLead: 'グローブを狭い docs カラムに押し込めず、製品物語の主軸に置く。',
    controlKicker: 'Control room',
    controlTitle: '運用状態は幅広く、強いコントラストを持つ帯の中に置くべきだ',
    controlLead: '中央帯を管制室の壁のように設計し、礼儀正しい docs レイアウトより強い製品感を出す。',
    marquee: ['Signal routing', 'Operator posture', 'Source governance', 'Replay health', 'Scenario compare', 'Storage lifecycle'],
    replayKicker: 'Replay and scenario',
    replayTitle: '検証を研究配管ではなく、製品動作として見せる',
    replayLead: '訪問者が深い文書を読む前に、シナリオとリプレイの役割を理解できるようにする。',
    routeKicker: 'Documentation paths',
    routeTitle: '製品物語を見た後で、必要な深さの docs に進む',
    routeLead: '横の文書ページもより広い作業面を使うようにし、アプリ級のビジュアルを載せやすくした。',
    links: [
      { kicker: 'Playground', title: '対話型プロダクトデモ', note: '公開ワークベンチとシナリオの流れを直接見る。', href: '/lattice-current/ja/playground' },
      { kicker: 'Features', title: '製品機能マップ', note: 'ランディングで運用モデルを見た後、機能マップに進む。', href: '/lattice-current/ja/features/' },
      { kicker: 'AI & Backtesting', title: '信号ロジックとリプレイ系', note: 'スコアリング、適応、バックテスト層を詳しく追う。', href: '/lattice-current/ja/ai-backtesting/' },
      { kicker: 'Architecture', title: 'ランタイム、保存、責務', note: 'ブラウザ、サーバー、アーカイブ、リプレイ基盤の関係を見る。', href: '/lattice-current/ja/architecture' },
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
