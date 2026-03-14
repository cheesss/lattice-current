import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Investment & Replay","description":"","frontmatter":{"title":"Investment & Replay","summary":"Event-to-asset mapping, idea support, replay, and walk-forward evaluation.","status":"beta","variants":["finance","tech"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"features/investment-replay.md","filePath":"features/investment-replay.md","lastUpdated":null}');
const _sfc_main = { name: "features/investment-replay.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="investment-replay" tabindex="-1">Investment &amp; Replay <a class="header-anchor" href="#investment-replay" aria-label="Permalink to &quot;Investment &amp; Replay&quot;">​</a></h1><h2 id="what-it-does" tabindex="-1">What it does <a class="header-anchor" href="#what-it-does" aria-label="Permalink to &quot;What it does&quot;">​</a></h2><p>Connects live events to assets, produces decision-support objects, and validates them with replay and backtesting.</p><h2 id="why-it-exists" tabindex="-1">Why it exists <a class="header-anchor" href="#why-it-exists" aria-label="Permalink to &quot;Why it exists&quot;">​</a></h2><p>To turn narrative monitoring into testable, reviewable decision workflows.</p><h2 id="inputs" tabindex="-1">Inputs <a class="header-anchor" href="#inputs" aria-label="Permalink to &quot;Inputs&quot;">​</a></h2><ul><li>events, themes, and transmission outputs</li><li>market time series</li><li>source and mapping priors</li><li>historical replay frames</li></ul><h2 id="outputs" tabindex="-1">Outputs <a class="header-anchor" href="#outputs" aria-label="Permalink to &quot;Outputs&quot;">​</a></h2><ul><li>investment idea cards</li><li>sizing and false-positive guardrails</li><li>replay and walk-forward run summaries</li><li>backtest lab visuals and decision comparisons</li></ul><h2 id="key-ui-surfaces" tabindex="-1">Key UI surfaces <a class="header-anchor" href="#key-ui-surfaces" aria-label="Permalink to &quot;Key UI surfaces&quot;">​</a></h2><ul><li>Investment Workflow</li><li>Auto Investment Ideas</li><li>Backtest Lab</li><li>Transmission Sankey / Network</li></ul><h2 id="algorithms-involved" tabindex="-1">Algorithms involved <a class="header-anchor" href="#algorithms-involved" aria-label="Permalink to &quot;Algorithms involved&quot;">​</a></h2><ul><li>event-to-market transmission</li><li>regime weighting</li><li>Kalman-style adaptive weighting</li><li>Hawkes intensity, transfer entropy, bandits</li><li>historical replay and warm-up handling</li></ul><h2 id="limits" tabindex="-1">Limits <a class="header-anchor" href="#limits" aria-label="Permalink to &quot;Limits&quot;">​</a></h2><p>The public site documents the system behavior but not private operational data or sensitive market configurations.</p><h2 id="variant-coverage" tabindex="-1">Variant coverage <a class="header-anchor" href="#variant-coverage" aria-label="Permalink to &quot;Variant coverage&quot;">​</a></h2><p>Primary: <code>finance</code>. Extended and shared support also exists in <code>tech</code>.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("features/investment-replay.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const investmentReplay = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  investmentReplay as default
};
