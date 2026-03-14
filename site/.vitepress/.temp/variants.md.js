import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Variants","description":"","frontmatter":{"title":"Variants","summary":"Product variants served from one repository and shared runtime.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"variants.md","filePath":"variants.md","lastUpdated":null}');
const _sfc_main = { name: "variants.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="variants" tabindex="-1">Variants <a class="header-anchor" href="#variants" aria-label="Permalink to &quot;Variants&quot;">​</a></h1><p>World Monitor is one repository with multiple product surfaces.</p><table tabindex="0"><thead><tr><th>Variant</th><th>Focus</th><th>Typical user</th></tr></thead><tbody><tr><td><code>full</code></td><td>geopolitics, conflict, infrastructure, intelligence</td><td>analyst, operator, OSINT monitor</td></tr><tr><td><code>tech</code></td><td>AI, cloud, startup, cyber, ecosystem mapping</td><td>tech strategy, venture, platform research</td></tr><tr><td><code>finance</code></td><td>macro, cross-asset, market transmission, replay, ideas</td><td>macro and event-driven research</td></tr></tbody></table><h2 id="shared-foundations" tabindex="-1">Shared foundations <a class="header-anchor" href="#shared-foundations" aria-label="Permalink to &quot;Shared foundations&quot;">​</a></h2><p>All variants use the same core for:</p><ul><li>data collection and normalization</li><li>AI-assisted summaries and Q&amp;A</li><li>ontology and graph services</li><li>event transmission modeling</li><li>replay and backtesting primitives</li></ul><h2 id="variant-aware-docs" tabindex="-1">Variant-aware docs <a class="header-anchor" href="#variant-aware-docs" aria-label="Permalink to &quot;Variant-aware docs&quot;">​</a></h2><p>When a page applies to only some variants, the frontmatter and content should state that explicitly.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("variants.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const variants = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  variants as default
};
