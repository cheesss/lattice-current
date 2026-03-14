import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Features","description":"","frontmatter":{"title":"Features","summary":"Product capability index across live monitoring, analysis, and replay.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"features/index.md","filePath":"features/index.md","lastUpdated":null}');
const _sfc_main = { name: "features/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="features" tabindex="-1">Features <a class="header-anchor" href="#features" aria-label="Permalink to &quot;Features&quot;">​</a></h1><h2 id="capability-groups" tabindex="-1">Capability groups <a class="header-anchor" href="#capability-groups" aria-label="Permalink to &quot;Capability groups&quot;">​</a></h2><ul><li><a href="/worldmonitor/features/live-intelligence">Live Intelligence</a></li><li><a href="/worldmonitor/features/investment-replay">Investment &amp; Replay</a></li></ul><h2 id="deep-references" tabindex="-1">Deep references <a class="header-anchor" href="#deep-references" aria-label="Permalink to &quot;Deep references&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/ARCHITECTURE.md" target="_blank" rel="noreferrer">Architecture deep dive</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/DATA_SOURCES.md" target="_blank" rel="noreferrer">Data sources reference</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/docs/DESKTOP_APP.md" target="_blank" rel="noreferrer">Desktop runtime guide</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("features/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
