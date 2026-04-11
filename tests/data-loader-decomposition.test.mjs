import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from './_workspace-paths.mjs';

test('data-loader delegates trade and supply chain refreshes to the extracted manager', () => {
  const dataLoaderSource = readFileSync(repoPath('src/app/data-loader.ts'), 'utf8');
  const managerSource = readFileSync(repoPath('src/app/data-loader/trade-supply-chain-data-manager.ts'), 'utf8');

  assert.equal(
    dataLoaderSource.includes("import { TradeSupplyChainDataManager } from '@/app/data-loader/trade-supply-chain-data-manager';"),
    true,
  );
  assert.equal(dataLoaderSource.includes('private readonly tradeSupplyChainManager: TradeSupplyChainDataManager;'), true);
  assert.equal(dataLoaderSource.includes('await this.tradeSupplyChainManager.loadTradePolicy();'), true);
  assert.equal(dataLoaderSource.includes('await this.tradeSupplyChainManager.loadSupplyChain();'), true);
  assert.equal(managerSource.includes('export class TradeSupplyChainDataManager {'), true);
  assert.equal(managerSource.includes("logger.error('Trade policy refresh failed'"), true);
  assert.equal(managerSource.includes("logger.error('Supply chain refresh failed'"), true);
});

test('label-discovery-topics uses the shared query builder instead of ad hoc WHERE concatenation', () => {
  const source = readFileSync(repoPath('scripts/label-discovery-topics.mjs'), 'utf8');

  assert.equal(source.includes("import { createWhereBuilder } from './_shared/query-builder.mjs';"), true);
  assert.equal(source.includes("const where = createWhereBuilder([`status = 'pending'`]);"), true);
  assert.equal(source.includes("${whereClause}"), true);
  assert.equal(source.includes("conditions.join(' AND ')"), false);
});

test('compute-trend-aggregates uses the shared query builder for article corpus filtering', () => {
  const source = readFileSync(repoPath('scripts/compute-trend-aggregates.mjs'), 'utf8');

  assert.equal(source.includes("import { createWhereBuilder } from './_shared/query-builder.mjs';"), true);
  assert.equal(source.includes('const where = createWhereBuilder(['), true);
  assert.equal(source.includes('where.addValue('), true);
  assert.equal(source.includes("${whereClause}"), true);
  assert.equal(source.includes("conditions.join(' AND ')"), false);
});
