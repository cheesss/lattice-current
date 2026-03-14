<template>
  <section class="lc-section lc-loop">
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

    <div class="lc-loop-grid">
      <button
        v-for="(step, index) in steps"
        :key="step.id"
        class="lc-loop-step"
        :class="{ 'is-active': step.id === activeId }"
        type="button"
        @click="activeId = step.id"
      >
        <span class="lc-loop-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="lc-loop-name">{{ step.title }}</span>
        <span class="lc-loop-metric">{{ step.metric }}</span>
      </button>
    </div>

    <div class="lc-loop-detail">
      <div class="lc-loop-detail-copy">
        <p class="lc-kicker">{{ active.kicker }}</p>
        <h3>{{ active.title }}</h3>
        <p>{{ active.body }}</p>
        <div class="lc-chip-row">
          <span v-for="tag in active.tags" :key="tag" class="lc-chip">{{ tag }}</span>
        </div>
      </div>
      <div class="lc-loop-aside">
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ copy.inputsLabel }}</p>
          <ul>
            <li v-for="item in active.inputs" :key="item">{{ item }}</li>
          </ul>
        </div>
        <div class="lc-mini-card">
          <p class="lc-mini-label">{{ copy.outputsLabel }}</p>
          <ul>
            <li v-for="item in active.outputs" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

type Locale = 'en' | 'ko' | 'ja';

type LoopStep = {
  id: string;
  title: string;
  kicker: string;
  metric: string;
  body: string;
  tags: string[];
  inputs: string[];
  outputs: string[];
};

type LoopCopy = {
  kicker: string;
  title: string;
  lead: string;
  badges: string[];
  inputsLabel: string;
  outputsLabel: string;
};

const props = withDefaults(defineProps<{ locale?: Locale }>(), {
  locale: 'en'
});

