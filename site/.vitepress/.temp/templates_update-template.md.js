import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Update Template","description":"","frontmatter":{"title":"Update Template","summary":"Standard structure for release and feature update notes.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"docs"},"headers":[],"relativePath":"templates/update-template.md","filePath":"templates/update-template.md","lastUpdated":null}');
const _sfc_main = { name: "templates/update-template.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="update-template" tabindex="-1">Update Template <a class="header-anchor" href="#update-template" aria-label="Permalink to &quot;Update Template&quot;">​</a></h1><div class="template-callout"> Use this structure for user-facing release notes, docs updates, and feature announcements. </div><h2 id="what-changed" tabindex="-1">What changed <a class="header-anchor" href="#what-changed" aria-label="Permalink to &quot;What changed&quot;">​</a></h2><h2 id="why-it-matters" tabindex="-1">Why it matters <a class="header-anchor" href="#why-it-matters" aria-label="Permalink to &quot;Why it matters&quot;">​</a></h2><h2 id="user-impact" tabindex="-1">User impact <a class="header-anchor" href="#user-impact" aria-label="Permalink to &quot;User impact&quot;">​</a></h2><h2 id="migration-or-config-changes" tabindex="-1">Migration or config changes <a class="header-anchor" href="#migration-or-config-changes" aria-label="Permalink to &quot;Migration or config changes&quot;">​</a></h2><h2 id="screenshots-diagrams" tabindex="-1">Screenshots / diagrams <a class="header-anchor" href="#screenshots-diagrams" aria-label="Permalink to &quot;Screenshots / diagrams&quot;">​</a></h2></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("templates/update-template.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const updateTemplate = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  updateTemplate as default
};
