#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT = path.resolve(process.cwd(), 'site/public/images/hero/lattice-current-social-preview.png');

const html = String.raw`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Lattice Current Social Preview</title>
    <style>
      :root {
        color-scheme: dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: #e5eef9;
        background:
          radial-gradient(circle at 14% 18%, rgba(90, 169, 255, 0.34), transparent 28%),
          radial-gradient(circle at 82% 20%, rgba(255, 191, 107, 0.22), transparent 26%),
          radial-gradient(circle at 76% 84%, rgba(255, 106, 106, 0.18), transparent 28%),
          linear-gradient(135deg, #06111f 0%, #0e1628 48%, #131f34 100%);
        overflow: hidden;
      }
      .frame {
        position: relative;
        display: grid;
        grid-template-columns: 1.1fr 0.9fr;
        gap: 28px;
        width: 100%;
        height: 100%;
        padding: 56px;
      }
      .eyebrow {
        display: inline-flex;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(86, 162, 235, 0.14);
        border: 1px solid rgba(147, 197, 253, 0.22);
        font-size: 15px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 14px;
        font-size: 72px;
        line-height: 0.94;
        letter-spacing: -0.04em;
      }
      .gradient {
        background: linear-gradient(120deg, #9bd8ff 0%, #ffd89c 46%, #ff8174 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .lead {
        max-width: 560px;
        margin: 0;
        color: #c6d4e8;
        font-size: 24px;
        line-height: 1.35;
      }
      .pill-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 26px;
      }
      .pill {
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.42);
        color: #d7e2f0;
        font-size: 16px;
      }
      .card-wall {
        position: relative;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: minmax(130px, auto);
        gap: 14px;
        align-self: stretch;
      }
      .card {
        position: relative;
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background:
          radial-gradient(circle at top right, rgba(86, 162, 235, 0.12), transparent 34%),
          linear-gradient(180deg, rgba(10, 19, 34, 0.9), rgba(16, 25, 43, 0.94));
        box-shadow: 0 20px 44px rgba(2, 8, 22, 0.26);
        padding: 18px;
      }
      .card .label {
        color: #8fd1ff;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .card h2 {
        margin: 10px 0 8px;
        font-size: 28px;
        line-height: 1.04;
      }
      .card p {
        margin: 0;
        color: #c7d3e3;
        font-size: 15px;
        line-height: 1.4;
      }
      .card.tall {
        grid-row: span 2;
      }
      .signal-grid {
        position: absolute;
        inset: auto 18px 18px 18px;
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 6px;
      }
      .signal-grid span {
        height: 12px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(59, 130, 246, 0.88), rgba(251, 191, 36, 0.88));
        opacity: 0.32;
      }
      .signal-grid span:nth-child(2n) { opacity: 0.54; }
      .signal-grid span:nth-child(3n) { opacity: 0.74; }
      .footer {
        position: absolute;
        left: 56px;
        right: 56px;
        bottom: 28px;
        display: flex;
        justify-content: space-between;
        color: #9cb3cf;
        font-size: 18px;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div>
        <div class="eyebrow">Independent Research Fork</div>
        <h1><span class="gradient">Lattice Current</span></h1>
        <p class="lead">
          Real-time global intelligence, AI-assisted analysis, ontology graphs, event-to-market transmission, and historical replay.
        </p>
        <div class="pill-row">
          <span class="pill">Live Intelligence</span>
          <span class="pill">Ontology Graph</span>
          <span class="pill">Replay & Backtesting</span>
          <span class="pill">Resource Profiling</span>
        </div>
      </div>
      <div class="card-wall">
        <div class="card tall">
          <div class="label">Decision Loop</div>
          <h2>Signal -> Score -> Connect -> Replay</h2>
          <p>Evidence-first monitoring with adaptive priors, regime-aware analytics, and validation paths.</p>
          <div class="signal-grid">
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </div>
        </div>
        <div class="card">
          <div class="label">Graph Context</div>
          <h2>Entity + relation topology</h2>
          <p>Constrained graph state, inferred links, and interactive architecture views.</p>
        </div>
        <div class="card">
          <div class="label">Market Transmission</div>
          <h2>Assets, sectors, and spillover</h2>
          <p>Story propagation mapped into investable themes and replayable backtests.</p>
        </div>
      </div>
      <div class="footer">
        <span>github.com/cheesss/lattice-current</span>
        <span>cheesss.github.io/lattice-current</span>
      </div>
    </div>
  </body>
</html>
`;

async function main() {
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: OUTPUT, type: 'png' });
  await browser.close();
  console.log(OUTPUT);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