const content: Record<Locale, { copy: LoopCopy; steps: LoopStep[] }> = {
  en: {
    copy: {
      kicker: 'How the system works',
      title: 'Decision loop from signal to replay',
      lead: 'Each stage feeds the next one. Click a stage to see what data enters, what transforms happen, and what comes out.',
      badges: ['Live ingestion', 'Graph context', 'Replay feedback'],
      inputsLabel: 'Inputs',
      outputsLabel: 'Outputs'
    },
    steps: [
      {
        id: 'collect',
        title: 'Collect',
        kicker: 'Stage 1',
        metric: 'feeds -> events',
        body: 'Curated feeds, APIs, market snapshots, and local services are pulled into a current operating snapshot.',
        tags: ['RSS', 'APIs', 'Markets'],
        inputs: ['news feeds', 'geo layers', 'market time series'],
        outputs: ['normalized cards', 'freshness state', 'source batches']
      },
      {
        id: 'normalize',
        title: 'Normalize',
        kicker: 'Stage 2',
        metric: 'raw -> structured',
        body: 'Entities, locations, themes, and clusters are standardized so different sources can be compared and deduplicated.',
        tags: ['dedupe', 'entity resolution', 'clusters'],
        inputs: ['raw articles', 'keywords', 'provider metadata'],
        outputs: ['clusters', 'entity references', 'clean event objects']
      },
      {
        id: 'score',
        title: 'Score',
        kicker: 'Stage 3',
        metric: 'risk + credibility',
        body: 'Credibility, instability, convergence, and regime-aware analytics turn raw events into weighted operational signals.',
        tags: ['credibility', 'CII', 'regime'],
        inputs: ['clean events', 'source history', 'macro features'],
        outputs: ['risk scores', 'credibility priors', 'regime state']
      },
      {
        id: 'connect',
        title: 'Connect',
        kicker: 'Stage 4',
        metric: 'graph + transmission',
        body: 'Ontology, graph relations, and event-to-market transmission reveal how a story propagates into countries, sectors, and assets.',
        tags: ['ontology', 'multi-hop', 'assets'],
        inputs: ['scored events', 'entities', 'market links'],
        outputs: ['graph edges', 'transmission paths', 'focal themes']
      },
      {
        id: 'decide',
        title: 'Decide',
        kicker: 'Stage 5',
        metric: 'ideas + guardrails',
        body: 'Decision-support objects package candidate ideas, sizing logic, invalidation rules, and uncertainty bands for analyst review.',
        tags: ['ideas', 'bandits', 'sizing'],
        inputs: ['transmission paths', 'bandit priors', 'volatility state'],
        outputs: ['idea cards', 'size guidance', 'false-positive guardrails']
      },
      {
        id: 'learn',
        title: 'Replay',
        kicker: 'Stage 6',
        metric: 'outcomes -> priors',
        body: 'Historical replay and walk-forward runs compare past decisions with future returns and feed those results back into live priors.',
        tags: ['backtest', 'walk-forward', 'PiT'],
        inputs: ['historical frames', 'forward returns', 'run configs'],
        outputs: ['backtest runs', 'updated priors', 'performance traces']
      }
    ]
  },
  ko: {
    copy: {
      kicker: '시스템 작동 흐름',
      title: '신호에서 리플레이까지 이어지는 의사결정 루프',
      lead: '각 단계는 다음 단계를 위한 데이터를 만듭니다. 단계를 클릭하면 어떤 입력이 들어오고, 어떤 변환이 일어나며, 무엇이 나오는지 볼 수 있습니다.',
      badges: ['실시간 수집', '그래프 컨텍스트', '리플레이 피드백'],
      inputsLabel: '입력',
      outputsLabel: '출력'
    },
    steps: [
      {
        id: 'collect',
        title: '수집',
        kicker: '1단계',
        metric: 'feeds -> events',
        body: '선별된 피드, API, 시장 스냅샷, 로컬 서비스가 현재 운영 스냅샷으로 모입니다.',
        tags: ['RSS', 'API', '시장'],
        inputs: ['뉴스 피드', '지리 레이어', '시장 시계열'],
        outputs: ['정규화 카드', 'freshness 상태', 'source batch']
      },
      {
        id: 'normalize',
        title: '정규화',
        kicker: '2단계',
        metric: 'raw -> structured',
        body: '엔티티, 위치, 테마, 클러스터를 표준화해 서로 다른 소스를 비교하고 중복 제거할 수 있게 합니다.',
        tags: ['중복 제거', '엔티티 정규화', '클러스터'],
        inputs: ['원문 기사', '키워드', '공급자 메타데이터'],
        outputs: ['클러스터', '엔티티 참조', '정제된 이벤트 객체']
      },
      {
        id: 'score',
        title: '점수화',
        kicker: '3단계',
        metric: 'risk + credibility',
        body: 'credibility, instability, convergence, regime-aware 분석이 원시 이벤트를 가중된 운영 신호로 바꿉니다.',
        tags: ['credibility', 'CII', 'regime'],
        inputs: ['정제 이벤트', '소스 이력', '매크로 피처'],
        outputs: ['리스크 점수', 'credibility prior', 'regime 상태']
      },
      {
        id: 'connect',
        title: '연결',
        kicker: '4단계',
        metric: 'graph + transmission',
        body: '온톨로지, 그래프 관계, event-to-market transmission이 하나의 스토리가 국가, 섹터, 자산으로 어떻게 번지는지 보여줍니다.',
        tags: ['ontology', 'multi-hop', '자산'],
        inputs: ['점수화 이벤트', '엔티티', '시장 연결'],
        outputs: ['그래프 엣지', '전이 경로', '핵심 테마']
      },
      {
        id: 'decide',
        title: '의사결정',
        kicker: '5단계',
        metric: 'ideas + guardrails',
        body: '후보 아이디어, 사이징 로직, 무효화 조건, 불확실성 밴드를 패키징해 애널리스트가 검토할 수 있게 합니다.',
        tags: ['아이디어', '밴딧', '사이징'],
        inputs: ['전이 경로', 'bandit prior', '변동성 상태'],
        outputs: ['아이디어 카드', '사이즈 가이드', 'false-positive guardrail']
      },
      {
        id: 'learn',
        title: '리플레이',
        kicker: '6단계',
        metric: 'outcomes -> priors',
        body: 'historical replay와 walk-forward 실행이 과거 의사결정과 이후 수익률을 비교하고, 그 결과를 live prior에 다시 반영합니다.',
        tags: ['백테스트', '워크포워드', 'PiT'],
        inputs: ['historical frame', 'forward return', 'run config'],
        outputs: ['백테스트 run', '업데이트된 prior', '성과 추적선']
      }
    ]
  },
  ja: {
    copy: {
      kicker: 'システム動作フロー',
      title: 'シグナルからリプレイまでの意思決定ループ',
      lead: '各段階は次の段階のためのデータを作ります。段階をクリックすると、どんな入力が入り、どんな変換が起こり、何が出力されるかを確認できます。',
      badges: ['ライブ収集', 'グラフ文脈', 'リプレイ学習'],
      inputsLabel: '入力',
      outputsLabel: '出力'
    },
    steps: [
      {
        id: 'collect',
        title: '収集',
        kicker: 'ステージ 1',
        metric: 'feeds -> events',
        body: '選別されたフィード、API、市場スナップショット、ローカルサービスを現在の運用スナップショットへ集約します。',
        tags: ['RSS', 'API', '市場'],
        inputs: ['ニュースフィード', '地理レイヤー', '市場時系列'],
        outputs: ['正規化カード', 'freshness 状態', 'source batch']
      },
      {
        id: 'normalize',
        title: '正規化',
        kicker: 'ステージ 2',
        metric: 'raw -> structured',
        body: 'エンティティ、位置、テーマ、クラスタを標準化し、異なるソースを比較しながら重複排除できるようにします。',
        tags: ['重複排除', 'エンティティ解決', 'クラスタ'],
        inputs: ['生記事', 'キーワード', 'プロバイダーメタデータ'],
        outputs: ['クラスタ', 'エンティティ参照', '整形済みイベント']
      },
      {
        id: 'score',
        title: 'スコア化',
        kicker: 'ステージ 3',
        metric: 'risk + credibility',
        body: 'credibility、instability、convergence、regime-aware 分析が生イベントを重み付き運用シグナルへ変換します。',
        tags: ['credibility', 'CII', 'regime'],
        inputs: ['整形イベント', 'ソース履歴', 'マクロ特徴量'],
        outputs: ['リスクスコア', 'credibility prior', 'regime 状態']
      },
      {
        id: 'connect',
        title: '接続',
        kicker: 'ステージ 4',
        metric: 'graph + transmission',
        body: 'オントロジー、グラフ関係、event-to-market transmission により、1つのストーリーが国、セクター、資産へどう波及するかを示します。',
        tags: ['ontology', 'multi-hop', '資産'],
        inputs: ['スコア化イベント', 'エンティティ', '市場リンク'],
        outputs: ['グラフエッジ', '伝播経路', '焦点テーマ']
      },
      {
        id: 'decide',
        title: '判断',
        kicker: 'ステージ 5',
        metric: 'ideas + guardrails',
        body: '候補アイデア、サイズ調整ロジック、無効化条件、不確実性バンドをまとめ、アナリストがレビューできる形にします。',
        tags: ['アイデア', 'bandit', 'sizing'],
        inputs: ['伝播経路', 'bandit prior', 'ボラティリティ状態'],
        outputs: ['アイデアカード', 'サイズガイド', 'false-positive ガードレール']
      },
      {
        id: 'learn',
        title: 'リプレイ',
        kicker: 'ステージ 6',
        metric: 'outcomes -> priors',
        body: 'historical replay と walk-forward 実行が過去判断と将来リターンを比較し、その結果を live prior に戻します。',
        tags: ['バックテスト', 'walk-forward', 'PiT'],
        inputs: ['historical frame', 'forward return', 'run config'],
        outputs: ['バックテスト run', '更新済み prior', 'パフォーマンストレース']
      }
    ]
  }
};

