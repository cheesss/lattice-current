import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import DecisionLoop from './components/DecisionLoop.vue';
import FeatureExplorer from './components/FeatureExplorer.vue';
import CapabilityConstellation from './components/CapabilityConstellation.vue';
import ScrollSignalStory from './components/ScrollSignalStory.vue';
import SystemTopology from './components/SystemTopology.vue';
import AudienceWorkbench from './components/AudienceWorkbench.vue';
import InteractivePlayground from './components/InteractivePlayground.vue';

const theme: Theme = {
  ...DefaultTheme,
  enhanceApp({ app }) {
    DefaultTheme.enhanceApp?.({ app });
    app.component('DecisionLoop', DecisionLoop);
    app.component('FeatureExplorer', FeatureExplorer);
    app.component('CapabilityConstellation', CapabilityConstellation);
    app.component('ScrollSignalStory', ScrollSignalStory);
    app.component('SystemTopology', SystemTopology);
    app.component('AudienceWorkbench', AudienceWorkbench);
    app.component('InteractivePlayground', InteractivePlayground);
  }
};

export default theme;
