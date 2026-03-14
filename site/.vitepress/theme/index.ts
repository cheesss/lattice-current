import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import DecisionLoop from './components/DecisionLoop.vue';
import FeatureExplorer from './components/FeatureExplorer.vue';
import SystemTopology from './components/SystemTopology.vue';

const theme: Theme = {
  ...DefaultTheme,
  enhanceApp({ app }) {
    DefaultTheme.enhanceApp?.({ app });
    app.component('DecisionLoop', DecisionLoop);
    app.component('FeatureExplorer', FeatureExplorer);
    app.component('SystemTopology', SystemTopology);
  }
};

export default theme;
