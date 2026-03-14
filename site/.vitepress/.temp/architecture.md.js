import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Architecture","description":"","frontmatter":{"title":"Architecture","summary":"Frontend, services, desktop sidecar, data flows, and archive layers.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"architecture.md","filePath":"architecture.md","lastUpdated":null}');
const _sfc_main = { name: "architecture.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="architecture" tabindex="-1">Architecture <a class="header-anchor" href="#architecture" aria-label="Permalink to &quot;Architecture&quot;">​</a></h1><h2 id="main-subsystems" tabindex="-1">Main subsystems <a class="header-anchor" href="#main-subsystems" aria-label="Permalink to &quot;Main subsystems&quot;">​</a></h2><ul><li>frontend app shell and panel system</li><li>domain services and analysis modules</li><li>desktop sidecar and local APIs</li><li>historical replay and archive services</li><li>generated service contracts and OpenAPI surfaces</li></ul><h2 id="reference-docs" tabindex="-1">Reference docs <a class="header-anchor" href="#reference-docs" aria-label="Permalink to &quot;Reference docs&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">Architecture deep dive</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/DESKTOP_APP.md" target="_blank" rel="noreferrer">Desktop runtime</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/historical-data-sources.md" target="_blank" rel="noreferrer">Historical data sources</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/intelligence-server-schema.sql" target="_blank" rel="noreferrer">Intelligence server schema</a></li></ul><h2 id="public-boundary" tabindex="-1">Public boundary <a class="header-anchor" href="#public-boundary" aria-label="Permalink to &quot;Public boundary&quot;">​</a></h2><p>This site documents architecture decisions and major flows while omitting private operations, secrets, and sensitive deployment details.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("architecture.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const architecture = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  architecture as default
};
