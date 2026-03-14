import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"API","description":"","frontmatter":{"title":"API","summary":"OpenAPI and service-domain entry points for programmatic access.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"api.md","filePath":"api.md","lastUpdated":null}');
const _sfc_main = { name: "api.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="api" tabindex="-1">API <a class="header-anchor" href="#api" aria-label="Permalink to &quot;API&quot;">​</a></h1><p>World Monitor exposes multiple typed service domains. Public API docs in this repository are maintained as OpenAPI artifacts.</p><h2 id="main-references" tabindex="-1">Main references <a class="header-anchor" href="#main-references" aria-label="Permalink to &quot;Main references&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/tree/main/docs/api" target="_blank" rel="noreferrer">API docs directory</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ADDING_ENDPOINTS.md" target="_blank" rel="noreferrer">Adding endpoints guide</a></li></ul><h2 id="service-families" tabindex="-1">Service families <a class="header-anchor" href="#service-families" aria-label="Permalink to &quot;Service families&quot;">​</a></h2><ul><li>News</li><li>Market</li><li>Conflict</li><li>Maritime</li><li>Cyber</li><li>Climate</li><li>Displacement</li><li>Research</li><li>Intelligence</li></ul><h2 id="notes" tabindex="-1">Notes <a class="header-anchor" href="#notes" aria-label="Permalink to &quot;Notes&quot;">​</a></h2><p>The docs site is a navigation layer over the repository reference docs. Deeper schema details remain in the generated OpenAPI files.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("api.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const api = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  api as default
};
