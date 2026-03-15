import { defineConfig } from 'vitepress';

type LocaleLabels = {
  home: string;
  gettingStarted: string;
  variants: string;
  playground: string;
  features: string;
  aiBacktesting: string;
  algorithms: string;
  architecture: string;
  api: string;
  updates: string;
  legal: string;
  featuresOverview: string;
  liveIntelligence: string;
  investmentReplay: string;
  interactiveDemo: string;
  legalOverview: string;
  licensing: string;
  updatesOverview: string;
  docs: string;
  footerMessage: string;
  docsLaunch: string;
};

function pathFor(locale: '' | 'ko' | 'ja', route: string): string {
  const normalized = route.startsWith('/') ? route : `/${route}`;
  return locale ? `/${locale}${normalized}` : normalized;
}

function createNav(locale: '' | 'ko' | 'ja', labels: LocaleLabels) {
  return [
    { text: labels.home, link: pathFor(locale, '/') },
    { text: labels.gettingStarted, link: pathFor(locale, '/getting-started') },
    { text: labels.variants, link: pathFor(locale, '/variants') },
    { text: labels.playground, link: pathFor(locale, '/playground') },
    { text: labels.features, link: pathFor(locale, '/features/') },
    { text: labels.aiBacktesting, link: pathFor(locale, '/ai-backtesting/') },
    { text: labels.algorithms, link: pathFor(locale, '/algorithms') },
    { text: labels.architecture, link: pathFor(locale, '/architecture') },
    { text: labels.api, link: pathFor(locale, '/api') },
    { text: labels.updates, link: pathFor(locale, '/updates/') },
    { text: labels.legal, link: pathFor(locale, '/legal/') }
  ];
}

function createSidebar(locale: '' | 'ko' | 'ja', labels: LocaleLabels) {
  const base = locale ? `/${locale}` : '';
  return {
    [`${base}/features/`]: [
      {
        text: labels.features,
        items: [
          { text: labels.featuresOverview, link: pathFor(locale, '/features/') },
          { text: labels.liveIntelligence, link: pathFor(locale, '/features/live-intelligence') },
          { text: labels.investmentReplay, link: pathFor(locale, '/features/investment-replay') }
        ]
      }
    ],
    [`${base}/playground`]: [
      {
        text: labels.playground,
        items: [
          { text: labels.interactiveDemo, link: pathFor(locale, '/playground') }
        ]
      }
    ],
    [`${base}/ai-backtesting/`]: [
      {
        text: labels.aiBacktesting,
        items: [
          { text: labels.featuresOverview, link: pathFor(locale, '/ai-backtesting/') }
        ]
      }
    ],
    [`${base}/updates/`]: [
      {
        text: labels.updates,
        items: [
          { text: labels.updatesOverview, link: pathFor(locale, '/updates/') },
          { text: labels.docsLaunch, link: pathFor(locale, '/updates/2026-03-docs-launch') }
        ]
      }
    ],
    [`${base}/legal/`]: [
      {
        text: labels.legal,
        items: [
          { text: labels.legalOverview, link: pathFor(locale, '/legal/') },
          { text: labels.licensing, link: pathFor(locale, '/legal/licensing') }
        ]
      }
    ],
    [`${base}/`]: [
      {
        text: labels.docs,
        items: [
          { text: labels.gettingStarted, link: pathFor(locale, '/getting-started') },
          { text: labels.variants, link: pathFor(locale, '/variants') },
          { text: labels.playground, link: pathFor(locale, '/playground') },
          { text: labels.features, link: pathFor(locale, '/features/') },
          { text: labels.aiBacktesting, link: pathFor(locale, '/ai-backtesting/') },
          { text: labels.algorithms, link: pathFor(locale, '/algorithms') },
          { text: labels.architecture, link: pathFor(locale, '/architecture') },
          { text: labels.api, link: pathFor(locale, '/api') },
          { text: labels.updates, link: pathFor(locale, '/updates/') },
          { text: labels.legal, link: pathFor(locale, '/legal/') }
        ]
      }
    ]
  };
}

