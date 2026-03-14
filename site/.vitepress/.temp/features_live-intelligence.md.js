import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Live Intelligence","description":"","frontmatter":{"title":"Live Intelligence","summary":"Live map, alerts, graph context, and cross-variant monitoring surfaces.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"features/live-intelligence.md","filePath":"features/live-intelligence.md","lastUpdated":null}');
const _sfc_main = { name: "features/live-intelligence.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="live-intelligence" tabindex="-1">Live Intelligence <a class="header-anchor" href="#live-intelligence" aria-label="Permalink to &quot;Live Intelligence&quot;">​</a></h1><h2 id="what-it-does" tabindex="-1">What it does <a class="header-anchor" href="#what-it-does" aria-label="Permalink to &quot;What it does&quot;">​</a></h2><p>Turns live feeds, map layers, scores, and AI summaries into a single operational surface.</p><h2 id="why-it-exists" tabindex="-1">Why it exists <a class="header-anchor" href="#why-it-exists" aria-label="Permalink to &quot;Why it exists&quot;">​</a></h2><p>To reduce context switching across news feeds, maps, and separate market tools.</p><h2 id="inputs" tabindex="-1">Inputs <a class="header-anchor" href="#inputs" aria-label="Permalink to &quot;Inputs&quot;">​</a></h2><ul><li>curated feeds and APIs</li><li>map layers and geospatial assets</li><li>source credibility and signal aggregation outputs</li><li>AI summaries and ontology context</li></ul><h2 id="outputs" tabindex="-1">Outputs <a class="header-anchor" href="#outputs" aria-label="Permalink to &quot;Outputs&quot;">​</a></h2><ul><li>live panels and map overlays</li><li>alert cards and instability scores</li><li>focal points and transmission leads</li></ul><h2 id="key-ui-surfaces" tabindex="-1">Key UI surfaces <a class="header-anchor" href="#key-ui-surfaces" aria-label="Permalink to &quot;Key UI surfaces&quot;">​</a></h2><ul><li>map and layer controls</li><li>live news panels</li><li>analysis hub and ontology pages</li><li>strategic and country-level summaries</li></ul><h2 id="algorithms-involved" tabindex="-1">Algorithms involved <a class="header-anchor" href="#algorithms-involved" aria-label="Permalink to &quot;Algorithms involved&quot;">​</a></h2><ul><li>signal aggregation</li><li>source credibility</li><li>convergence and instability scoring</li><li>ontology graph enrichment</li></ul><h2 id="limits" tabindex="-1">Limits <a class="header-anchor" href="#limits" aria-label="Permalink to &quot;Limits&quot;">​</a></h2><p>Public docs do not expose sensitive operational connectors or private sources.</p><h2 id="variant-coverage" tabindex="-1">Variant coverage <a class="header-anchor" href="#variant-coverage" aria-label="Permalink to &quot;Variant coverage&quot;">​</a></h2><p>Applies across <code>full</code>, <code>tech</code>, and <code>finance</code> with domain-specific feeds and panels.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("features/live-intelligence.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const liveIntelligence = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  liveIntelligence as default
};