const activeId = ref(content[props.locale].steps[0].id);
const current = computed(() => content[props.locale]);
const steps = computed(() => current.value.steps);
const copy = computed(() => current.value.copy);
const active = computed(() => steps.value.find((step) => step.id === activeId.value) ?? steps.value[0]);
</script>

<style scoped>
.lc-section {
  position: relative;
  margin: 28px 0;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top left, rgba(96, 165, 250, 0.15), transparent 36%),
    radial-gradient(circle at bottom right, rgba(251, 191, 36, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(11, 18, 32, 0.92), rgba(15, 23, 42, 0.88));
  box-shadow: 0 24px 72px rgba(2, 6, 23, 0.24);
}

.lc-section-head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.lc-section-head h2 {
  margin: 4px 0 8px;
}

.lc-kicker {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  color: #8fd1ff;
}

.lc-badge-row,
.lc-chip-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lc-badge,
.lc-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.08);
}

.lc-loop-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin-bottom: 18px;
}

.lc-loop-step {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.62);
  border-radius: 18px;
  padding: 14px;
  color: inherit;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.lc-loop-step:hover,
.lc-loop-step.is-active {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(30, 41, 59, 0.92);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
}

.lc-loop-index {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 10px;
}

.lc-loop-name {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
}

.lc-loop-metric {
  display: block;
  font-size: 12px;
  color: #8fd1ff;
}

.lc-loop-detail {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
}

.lc-loop-detail-copy,
.lc-mini-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  padding: 18px;
  background: rgba(15, 23, 42, 0.55);
}

.lc-loop-detail-copy h3 {
  margin-top: 6px;
  margin-bottom: 10px;
}

.lc-loop-aside {
  display: grid;
  gap: 12px;
}

.lc-mini-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fbbf24;
}

.lc-mini-card ul {
  margin: 0;
  padding-left: 18px;
}

.lc-mini-card li + li {
  margin-top: 6px;
}

@media (max-width: 860px) {
  .lc-section-head,
  .lc-loop-detail {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
