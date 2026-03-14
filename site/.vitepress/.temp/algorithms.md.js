import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Algorithms","description":"","frontmatter":{"title":"Algorithms","summary":"Public-facing map of the major scoring, learning, and replay algorithms.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"algorithms.md","filePath":"algorithms.md","lastUpdated":null}');
const _sfc_main = { name: "algorithms.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="algorithms" tabindex="-1">Algorithms <a class="header-anchor" href="#algorithms" aria-label="Permalink to &quot;Algorithms&quot;">​</a></h1><p>World Monitor blends deterministic scoring, online priors, graph logic, and replay-based evaluation.</p><h2 id="major-groups" tabindex="-1">Major groups <a class="header-anchor" href="#major-groups" aria-label="Permalink to &quot;Major groups&quot;">​</a></h2><ul><li>source credibility and truth scoring</li><li>country instability and convergence scoring</li><li>event-to-market transmission</li><li>regime-aware weighting</li><li>ontology constraints and graph inference</li><li>replay and walk-forward backtesting</li></ul><h2 id="primary-references" tabindex="-1">Primary references <a class="header-anchor" href="#primary-references" aria-label="Permalink to &quot;Primary references&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ALGORITHMS.md" target="_blank" rel="noreferrer">Algorithms reference</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/AI_INTELLIGENCE.md" target="_blank" rel="noreferrer">AI intelligence reference</a></li><li><a href="/worldmonitor/ai-backtesting/">AI &amp; Backtesting</a></li></ul><h2 id="public-note" tabindex="-1">Public note <a class="header-anchor" href="#public-note" aria-label="Permalink to &quot;Public note&quot;">​</a></h2><p>The docs site intentionally explains logic at the capability and methodology level. It does not publish every sensitive operational threshold or connector detail.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("algorithms.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const algorithms = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  algorithms as default
};
