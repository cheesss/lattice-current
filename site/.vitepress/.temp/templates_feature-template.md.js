import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Feature Page Template","description":"","frontmatter":{"title":"Feature Page Template","summary":"Standard structure for new feature documentation pages.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"docs"},"headers":[],"relativePath":"templates/feature-template.md","filePath":"templates/feature-template.md","lastUpdated":null}');
const _sfc_main = { name: "templates/feature-template.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="feature-page-template" tabindex="-1">Feature Page Template <a class="header-anchor" href="#feature-page-template" aria-label="Permalink to &quot;Feature Page Template&quot;">​</a></h1><div class="template-callout"> Use this structure whenever a new public-facing feature, workflow, or panel needs documentation. </div><h2 id="what-it-does" tabindex="-1">What it does <a class="header-anchor" href="#what-it-does" aria-label="Permalink to &quot;What it does&quot;">​</a></h2><h2 id="why-it-exists" tabindex="-1">Why it exists <a class="header-anchor" href="#why-it-exists" aria-label="Permalink to &quot;Why it exists&quot;">​</a></h2><h2 id="inputs" tabindex="-1">Inputs <a class="header-anchor" href="#inputs" aria-label="Permalink to &quot;Inputs&quot;">​</a></h2><h2 id="outputs" tabindex="-1">Outputs <a class="header-anchor" href="#outputs" aria-label="Permalink to &quot;Outputs&quot;">​</a></h2><h2 id="key-ui-surfaces" tabindex="-1">Key UI surfaces <a class="header-anchor" href="#key-ui-surfaces" aria-label="Permalink to &quot;Key UI surfaces&quot;">​</a></h2><h2 id="algorithms-involved" tabindex="-1">Algorithms involved <a class="header-anchor" href="#algorithms-involved" aria-label="Permalink to &quot;Algorithms involved&quot;">​</a></h2><h2 id="limits-caveats" tabindex="-1">Limits / caveats <a class="header-anchor" href="#limits-caveats" aria-label="Permalink to &quot;Limits / caveats&quot;">​</a></h2><h2 id="variant-coverage" tabindex="-1">Variant coverage <a class="header-anchor" href="#variant-coverage" aria-label="Permalink to &quot;Variant coverage&quot;">​</a></h2></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("templates/feature-template.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const featureTemplate = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  featureTemplate as default
};
