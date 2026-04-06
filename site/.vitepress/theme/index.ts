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
import OperationsConsoleDemo from './components/OperationsConsoleDemo.vue';
import InteractiveGlobeHero from './components/InteractiveGlobeHero.vue';
import AppGradeGlobeShowcase from './components/AppGradeGlobeShowcase.vue';
import AppGradeFlatMapShowcase from './components/AppGradeFlatMapShowcase.vue';
import ReplayScenarioWorkbench from './components/ReplayScenarioWorkbench.vue';
import SignalLandingHero from './components/SignalLandingHero.vue';
import ImmersiveMainLanding from './components/ImmersiveMainLanding.vue';

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
    app.component('OperationsConsoleDemo', OperationsConsoleDemo);
    app.component('InteractiveGlobeHero', InteractiveGlobeHero);
    app.component('AppGradeGlobeShowcase', AppGradeGlobeShowcase);
    app.component('AppGradeFlatMapShowcase', AppGradeFlatMapShowcase);
    app.component('ReplayScenarioWorkbench', ReplayScenarioWorkbench);
    app.component('SignalLandingHero', SignalLandingHero);
    app.component('ImmersiveMainLanding', ImmersiveMainLanding);
  }
};

export default theme;
