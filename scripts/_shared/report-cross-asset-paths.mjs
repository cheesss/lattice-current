/*
 * Cross-asset linkage paths.
 *
 * Phase 5: trace 2-hop paths from a theme through the knowledge graph to
 * publicly traded entities. The narrator can then say "data-center buildout
 * implies pressure on copper / aluminum suppliers, with peer symbols X / Y
 * in stock_sensitivity_matrix" — which is the cross-asset chain Bridgewater
 * is known for.
 *
 * Data flow:
 *   theme → knowledge_edges 1-hop → connected entity (component / material
 *           / supplier / company)
 *         → knowledge_edges 2-hop (if entity is itself connected to other
 *           entities or themes) → secondary chain
 *         → if any entity matches stock_sensitivity_matrix.symbol or appears
 *           in marketReactions, the path terminates at a tradable asset.
 *
 * Limitations: knowledge_edges in this DB are deterministic phrase-extraction
 * candidates with confidence ~0.55-0.7. They are useful for narrative
 * framing but should be treated as exploratory, not as a verified supply
 * chain.
 */

function asArray(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function many(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

async function one(client, sql, params = []) {
  const r = await client.query(sql, params);
  return r.rows[0] || null;
}

/*
 * Find the theme node in knowledge_nodes. Returns null if the theme
 * doesn't have a graph node yet.
 */
async function findThemeNode(client, themeKey) {
  return one(client, `
    SELECT id, node_type, canonical_name, normalized_key, status
    FROM knowledge_nodes
    WHERE normalized_key = $1
       OR lower(canonical_name) = lower($2)
    LIMIT 1
  `, [themeKey, themeKey.replace(/-/g, ' ')]);
}

/*
 * 2-hop traversal: theme node → 1-hop entities → 2-hop entities. Returns
 * paths sorted by aggregated confidence.
 */
async function loadTwoHopPaths(client, themeNodeId, hopLimit = 8) {
  /* 1-hop */
  const firstHop = await many(client, `
    SELECT ke.id AS edge_id, ke.relation_type, ke.confidence, ke.evidence_count, ke.source_diversity,
           ke.source_node_id, ke.target_node_id,
           kn_other.id AS other_id, kn_other.canonical_name AS other_name, kn_other.node_type AS other_type
    FROM knowledge_edges ke
    JOIN knowledge_nodes kn_other ON kn_other.id = (CASE WHEN ke.source_node_id = $1 THEN ke.target_node_id ELSE ke.source_node_id END)
    WHERE (ke.source_node_id = $1 OR ke.target_node_id = $1)
      AND ke.status IN ('active','validated','candidate')
    ORDER BY ke.confidence DESC NULLS LAST, ke.evidence_count DESC NULLS LAST
    LIMIT $2
  `, [themeNodeId, hopLimit]).catch(() => []);
  if (!firstHop.length) return [];
  const firstHopNodeIds = firstHop.map((r) => r.other_id);
  /* 2-hop — entities connected to first-hop entities, excluding the theme itself */
  const secondHop = await many(client, `
    SELECT ke.id AS edge_id, ke.relation_type, ke.confidence, ke.evidence_count, ke.source_diversity,
           ke.source_node_id, ke.target_node_id,
           CASE WHEN ke.source_node_id = ANY($1::bigint[]) THEN ke.source_node_id ELSE ke.target_node_id END AS via_id,
           CASE WHEN ke.source_node_id = ANY($1::bigint[]) THEN ke.target_node_id ELSE ke.source_node_id END AS endpoint_id,
           kn_endpoint.canonical_name AS endpoint_name, kn_endpoint.node_type AS endpoint_type
    FROM knowledge_edges ke
    JOIN knowledge_nodes kn_endpoint ON kn_endpoint.id = (CASE WHEN ke.source_node_id = ANY($1::bigint[]) THEN ke.target_node_id ELSE ke.source_node_id END)
    WHERE (ke.source_node_id = ANY($1::bigint[]) OR ke.target_node_id = ANY($1::bigint[]))
      AND ke.id NOT IN (SELECT id FROM knowledge_edges WHERE source_node_id = $2 OR target_node_id = $2)
      AND kn_endpoint.id != $2
      AND ke.status IN ('active','validated','candidate')
    ORDER BY ke.confidence DESC NULLS LAST, ke.evidence_count DESC NULLS LAST
    LIMIT 24
  `, [firstHopNodeIds, themeNodeId]).catch(() => []);

  /* Build paths: theme → 1-hop entity → 2-hop endpoint */
  const firstByOther = new Map();
  for (const r of firstHop) firstByOther.set(String(r.other_id), r);
  const paths = [];
  for (const second of secondHop) {
    const via = firstByOther.get(String(second.via_id));
    if (!via) continue;
    paths.push({
      hop1: { entity: via.other_name, type: via.other_type, relation: via.relation_type, confidence: num(via.confidence) },
      hop2: { entity: second.endpoint_name, type: second.endpoint_type, relation: second.relation_type, confidence: num(second.confidence) },
      score: (num(via.confidence) || 0) * (num(second.confidence) || 0),
      pathLength: 2,
    });
  }
  /* Also keep top 1-hop entities as length-1 paths for completeness */
  for (const f of firstHop.slice(0, 4)) {
    paths.push({
      hop1: { entity: f.other_name, type: f.other_type, relation: f.relation_type, confidence: num(f.confidence) },
      hop2: null,
      score: num(f.confidence) || 0,
      pathLength: 1,
    });
  }
  return paths.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
}

/*
 * For each path, see whether the endpoint entity matches a tradable symbol
 * in marketReactions or stock_sensitivity_matrix. If so, the path terminates
 * at a tradable asset and the narrator can cite that ticker.
 */
async function tagTradableEndpoints(client, paths, themeKey) {
  if (!paths.length) return paths;
  /* Pull all peer symbols for the theme (already deduped by symbol in
   * loadPeerSymbols, but we reload here so the path tagger doesn't depend
   * on themeContext having been built). */
  const peers = await many(client, `
    SELECT symbol, theme, sensitivity_zscore, sample_size
    FROM stock_sensitivity_matrix
    WHERE theme = $1
    ORDER BY ABS(sensitivity_zscore) DESC NULLS LAST
    LIMIT 20
  `, [themeKey]).catch(() => []);
  const peerSymbols = new Set(peers.map((p) => String(p.symbol).toUpperCase()));
  /* Naive tagging: if the entity name contains a known ticker, tag it. */
  return paths.map((path) => {
    const endpoint = path.hop2?.entity || path.hop1?.entity || '';
    const upperWords = String(endpoint).toUpperCase().match(/\b[A-Z][A-Z0-9.]{1,5}\b/g) || [];
    const matchedTicker = upperWords.find((w) => peerSymbols.has(w));
    return { ...path, tradableEndpoint: matchedTicker || null };
  });
}

/*
 * Top-level loader.
 */
export async function loadCrossAssetPaths(client, themeKey) {
  if (!themeKey) return { available: false, paths: [], themeNode: null };
  const themeNode = await findThemeNode(client, themeKey);
  if (!themeNode) return { available: false, paths: [], themeNode: null, reason: 'theme node not in knowledge_nodes' };
  const rawPaths = await loadTwoHopPaths(client, themeNode.id);
  const paths = await tagTradableEndpoints(client, rawPaths, themeKey);
  return { available: true, paths, themeNode };
}

/*
 * Bundle additions: encode the paths as metric + extension so the narrator
 * can cite them.
 */
export function crossAssetPathsToBundleAdditions(crossAsset) {
  if (!crossAsset?.available || !crossAsset.paths.length) {
    return { metrics: [], extension: { crossAssetPaths: { available: false, reason: crossAsset?.reason || null, paths: [] } } };
  }
  const tradableCount = crossAsset.paths.filter((p) => p.tradableEndpoint).length;
  return {
    metrics: [{
      metricId: 'MET-CROSS-ASSET-PATH-COUNT',
      kind: 'cross_asset_graph',
      name: 'cross_asset_path_count',
      value: crossAsset.paths.length,
      unit: 'paths',
      metadata: {
        tradableCount,
        topPath: crossAsset.paths[0],
      },
    }],
    extension: {
      crossAssetPaths: {
        available: true,
        themeNode: crossAsset.themeNode,
        paths: crossAsset.paths.slice(0, 6),
      },
    },
  };
}