function createThemeConfig(locale: '' | 'ko' | 'ja', labels: LocaleLabels) {
  return {
    logo: '/favicon.svg',
    search: {
      provider: 'local' as const
    },
    nav: createNav(locale, labels),
    sidebar: createSidebar(locale, labels),
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cheesss/lattice-current' }
    ],
    outline: {
      level: [2, 3]
    },
    docFooter: {
      prev: locale === 'ko' ? '이전' : locale === 'ja' ? '前へ' : 'Previous',
      next: locale === 'ko' ? '다음' : locale === 'ja' ? '次へ' : 'Next'
    },
    lastUpdatedText: locale === 'ko' ? '마지막 업데이트' : locale === 'ja' ? '最終更新' : 'Last updated',
    footer: {
      message: labels.footerMessage,
      copyright: 'Copyright 2024-2026 Elie Habib'
    }
  };
}

const en: LocaleLabels = {
  home: 'Home',
  gettingStarted: 'Getting Started',
  variants: 'Variants',
  playground: 'Playground',
  features: 'Features',
  aiBacktesting: 'AI & Backtesting',
  algorithms: 'Algorithms',
  architecture: 'Architecture',
  api: 'API',
  updates: 'Updates',
  legal: 'Legal',
  featuresOverview: 'Overview',
  liveIntelligence: 'Live Intelligence',
  investmentReplay: 'Investment & Replay',
  interactiveDemo: 'Interactive Demo',
  legalOverview: 'Overview',
  licensing: 'Licensing & Content',
  updatesOverview: 'Overview',
  docs: 'Docs',
  footerMessage: 'Code licensed under AGPL-3.0-only. Public docs and media follow separate content policies.',
  docsLaunch: '2026-03 Docs Launch'
};

const ko: LocaleLabels = {
  home: '홈',
  gettingStarted: '시작하기',
  variants: '변형',
  playground: '플레이그라운드',
  features: '기능',
  aiBacktesting: 'AI · 백테스트',
  algorithms: '알고리즘',
  architecture: '아키텍처',
  api: 'API',
  updates: '업데이트',
  legal: '법적 고지',
  featuresOverview: '개요',
  liveIntelligence: '실시간 인텔리전스',
  investmentReplay: '투자 · 리플레이',
  interactiveDemo: '인터랙티브 데모',
  legalOverview: '개요',
  licensing: '라이선스 · 콘텐츠',
  updatesOverview: '개요',
  docs: '문서',
  footerMessage: '코드는 AGPL-3.0-only로 제공되며, 공개 문서와 미디어는 별도 콘텐츠 정책을 따릅니다.',
  docsLaunch: '2026-03 문서 사이트 공개'
};

const ja: LocaleLabels = {
  home: 'ホーム',
  gettingStarted: '開始ガイド',
  variants: 'バリアント',
  playground: 'Playground',
  features: '機能',
  aiBacktesting: 'AI・バックテスト',
  algorithms: 'アルゴリズム',
  architecture: 'アーキテクチャ',
  api: 'API',
  updates: '更新',
  legal: '法務',
  featuresOverview: '概要',
  liveIntelligence: 'ライブインテリジェンス',
  investmentReplay: '投資・リプレイ',
  interactiveDemo: 'Interactive Demo',
  legalOverview: '概要',
  licensing: 'ライセンス・コンテンツ',
  updatesOverview: '概要',
  docs: 'ドキュメント',
  footerMessage: 'コードは AGPL-3.0-only で提供され、公開ドキュメントとメディアには別のコンテンツ方針が適用されます。',
  docsLaunch: '2026-03 ドキュメント公開'
};

export default defineConfig({
  title: 'Lattice Current',
  description: 'Real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.',
  lang: 'en-US',
  base: '/lattice-current/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/lattice-current/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'Lattice Current' }],
    ['meta', { property: 'og:description', content: 'Real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.' }],
    ['meta', { property: 'og:image', content: 'https://cheesss.github.io/lattice-current/images/hero/lattice-current-social-preview.png' }]
  ],
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      title: 'Lattice Current',
      description: 'Real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.',
      themeConfig: createThemeConfig('', en)
    },
    ko: {
      label: '한국어',
      lang: 'ko-KR',
      link: '/ko/',
      title: 'Lattice Current',
      description: '실시간 글로벌 인텔리전스, AI 보조 분석, 히스토리컬 리플레이, 백테스트 문서.',
      themeConfig: createThemeConfig('ko', ko)
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      link: '/ja/',
      title: 'Lattice Current',
      description: 'リアルタイム・インテリジェンス、AI 補助分析、ヒストリカル・リプレイ、バックテストのドキュメント。',
      themeConfig: createThemeConfig('ja', ja)
    }
  }
});

