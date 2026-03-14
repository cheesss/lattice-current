import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"2026-03 Docs Launch","description":"","frontmatter":{"title":"2026-03 Docs Launch","summary":"Introduced the GitHub Pages docs site, publication policy docs, and public documentation templates.","status":"stable","variants":["full","tech","finance"],"updated":"2026-03-15T00:00:00.000Z","owner":"core"},"headers":[],"relativePath":"updates/2026-03-docs-launch.md","filePath":"updates/2026-03-docs-launch.md","lastUpdated":null}');
const _sfc_main = { name: "updates/2026-03-docs-launch.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="_2026-03-github-pages-docs-launch-and-publication-policy" tabindex="-1">2026-03: GitHub Pages docs launch and publication policy <a class="header-anchor" href="#_2026-03-github-pages-docs-launch-and-publication-policy" aria-label="Permalink to &quot;2026-03: GitHub Pages docs launch and publication policy&quot;">​</a></h1><h2 id="what-changed" tabindex="-1">What changed <a class="header-anchor" href="#what-changed" aria-label="Permalink to &quot;What changed&quot;">​</a></h2><ul><li>Added a VitePress-based docs site inside the repository</li><li>Added explicit legal and content-policy documents</li><li>Added a docs navigation layer over architecture, algorithm, AI, and API references</li><li>Added templates for future feature pages and update posts</li></ul><h2 id="why-it-matters" tabindex="-1">Why it matters <a class="header-anchor" href="#why-it-matters" aria-label="Permalink to &quot;Why it matters&quot;">​</a></h2><p>The repository now has a stable public documentation surface distinct from the live product and internal operating detail.</p><h2 id="user-impact" tabindex="-1">User impact <a class="header-anchor" href="#user-impact" aria-label="Permalink to &quot;User impact&quot;">​</a></h2><p>New contributors and users can understand the project from a curated docs site instead of scanning the entire repository.</p><h2 id="migration-notes" tabindex="-1">Migration notes <a class="header-anchor" href="#migration-notes" aria-label="Permalink to &quot;Migration notes&quot;">​</a></h2><p>Future user-facing features should update at least one docs page or update post.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("updates/2026-03-docs-launch.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const _202603DocsLaunch = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  _202603DocsLaunch as default
};
