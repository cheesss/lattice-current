<template>
  <section class="lc-section lc-replay-workbench">
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

    <div class="lc-replay-toolbar">
      <div class="lc-replay-picker">
        <button
          v-for="scenario in scenarios"
          :key="scenario.id"
          class="lc-replay-picker-button"
          :class="{ 'is-active': selectedScenarioId === scenario.id }"
          type="button"
          @click="selectedScenarioId = scenario.id"
        >
          <strong>{{ scenario.label[locale] ?? scenario.label.en }}</strong>
          <span>{{ scenario.window }}</span>
        </button>
      </div>

      <div class="lc-chip-row">
        <button
          v-for="dataset in activeScenario.datasets"
          :key="dataset.id"
          class="lc-chip lc-chip-button"
          :class="{ 'is-active': selectedDatasetId === dataset.id }"
          type="button"
          @click="selectedDatasetId = dataset.id"
        >
          {{ dataset.label }}
        </button>
      </div>
    </div>

    <div class="lc-replay-grid">
      <div class="lc-ops-panel lc-ops-panel-strong">
        <div class="lc-console-header-row">
          <div>
            <p class="lc-mini-label">{{ copy.scenarioLabel }}</p>
            <h3>{{ activeScenario.label[locale] ?? activeScenario.label.en }}</h3>
            <p>{{ activeScenario.summary[locale] ?? activeScenario.summary.en }}</p>
          </div>
          <span class="lc-risk-pill" :data-tone="activeScenario.tone">{{ activeScenario.posture[locale] ?? activeScenario.posture.en }}</span>
        </div>

        <div class="lc-metric-row">
          <div class="lc-metric-card">
            <span>{{ copy.framesLabel }}</span>
            <strong>{{ activeScenario.metrics.frames }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.ideasLabel }}</span>
            <strong>{{ activeScenario.metrics.ideas }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.hitRateLabel }}</span>
            <strong>{{ activeScenario.metrics.hitRate }}</strong>
          </div>
          <div class="lc-metric-card">
            <span>{{ copy.cagrLabel }}</span>
            <strong>{{ activeScenario.metrics.cagr }}</strong>
          </div>
        </div>

        <div class="lc-replay-curve">
          <div class="lc-console-header-row lc-console-header-row-tight">
            <p class="lc-mini-label">{{ copy.curveLabel }}</p>
            <span class="lc-curve-caption">{{ activeDataset.provider }} · {{ activeDataset.coverage }}</span>
          </div>
          <svg viewBox="0 0 600 220" class="lc-replay-curve-svg" aria-hidden="true">
            <defs>
              <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="rgba(70, 160, 216, 0.34)" />
                <stop offset="100%" stop-color="rgba(70, 160, 216, 0.03)" />
              </linearGradient>
            </defs>
            <path d="M0 219 L600 219" class="lc-curve-axis" />
            <path :d="areaPath" fill="url(#curveFill)" />
            <path :d="linePath" class="lc-curve-line" />
          </svg>
          <div class="lc-curve-scale">
            <span>{{ activeScenario.window }}</span>
            <span>{{ activeScenario.metrics.maxDrawdown }}</span>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.datasetLabel }}</p>
        <div class="lc-feed-list">
          <div v-for="dataset in activeScenario.datasets" :key="dataset.id" class="lc-static-card">
            <div class="lc-static-head">
              <strong>{{ dataset.label }}</strong>
              <span>{{ dataset.provider }}</span>
            </div>
            <p>{{ dataset.coverage }}</p>
            <p>{{ dataset.note[locale] ?? dataset.note.en }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="lc-replay-grid lc-replay-grid-secondary">
      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.decisionsLabel }}</p>
        <div class="lc-feed-list">
          <div v-for="idea in activeScenario.decisions" :key="idea.title.en" class="lc-static-card">
            <div class="lc-static-head">
              <strong>{{ idea.title[locale] ?? idea.title.en }}</strong>
              <span>{{ idea.action[locale] ?? idea.action.en }}</span>
            </div>
            <p>{{ idea.note[locale] ?? idea.note.en }}</p>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.timelineLabel }}</p>
        <div class="lc-replay-timeline">
          <div v-for="step in activeScenario.timeline" :key="step.time" class="lc-replay-timeline-item">
            <span>{{ step.time }}</span>
            <strong>{{ step.title[locale] ?? step.title.en }}</strong>
            <p>{{ step.note[locale] ?? step.note.en }}</p>
          </div>
        </div>
      </div>

      <div class="lc-ops-panel">
        <p class="lc-mini-label">{{ copy.lifecycleLabel }}</p>
        <div class="lc-storage-lifecycle">
          <div class="lc-storage-tier">
            <span>{{ copy.hotLabel }}</span>
            <strong>Redis</strong>
            <p>{{ activeScenario.lifecycle.hot[locale] ?? activeScenario.lifecycle.hot.en }}</p>
          </div>
          <div class="lc-storage-tier">
            <span>{{ copy.warmLabel }}</span>
            <strong>PostgreSQL</strong>
            <p>{{ activeScenario.lifecycle.warm[locale] ?? activeScenario.lifecycle.warm.en }}</p>
          </div>
          <div class="lc-storage-tier">
            <span>{{ copy.coldLabel }}</span>
            <strong>Parquet / R2</strong>
            <p>{{ activeScenario.lifecycle.cold[locale] ?? activeScenario.lifecycle.cold.en }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type LocaleCode = 'en' | 'ko' | 'ja';

interface LocalizedText {
  en: string;
  ko: string;
  ja: string;
}

interface MockDataset {
  id: string;
  label: string;
  provider: string;
  coverage: string;
  note: LocalizedText;
}

interface MockScenario {
  id: string;
  label: LocalizedText;
  summary: LocalizedText;
  posture: LocalizedText;
  tone: 'positive' | 'warning' | 'critical';
  window: string;
  metrics: {
    frames: string;
    ideas: string;
    hitRate: string;
    cagr: string;
    maxDrawdown: string;
  };
  curve: number[];
  datasets: MockDataset[];
  decisions: Array<{
    title: LocalizedText;
    action: LocalizedText;
    note: LocalizedText;
  }>;
  timeline: Array<{
    time: string;
    title: LocalizedText;
    note: LocalizedText;
  }>;
  lifecycle: {
    hot: LocalizedText;
    warm: LocalizedText;
    cold: LocalizedText;
  };
}

const props = withDefaults(defineProps<{ locale?: LocaleCode }>(), {
  locale: 'en'
});

const locale = computed<LocaleCode>(() => props.locale);

const copyMap: Record<LocaleCode, Record<string, string | string[]>> = {
  en: {
    kicker: 'Mock Replay Studio',
    title: 'Scenario and backtest workbench',
    lead: 'This public demo uses synthetic point-in-time data shaped like the real replay stack. You can switch datasets, compare scenarios, and inspect how storage, evaluation, and operator posture move together.',
    badges: ['mock data', 'historical replay', 'scenario console'],
    scenarioLabel: 'Scenario',
    framesLabel: 'Frames',
    ideasLabel: 'Idea cards',
    hitRateLabel: 'Hit rate',
    cagrLabel: 'CAGR',
    curveLabel: 'Replay curve',
    datasetLabel: 'Input datasets',
    decisionsLabel: 'Decision posture',
    timelineLabel: 'Scenario timeline',
    lifecycleLabel: 'Data lifecycle',
    hotLabel: 'Hot',
    warmLabel: 'Warm',
    coldLabel: 'Cold'
  },
  ko: {
    kicker: '가상 Replay Studio',
    title: '시나리오 · 백테스트 워크벤치',
    lead: '이 공개 데모는 실제 리플레이 스택과 비슷한 구조의 합성 point-in-time 데이터를 사용합니다. 데이터셋을 바꾸고, 시나리오를 비교하고, 저장 계층과 평가 결과가 어떻게 함께 움직이는지 볼 수 있습니다.',
    badges: ['가상 데이터', '과거 리플레이', '시나리오 콘솔'],
    scenarioLabel: '시나리오',
    framesLabel: '프레임',
    ideasLabel: '아이디어 카드',
    hitRateLabel: '적중률',
    cagrLabel: '연환산',
    curveLabel: '리플레이 곡선',
    datasetLabel: '입력 데이터셋',
    decisionsLabel: '의사결정 자세',
    timelineLabel: '시나리오 타임라인',
    lifecycleLabel: '데이터 라이프사이클',
    hotLabel: '핫',
    warmLabel: '웜',
    coldLabel: '콜드'
  },
  ja: {
    kicker: 'Mock Replay Studio',
    title: 'シナリオ・バックテスト workbench',
    lead: 'この公開デモは実運用の replay stack に近い合成 point-in-time データを使います。データセットを切り替え、シナリオを比較し、保存層と評価結果がどう連動するかを確認できます。',
    badges: ['mock data', 'historical replay', 'scenario console'],
    scenarioLabel: 'Scenario',
    framesLabel: 'Frames',
    ideasLabel: 'Ideas',
    hitRateLabel: 'Hit rate',
    cagrLabel: 'CAGR',
    curveLabel: 'Replay curve',
    datasetLabel: 'Input datasets',
    decisionsLabel: 'Decision posture',
    timelineLabel: 'Scenario timeline',
    lifecycleLabel: 'Data lifecycle',
    hotLabel: 'Hot',
    warmLabel: 'Warm',
    coldLabel: 'Cold'
  }
};

const copy = computed(() => {
  const selected = copyMap[locale.value];
  return {
    ...selected,
    badges: selected.badges as string[]
  };
});

const scenarios: MockScenario[] = [
  {
    id: 'middle-east-energy',
    label: {
      en: 'Middle East energy shock',
      ko: '중동 에너지 쇼크',
      ja: 'Middle East energy shock'
    },
    summary: {
      en: 'Escalation lifts oil and shipping stress while safe-haven positioning turns defensive.',
      ko: '확전으로 유가와 해상 스트레스가 올라가고, 안전자산 포지셔닝이 방어적으로 이동한 상황입니다.',
      ja: 'Escalation lifts oil and shipping stress while safe-haven positioning turns defensive.'
    },
    posture: {
      en: 'Defensive bias',
      ko: '방어 우위',
      ja: 'Defensive bias'
    },
    tone: 'warning',
    window: '2025-10 -> 2026-03',
    metrics: {
      frames: '184',
      ideas: '7',
      hitRate: '63%',
      cagr: '+11.8%',
      maxDrawdown: '-6.4%'
    },
    curve: [100, 103, 107, 104, 111, 115, 112, 118, 121, 119],
    datasets: [
      {
        id: 'acled',
        label: 'ACLED Middle East',
        provider: 'ACLED',
        coverage: 'conflict events · 91% coverage',
        note: {
          en: 'Conflict and protest events anchor the regime shift signal.',
          ko: '분쟁 및 시위 이벤트가 레짐 전환 신호의 핵심 축입니다.',
          ja: 'Conflict and protest events anchor the regime shift signal.'
        }
      },
      {
        id: 'gdelt',
        label: 'GDELT chokepoint pulse',
        provider: 'GDELT',
        coverage: 'news / document stream · 78% coverage',
        note: {
          en: 'News burst intensity confirms narrative acceleration around shipping routes.',
          ko: '뉴스 버스트 강도가 해상 경로 주변 내러티브 가속을 확인해 줍니다.',
          ja: 'News burst intensity confirms narrative acceleration around shipping routes.'
        }
      },
      {
        id: 'oil',
        label: 'Oil and hedge basket',
        provider: 'Yahoo / FRED',
        coverage: 'price series · 96% coverage',
        note: {
          en: 'USO, XLE, GLD, and TLT provide tradable exit points for the replay.',
          ko: 'USO, XLE, GLD, TLT가 리플레이의 거래 가능 출구를 제공합니다.',
          ja: 'USO, XLE, GLD, and TLT provide tradable exit points for the replay.'
        }
      }
    ],
    decisions: [
      {
        title: {
          en: 'USO / XLE defensive carry',
          ko: 'USO / XLE 방어 캐리',
          ja: 'USO / XLE defensive carry'
        },
        action: {
          en: 'Watch / deploy small',
          ko: '관찰 / 소규모 배치',
          ja: 'Watch / deploy small'
        },
        note: {
          en: 'High conviction only when shipping stress and crude momentum confirm together.',
          ko: '해상 스트레스와 원유 모멘텀이 함께 확인될 때만 높은 확신을 부여합니다.',
          ja: 'High conviction only when shipping stress and crude momentum confirm together.'
        }
      },
      {
        title: {
          en: 'GLD / TLT hedge sleeve',
          ko: 'GLD / TLT 헤지 슬리브',
          ja: 'GLD / TLT hedge sleeve'
        },
        action: {
          en: 'Deploy',
          ko: '배치',
          ja: 'Deploy'
        },
        note: {
          en: 'Macro overlay prioritizes capital protection over fresh cyclic exposure.',
          ko: '거시 오버레이가 새로운 경기민감 노출보다 자본 보호를 우선시합니다.',
          ja: 'Macro overlay prioritizes capital protection over fresh cyclic exposure.'
        }
      }
    ],
    timeline: [
      {
        time: 'T-72h',
        title: {
          en: 'Conflict burst enters hot cache',
          ko: '분쟁 버스트가 hot cache에 유입',
          ja: 'Conflict burst enters hot cache'
        },
        note: {
          en: 'ACLED and news spikes land in Redis and feed the current snapshot.',
          ko: 'ACLED와 뉴스 스파이크가 Redis에 적재되어 현재 스냅샷을 만듭니다.',
          ja: 'ACLED and news spikes land in Redis and feed the current snapshot.'
        }
      },
      {
        time: 'T-24h',
        title: {
          en: 'Replay frame enriched',
          ko: '리플레이 프레임 강화',
          ja: 'Replay frame enriched'
        },
        note: {
          en: 'Transmission edges and hedge bias are recorded in the replay frame.',
          ko: '전이 엣지와 헤지 바이어스가 리플레이 프레임에 기록됩니다.',
          ja: 'Transmission edges and hedge bias are recorded in the replay frame.'
        }
      },
      {
        time: 'T+48h',
        title: {
          en: 'Forward return closes',
          ko: 'forward return 종료',
          ja: 'Forward return closes'
        },
        note: {
          en: 'Max-hold fallback closes the position if no earlier clean exit appears.',
          ko: '더 빠른 깔끔한 출구가 없으면 max-hold fallback으로 포지션을 종료합니다.',
          ja: 'Max-hold fallback closes the position if no earlier clean exit appears.'
        }
      }
    ],
    lifecycle: {
      hot: {
        en: 'Live conflict/news payloads stay in Redis with short TTL and schema checks.',
        ko: '실시간 분쟁/뉴스 페이로드는 짧은 TTL과 스키마 검증을 가진 Redis hot 계층에 머뭅니다.',
        ja: 'Live conflict/news payloads stay in Redis with short TTL and schema checks.'
      },
      warm: {
        en: 'Replay frames and run summaries persist into PostgreSQL for operator review.',
        ko: '리플레이 프레임과 런 요약은 PostgreSQL warm 계층에 저장되어 운영 검토에 쓰입니다.',
        ja: 'Replay frames and run summaries persist into PostgreSQL for operator review.'
      },
      cold: {
        en: 'Parquet snapshots archive the scenario window for later point-in-time reproduction.',
        ko: 'Parquet 스냅샷이 시나리오 구간을 보관해 나중에 point-in-time 재현이 가능해집니다.',
        ja: 'Parquet snapshots archive the scenario window for later point-in-time reproduction.'
      }
    }
  },
  {
    id: 'inflation-break',
    label: {
      en: 'Inflation break and policy lag',
      ko: '인플레이션 재가속과 정책 지연',
      ja: 'Inflation break and policy lag'
    },
    summary: {
      en: 'Sticky CPI and slower growth create a selective risk-off posture with a shallow macro drawdown.',
      ko: '끈적한 CPI와 둔화되는 성장률이 얕은 거시 드로우다운과 선택적 risk-off를 만드는 구간입니다.',
      ja: 'Sticky CPI and slower growth create a selective risk-off posture with a shallow macro drawdown.'
    },
    posture: {
      en: 'Selective risk-off',
      ko: '선별적 risk-off',
      ja: 'Selective risk-off'
    },
    tone: 'critical',
    window: '2024-06 -> 2025-02',
    metrics: {
      frames: '132',
      ideas: '5',
      hitRate: '58%',
      cagr: '+7.2%',
      maxDrawdown: '-4.1%'
    },
    curve: [100, 98, 102, 106, 103, 109, 111, 110, 114, 116],
    datasets: [
      {
        id: 'fred-cpi',
        label: 'FRED core CPI',
        provider: 'FRED',
        coverage: 'macro series · 99% coverage',
        note: {
          en: 'CPI, yields, and policy-rate context shape the regime score.',
          ko: 'CPI, 금리, 정책금리 맥락이 레짐 점수를 형성합니다.',
          ja: 'CPI, yields, and policy-rate context shape the regime score.'
        }
      },
      {
        id: 'market-basket',
        label: 'Cross-asset tape',
        provider: 'Yahoo / Finnhub',
        coverage: 'equities, rates, commodities · 88% coverage',
        note: {
          en: 'Rates and defensive ETF baskets provide the realized exit series.',
          ko: '금리와 방어 ETF 바스켓이 실제 exit 시리즈를 제공합니다.',
          ja: 'Rates and defensive ETF baskets provide the realized exit series.'
        }
      }
    ],
    decisions: [
      {
        title: {
          en: 'TLT re-entry band',
          ko: 'TLT 재진입 밴드',
          ja: 'TLT re-entry band'
        },
        action: {
          en: 'Watch',
          ko: '관찰',
          ja: 'Watch'
        },
        note: {
          en: 'Only promote when inflation deceleration and yield compression align.',
          ko: '인플레이션 둔화와 금리 압축이 동시에 확인될 때만 승격합니다.',
          ja: 'Only promote when inflation deceleration and yield compression align.'
        }
      },
      {
        title: {
          en: 'GLD ballast',
          ko: 'GLD 방어 완충',
          ja: 'GLD ballast'
        },
        action: {
          en: 'Deploy',
          ko: '배치',
          ja: 'Deploy'
        },
        note: {
          en: 'Replay favors small hedge sizing over broad directional exposure.',
          ko: '리플레이는 광범위한 방향성 노출보다 소규모 헤지 사이징을 선호합니다.',
          ja: 'Replay favors small hedge sizing over broad directional exposure.'
        }
      }
    ],
    timeline: [
      {
        time: 'T-60d',
        title: {
          en: 'Warm store accumulates macro windows',
          ko: 'warm store에 거시 구간 축적',
          ja: 'Warm store accumulates macro windows'
        },
        note: {
          en: 'FRED series and market snapshots are retained for replay rather than discarded after display.',
          ko: 'FRED 시리즈와 시장 스냅샷이 표시 후 버려지지 않고 리플레이용으로 유지됩니다.',
          ja: 'FRED series and market snapshots are retained for replay rather than discarded after display.'
        }
      },
      {
        time: 'T-7d',
        title: {
          en: 'Current snapshot diverges from replay prior',
          ko: '현재 스냅샷이 replay prior와 벌어짐',
          ja: 'Current snapshot diverges from replay prior'
        },
        note: {
          en: 'Decision attribution shows macro pressure overtaking old priors.',
          ko: '의사결정 attribution에서 오래된 prior보다 macro pressure가 우세해집니다.',
          ja: 'Decision attribution shows macro pressure overtaking old priors.'
        }
      },
      {
        time: 'T+5d',
        title: {
          en: 'Hit-rate excludes non-tradable rows',
          ko: '비거래 가능 행을 hit-rate에서 제외',
          ja: 'Hit-rate excludes non-tradable rows'
        },
        note: {
          en: 'Replay health no longer inflates or corrupts metrics when execution is impossible.',
          ko: '실행 불가능한 경우 replay health 지표가 왜곡되지 않도록 합니다.',
          ja: 'Replay health no longer inflates or corrupts metrics when execution is impossible.'
        }
      }
    ],
    lifecycle: {
      hot: {
        en: 'Bootstrap fallback keeps the app readable even before live seed data arrives.',
        ko: '라이브 seed가 오기 전에도 bootstrap fallback이 앱을 읽을 수 있게 유지합니다.',
        ja: 'Bootstrap fallback keeps the app readable even before live seed data arrives.'
      },
      warm: {
        en: 'Macro windows and replay summaries stay queryable beyond panel refresh TTLs.',
        ko: '거시 구간과 리플레이 요약은 패널 refresh TTL 이후에도 조회 가능합니다.',
        ja: 'Macro windows and replay summaries stay queryable beyond panel refresh TTLs.'
      },
      cold: {
        en: 'Archive scaffolding preserves replay windows for later audit or docs-grade demos.',
        ko: '아카이브 계층이 리플레이 구간을 보관해 나중에 감사나 문서용 데모에 재사용할 수 있습니다.',
        ja: 'Archive scaffolding preserves replay windows for later audit or docs-grade demos.'
      }
    }
  }
];

const selectedScenarioId = ref(scenarios[0].id);
const selectedDatasetId = ref(scenarios[0].datasets[0].id);

const activeScenario = computed(() => scenarios.find((scenario) => scenario.id === selectedScenarioId.value) ?? scenarios[0]);
const activeDataset = computed(() => activeScenario.value.datasets.find((dataset) => dataset.id === selectedDatasetId.value) ?? activeScenario.value.datasets[0]);

const linePath = computed(() => buildPath(activeScenario.value.curve, false));
const areaPath = computed(() => buildPath(activeScenario.value.curve, true));

function buildPath(points: number[], closeArea: boolean): string {
  const width = 600;
  const height = 220;
  const padding = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const yFor = (value: number) => {
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    return height - padding - ratio * (height - padding * 2);
  };

  const segments = points.map((value, index) => {
    const x = padding + index * xStep;
    const y = yFor(value);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  if (!closeArea) return segments.join(' ');

  const firstX = padding;
  const lastX = padding + (points.length - 1) * xStep;
  return `${segments.join(' ')} L${lastX.toFixed(2)} ${(height - 1).toFixed(2)} L${firstX.toFixed(2)} ${(height - 1).toFixed(2)} Z`;
}
</script>
