function stableTags(tags = {}) {
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function metricKey(name, tags) {
  return `${name}::${JSON.stringify(stableTags(tags))}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function createLogger(component, options = {}) {
  const stream = options.stream || process.stderr;
  const metrics = new Map();

  function write(level, msg, ctx = {}) {
    const entry = {
      ts: nowIso(),
      component,
      level,
      msg,
      ctx,
    };
    stream.write(`${JSON.stringify(entry)}\n`);
  }

  function metric(name, value = 1, tags = {}) {
    const normalizedValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    const normalizedTags = stableTags(tags);
    const key = metricKey(name, normalizedTags);
    const existing = metrics.get(key) || {
      name,
      tags: normalizedTags,
      count: 0,
      sum: 0,
      min: null,
      max: null,
      lastValue: null,
      lastTs: null,
    };
    existing.count += 1;
    existing.sum += normalizedValue;
    existing.min = existing.min == null ? normalizedValue : Math.min(existing.min, normalizedValue);
    existing.max = existing.max == null ? normalizedValue : Math.max(existing.max, normalizedValue);
    existing.lastValue = normalizedValue;
    existing.lastTs = nowIso();
    metrics.set(key, existing);
    write('metric', name, { value: normalizedValue, tags: normalizedTags });
  }

  function getMetrics() {
    return {
      component,
      generatedAt: nowIso(),
      metrics: Array.from(metrics.values())
        .map((entry) => ({
          ...entry,
          avg: entry.count > 0 ? Number((entry.sum / entry.count).toFixed(4)) : 0,
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || JSON.stringify(left.tags).localeCompare(JSON.stringify(right.tags))),
    };
  }

  return {
    info(msg, ctx = {}) {
      write('info', msg, ctx);
    },
    warn(msg, ctx = {}) {
      write('warn', msg, ctx);
    },
    error(msg, ctx = {}) {
      write('error', msg, ctx);
    },
    metric,
    getMetrics,
    flush() {
      return getMetrics();
    },
  };
}
