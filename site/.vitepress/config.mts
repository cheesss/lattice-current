import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Lattice Current',
  description: 'Real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.',
  lang: 'en-US',
  base: '/lattice-current/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'Lattice Current' }],
    ['meta', { property: 'og:description', content: 'Real-time global intelligence, AI-assisted analysis, historical replay, and backtesting.' }],
    ['meta', { property: 'og:image', content: 'https://cheesss.github.io/lattice-current/images/hero/social-card.svg' }]
  ],
  themeConfig: {
    logo: '/favicon.svg',
    search: {
      provider: 'local'
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Variants', link: '/variants' },
      { text: 'Features', link: '/features/' },
      { text: 'AI & Backtesting', link: '/ai-backtesting/' },
      { text: 'Algorithms', link: '/algorithms' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'API', link: '/api' },
      { text: 'Updates', link: '/updates/' },
      { text: 'Legal', link: '/legal/' }
    ],
    sidebar: {
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Live Intelligence', link: '/features/live-intelligence' },
            { text: 'Investment & Replay', link: '/features/investment-replay' }
          ]
        }
      ],
      '/ai-backtesting/': [
        {
          text: 'AI & Backtesting',
          items: [
            { text: 'Overview', link: '/ai-backtesting/' }
          ]
        }
      ],
      '/updates/': [
        {
          text: 'Updates',
          items: [
            { text: 'Overview', link: '/updates/' },
            { text: '2026-03 Docs Launch', link: '/updates/2026-03-docs-launch' }
          ]
        }
      ],
      '/legal/': [
        {
          text: 'Legal',
          items: [
            { text: 'Overview', link: '/legal/' },
            { text: 'Licensing & Content', link: '/legal/licensing' }
          ]
        }
      ],
      '/': [
        {
          text: 'Docs',
          items: [
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'Variants', link: '/variants' },
            { text: 'Features', link: '/features/' },
            { text: 'AI & Backtesting', link: '/ai-backtesting/' },
            { text: 'Algorithms', link: '/algorithms' },
            { text: 'Architecture', link: '/architecture' },
            { text: 'API', link: '/api' },
            { text: 'Updates', link: '/updates/' },
            { text: 'Legal', link: '/legal/' },
            { text: 'Feature Page Template', link: '/templates/feature-template' },
            { text: 'Update Template', link: '/templates/update-template' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cheesss/lattice-current' }
    ],
    footer: {
      message: 'Code licensed under AGPL-3.0-only. Public docs and media follow separate content policies.',
      copyright: 'Copyright 2024-2026 Elie Habib'
    }
  }
});