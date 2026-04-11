import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildThemeBriefExportPayload,
  buildThemeNotebookKey,
  loadSharedThemeNotebookEntry,
  loadThemeNotebookEntry,
  upsertThemeNotebookEntry,
  recordThemeNotebookExport,
} from '../scripts/_shared/trend-dashboard-queries.mjs';

function createNotebookSafeQuery() {
  const rows = new Map();

  return async (sql, params = []) => {
    const query = String(sql).trim();

    if (/^CREATE TABLE/i.test(query) || /^CREATE UNIQUE INDEX/i.test(query)) {
      return { rows: [], rowCount: 0, command: 'CREATE' };
    }

    if (query.includes('FROM theme_brief_notebooks') && query.includes('WHERE theme = $1 AND period_type = $2')) {
      const key = `${params[0]}::${params[1]}`;
      return { rows: rows.has(key) ? [rows.get(key)] : [] };
    }

    if (query.includes('FROM theme_brief_notebooks') && query.includes('WHERE share_token = $1')) {
      const token = String(params[0] || '');
      const row = Array.from(rows.values()).find((item) => item.share_token === token) || null;
      return { rows: row ? [row] : [] };
    }

    if (query.includes('INSERT INTO theme_brief_notebooks') && query.includes('note_markdown')) {
      const [
        notebookKey,
        theme,
        periodType,
        noteMarkdown,
        pinned,
        tagsJson,
        shareToken,
        sharedAt,
        metadataJson,
      ] = params;
      const previous = rows.get(`${theme}::${periodType}`) || {};
      const now = new Date().toISOString();
      rows.set(`${theme}::${periodType}`, {
        notebook_key: notebookKey,
        theme,
        period_type: periodType,
        note_markdown: noteMarkdown,
        pinned,
        tags: JSON.parse(tagsJson),
        share_token: shareToken,
        shared_at: sharedAt,
        export_count: Number(previous.export_count || 0),
        last_exported_at: previous.last_exported_at || null,
        metadata: JSON.parse(metadataJson),
        created_at: previous.created_at || now,
        updated_at: now,
      });
      return { rows: [], rowCount: 1, command: 'INSERT' };
    }

    if (query.includes('INSERT INTO theme_brief_notebooks') && query.includes('export_count')) {
      const [notebookKey, theme, periodType] = params;
      const previous = rows.get(`${theme}::${periodType}`) || {
        notebook_key: notebookKey,
        theme,
        period_type: periodType,
        note_markdown: '',
        pinned: false,
        tags: [],
        share_token: null,
        shared_at: null,
        export_count: 0,
        last_exported_at: null,
        metadata: {},
        created_at: new Date().toISOString(),
      };
      const now = new Date().toISOString();
      rows.set(`${theme}::${periodType}`, {
        ...previous,
        notebook_key: notebookKey,
        export_count: Number(previous.export_count || 0) + 1,
        last_exported_at: now,
        updated_at: now,
      });
      return { rows: [], rowCount: 1, command: 'INSERT' };
    }

    return { rows: [], rowCount: 0, command: 'SELECT' };
  };
}

test('theme notebook entries save, share, and reload', async () => {
  const safeQuery = createNotebookSafeQuery();

  const saved = await upsertThemeNotebookEntry(safeQuery, 'quantum-computing', 'quarter', {
    noteMarkdown: 'Track whether hardware breakthroughs move beyond lab milestones.',
    pinned: true,
    tags: ['quantum', 'watch'],
    shareRequested: true,
  });

  assert.equal(saved.notebookKey, buildThemeNotebookKey('quantum-computing', 'quarter'));
  assert.equal(saved.pinned, true);
  assert.equal(saved.noteMarkdown, 'Track whether hardware breakthroughs move beyond lab milestones.');
  assert.deepEqual(saved.tags, ['quantum', 'watch']);
  assert.equal(typeof saved.shareToken, 'string');
  assert.ok(saved.shareToken.length > 10);

  const reloaded = await loadThemeNotebookEntry(safeQuery, 'quantum-computing', 'quarter');
  assert.equal(reloaded.shareToken, saved.shareToken);
  assert.equal(reloaded.pinned, true);

  const shared = await loadSharedThemeNotebookEntry(safeQuery, saved.shareToken);
  assert.equal(shared.theme, 'quantum-computing');
  assert.equal(shared.periodType, 'quarter');
});

test('theme notebook export records export counts and yields markdown payload', async () => {
  const safeQuery = createNotebookSafeQuery();

  await upsertThemeNotebookEntry(safeQuery, 'robotics-automation', 'quarter', {
    noteMarkdown: 'Watch supplier bottlenecks and defense demand overlap.',
    tags: ['robotics', 'supply-chain'],
  });

  const exportPayload = await buildThemeBriefExportPayload('robotics-automation', safeQuery, new URLSearchParams([
    ['period', 'quarter'],
    ['format', 'markdown'],
  ]));

  assert.equal(exportPayload.format, 'markdown');
  assert.match(exportPayload.filename, /robotics-automation-quarter-theme-brief\.md$/);
  assert.match(exportPayload.content, /# Robotics Automation Theme Brief/i);
  assert.match(exportPayload.content, /Watch supplier bottlenecks and defense demand overlap\./i);

  const notebook = await recordThemeNotebookExport(safeQuery, 'robotics-automation', 'quarter');
  assert.ok(Number(notebook.exportCount) >= 2);
  assert.ok(notebook.lastExportedAt);
});
