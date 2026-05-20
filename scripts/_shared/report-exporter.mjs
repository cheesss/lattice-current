import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { renderReportHtml } from './report-compiler.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripTags(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value, length = 190) {
  const text = stripTags(value);
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function slideTextShape({ id, x, y, w, h, text, fontSize = 2200, bold = false }) {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
    <p:txBody>
      <a:bodyPr wrap="square"/><a:lstStyle/>
      <a:p><a:r><a:rPr lang="en-US" sz="${fontSize}"${bold ? ' b="1"' : ''}/><a:t>${escapeXml(text)}</a:t></a:r></a:p>
    </p:txBody>
  </p:sp>`;
}

function slideXml({ title, bullets = [] }) {
  const bulletText = bullets.slice(0, 7).map((item) => `- ${truncate(item, 165)}`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${slideTextShape({ id: 2, x: 540000, y: 360000, w: 8064000, h: 720000, text: title, fontSize: 3200, bold: true })}
      ${slideTextShape({ id: 3, x: 720000, y: 1320000, w: 7560000, h: 4200000, text: bulletText || 'No slide content available.', fontSize: 1900 })}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function buildSlides(bundle = {}, analysis = {}) {
  const title = bundle.subject?.displayName || bundle.reportId || 'Intelligence Report';
  const keyJudgments = asArray(analysis.keyJudgments).map((item) => item.text);
  const signalCards = asArray(analysis.signalCards).map((item) => `${item.title}: ${item.interpretation}`);
  const evidence = asArray(analysis.evidenceSynthesis).map((item) => item.text);
  const caveats = asArray(analysis.risks).map((item) => item.text);
  const watch = asArray(analysis.watchNext).map((item) => item.text || item.label);
  const sourceQueries = asArray(analysis.sourceQueries).map((item) => item.text);
  return [
    { title, bullets: [`Type: ${bundle.reportType}`, `As of: ${bundle.asOf}`, 'Scope: evidence-bound client memo'] },
    { title: 'Executive View', bullets: keyJudgments },
    { title: 'Signal Triage', bullets: signalCards },
    { title: 'Evidence Hierarchy', bullets: evidence },
    { title: 'Risks, Watch Triggers, Research Queue', bullets: [...caveats, ...watch, ...sourceQueries] },
  ];
}

function contentTypesXml(slideCount) {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;
}

function presentationXml(slideCount) {
  const slideIds = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(slideCount) {
  const slideRels = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Lattice Report Exporter</Application></Properties>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Lattice Intelligence Report</dc:title><dc:creator>Lattice</dc:creator></cp:coreProperties>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Lattice"><a:themeElements><a:clrScheme name="Lattice"><a:dk1><a:srgbClr val="0D0F13"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="151922"/></a:dk2><a:lt2><a:srgbClr val="E7ECF3"/></a:lt2><a:accent1><a:srgbClr val="D8F99D"/></a:accent1><a:accent2><a:srgbClr val="9AA7B7"/></a:accent2><a:accent3><a:srgbClr val="FBBF24"/></a:accent3><a:accent4><a:srgbClr val="FB7185"/></a:accent4><a:accent5><a:srgbClr val="7EE081"/></a:accent5><a:accent6><a:srgbClr val="60A5FA"/></a:accent6><a:hlink><a:srgbClr val="D8F99D"/></a:hlink><a:folHlink><a:srgbClr val="9AA7B7"/></a:folHlink></a:clrScheme><a:fontScheme name="Lattice"><a:majorFont><a:latin typeface="Segoe UI"/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/></a:minorFont></a:fontScheme><a:fmtScheme name="Lattice"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`;

export async function writeReportPrintHtml({ bundle, analysis, validation, reportDir }) {
  const html = renderReportHtml(bundle, { analysis, validation }).replace('</style>', `
    @media print{body{background:white;color:#111}section,.card,.figure-card{break-inside:avoid;background:white;color:#111;border-color:#ddd}.muted{color:#555}code{color:#111;background:#f5f5f5}.quality{background:white}}
  </style>`);
  const filePath = path.join(reportDir, 'report.print.html');
  await writeFile(filePath, html, 'utf8');
  return filePath;
}

export async function writeReportDeckArtifacts({ bundle, analysis, reportDir }) {
  const slides = buildSlides(bundle, analysis);
  const deckManifest = {
    reportId: bundle.reportId,
    generatedAt: new Date().toISOString(),
    format: 'pptx-compatible',
    slideCount: slides.length,
    slides,
  };
  await writeFile(path.join(reportDir, 'briefing-deck.json'), `${JSON.stringify(deckManifest, null, 2)}\n`, 'utf8');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml(slides.length));
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('docProps/app.xml', APP_XML);
  zip.file('docProps/core.xml', CORE_XML);
  zip.file('ppt/presentation.xml', presentationXml(slides.length));
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels(slides.length));
  zip.file('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS);
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS);
  zip.file('ppt/theme/theme1.xml', THEME);
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(slide));
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  });
  const pptx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const pptxPath = path.join(reportDir, 'briefing-deck.pptx');
  await writeFile(pptxPath, pptx);
  return { deckManifestPath: path.join(reportDir, 'briefing-deck.json'), pptxPath };
}

export async function writeReportPdf({ reportDir }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${path.resolve(reportDir, 'report.print.html').replace(/\\/g, '/')}`, { waitUntil: 'load' });
    const pdfPath = path.join(reportDir, 'report.pdf');
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    return pdfPath;
  } finally {
    await browser.close();
  }
}

export async function exportReportArtifacts({ bundle, analysis, validation, reportDir, pdf = false } = {}) {
  const printHtmlPath = await writeReportPrintHtml({ bundle, analysis, validation, reportDir });
  const deck = await writeReportDeckArtifacts({ bundle, analysis, reportDir });
  let pdfPath = null;
  let pdfError = null;
  if (pdf) {
    try {
      pdfPath = await writeReportPdf({ reportDir });
    } catch (error) {
      pdfError = String(error?.message || error);
      await writeFile(path.join(reportDir, 'report.pdf.error.json'), `${JSON.stringify({ ok: false, error: pdfError }, null, 2)}\n`, 'utf8');
    }
  }
  return {
    printHtmlPath,
    ...deck,
    pdfPath,
    pdfError,
  };
}

export async function loadReportArtifacts(reportDir) {
  const bundle = JSON.parse(await readFile(path.join(reportDir, 'bundle.json'), 'utf8'));
  const analysis = JSON.parse(await readFile(path.join(reportDir, 'llm-analysis.json'), 'utf8'));
  const validation = JSON.parse(await readFile(path.join(reportDir, 'validation.json'), 'utf8'));
  return { bundle, analysis, validation };
}
