import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Legal","description":"","frontmatter":{"title":"Legal","summary":"Code license, content policy, notices, and trademark guidance.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"legal/index.md","filePath":"legal/index.md","lastUpdated":null}');
const _sfc_main = { name: "legal/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="legal" tabindex="-1">Legal <a class="header-anchor" href="#legal" aria-label="Permalink to &quot;Legal&quot;">​</a></h1><h2 id="core-policies" tabindex="-1">Core policies <a class="header-anchor" href="#core-policies" aria-label="Permalink to &quot;Core policies&quot;">​</a></h2><ul><li><a href="/worldmonitor/legal/licensing">Licensing &amp; Content</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/COPYRIGHT.md" target="_blank" rel="noreferrer">Copyright</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/CONTENT_POLICY.md" target="_blank" rel="noreferrer">Content Policy</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Third-Party Notices</a></li><li><a href="https://github.com/cheesss/worldmonitor/blob/main/TRADEMARKS.md" target="_blank" rel="noreferrer">Trademarks</a></li></ul><h2 id="public-rule-of-thumb" tabindex="-1">Public rule of thumb <a class="header-anchor" href="#public-rule-of-thumb" aria-label="Permalink to &quot;Public rule of thumb&quot;">​</a></h2><p>Code is open. Content rights, screenshots, and third-party material are handled separately and more conservatively.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("legal/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
