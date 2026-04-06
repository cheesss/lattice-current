#!/usr/bin/env node

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function jsonOut(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

async function main() {
  const raw = await readStdin();
  if (!raw) {
    jsonOut({ ok: false, error: 'expected JSON payload' }, 1);
    return;
  }

  const message = JSON.parse(raw);
  const action = String(message?.action || '').trim();
  const payload = message?.payload || {};

  if (!action) {
    jsonOut({ ok: false, error: 'action required' }, 1);
    return;
  }

  if (action === 'ingest-articles') {
    const { ingestArticleBatch } = await import('../src/services/article-ingestor.ts');
    const result = await ingestArticleBatch(Array.isArray(payload.articles) ? payload.articles : []);
    jsonOut({ ok: true, result });
    return;
  }

  if (action === 'push-market-signals') {
    const { pushSignalFromMarketData } = await import('../src/services/signal-history-updater.ts');
    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    for (const signal of signals) {
      await pushSignalFromMarketData(
        String(signal?.symbol || ''),
        Number(signal?.price),
        typeof signal?.timestamp === 'string' ? signal.timestamp : undefined,
      );
    }
    jsonOut({ ok: true, processed: signals.length });
    return;
  }

  if (action === 'push-gdelt-stress') {
    const { pushGdeltStress } = await import('../src/services/signal-history-updater.ts');
    const signals = Array.isArray(payload.signals) ? payload.signals : [];
    for (const signal of signals) {
      await pushGdeltStress(
        Number(signal?.goldstein),
        Number(signal?.tone),
        Number(signal?.eventCount),
        typeof signal?.date === 'string' ? signal.date : undefined,
      );
    }
    jsonOut({ ok: true, processed: signals.length });
    return;
  }

  jsonOut({ ok: false, error: `unsupported action: ${action}` }, 1);
}

main().catch((error) => {
  jsonOut({ ok: false, error: String(error?.message || error) }, 1);
});
