import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"AI & Backtesting","description":"","frontmatter":{"title":"AI & Backtesting","summary":"How the AI layer, investment logic, and replay engine fit together.","status":"beta","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"ai-backtesting/index.md","filePath":"ai-backtesting/index.md","lastUpdated":null}');
const _sfc_main = { name: "ai-backtesting/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="ai-backtesting" tabindex="-1">AI &amp; Backtesting <a class="header-anchor" href="#ai-backtesting" aria-label="Permalink to &quot;AI &amp; Backtesting&quot;">​</a></h1><p>This section groups the project documents that explain how AI, investment logic, and replay are integrated.</p><h2 id="core-artifacts" tabindex="-1">Core artifacts <a class="header-anchor" href="#core-artifacts" aria-label="Permalink to &quot;Core artifacts&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ai_backtest_analysis.md" target="_blank" rel="noreferrer">AI and backtesting integration analysis</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/improvement_plan_60_points.md" target="_blank" rel="noreferrer">Improvement plan: 60 concrete areas</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ux_visualization_improvements.md" target="_blank" rel="noreferrer">UX and visualization improvements</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/investment-usage-playbook.md" target="_blank" rel="noreferrer">Investment usage playbook</a></li></ul><h2 id="integrated-flow" tabindex="-1">Integrated flow <a class="header-anchor" href="#integrated-flow" aria-label="Permalink to &quot;Integrated flow&quot;">​</a></h2><ol><li>live feeds and structured services create a current snapshot</li><li>AI and graph layers build evidence-grounded context</li><li>investment logic maps themes to assets and creates idea candidates</li><li>replay and walk-forward backtesting evaluate those ideas over time</li><li>learned priors flow back into live decision support</li></ol><h2 id="current-limits" tabindex="-1">Current limits <a class="header-anchor" href="#current-limits" aria-label="Permalink to &quot;Current limits&quot;">​</a></h2><ul><li>some probabilistic layers remain practical approximations</li><li>replay quality depends on point-in-time data completeness</li><li>learned sizing still mixes adaptive priors with hard guardrails</li></ul><h2 id="read-next" tabindex="-1">Read next <a class="header-anchor" href="#read-next" aria-label="Permalink to &quot;Read next&quot;">​</a></h2><ul><li><a href="/worldmonitor/algorithms">Algorithms</a></li><li><a href="/worldmonitor/architecture">Architecture</a></li><li><a href="/worldmonitor/features/investment-replay">Features / Investment &amp; Replay</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("ai-backtesting/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
