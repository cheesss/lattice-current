import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Licensing & Content","description":"","frontmatter":{"title":"Licensing & Content","summary":"How code, docs, screenshots, brand assets, and third-party material are treated.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"legal/licensing.md","filePath":"legal/licensing.md","lastUpdated":null}');
const _sfc_main = { name: "legal/licensing.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="licensing-content" tabindex="-1">Licensing &amp; Content <a class="header-anchor" href="#licensing-content" aria-label="Permalink to &quot;Licensing &amp; Content&quot;">​</a></h1><h2 id="code" tabindex="-1">Code <a class="header-anchor" href="#code" aria-label="Permalink to &quot;Code&quot;">​</a></h2><ul><li>The repository source code is licensed under <code>AGPL-3.0-only</code></li><li>Public network use of modified versions triggers AGPL obligations</li></ul><h2 id="documentation-and-screenshots" tabindex="-1">Documentation and screenshots <a class="header-anchor" href="#documentation-and-screenshots" aria-label="Permalink to &quot;Documentation and screenshots&quot;">​</a></h2><ul><li>Project-authored docs can be published publicly</li><li>Public screenshots should be sanitized</li><li>Long third-party article excerpts should not be redistributed</li></ul><h2 id="brand-and-identity" tabindex="-1">Brand and identity <a class="header-anchor" href="#brand-and-identity" aria-label="Permalink to &quot;Brand and identity&quot;">​</a></h2><ul><li>The project name may be used factually</li><li>Forks should not imply they are the official distribution</li></ul><h2 id="policy-references" tabindex="-1">Policy references <a class="header-anchor" href="#policy-references" aria-label="Permalink to &quot;Policy references&quot;">​</a></h2><ul><li><a href="https://github.com/cheesss/worldmonitor/blob/main/LICENSE" target="_blank" rel="noreferrer">LICENSE</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/COPYRIGHT.md" target="_blank" rel="noreferrer">COPYRIGHT.md</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/CONTENT_POLICY.md" target="_blank" rel="noreferrer">CONTENT_POLICY.md</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">THIRD_PARTY_NOTICES.md</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/TRADEMARKS.md" target="_blank" rel="noreferrer">TRADEMARKS.md</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("legal/licensing.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const licensing = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  licensing as default
};
