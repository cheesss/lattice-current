import type { AppContext } from '@/app/app-context';
import { fetchBisData, fetchFredData, fetchOilAnalytics, fetchRecentAwards } from '@/services';
import { pushMarketSignalsBatch } from '@/services/analysis-runtime-bridge';
import { dataFreshness } from '@/services/data-freshness';
import { isFeatureAvailable } from '@/services/runtime-config';
import { EconomicPanel } from '@/components';
import { getCircuitBreakerCooldownInfo } from '@/utils';
import { createLogger } from '@/utils/logger';

const logger = createLogger('market-economic-data');

export interface MarketEconomicManagerHooks {
  ensureOpenbbStartupHealth: () => Promise<void>;
  shouldRefreshOpenbbIntel: () => boolean;
  loadMarketsOpenbbFirst: () => Promise<boolean>;
  loadMarketsFallbackOnly: () => Promise<void>;
  refreshOpenbbIntel: () => void;
  schedulePersistence: () => void;
}

export class MarketEconomicDataManager {
  constructor(
    private readonly ctx: AppContext,
    private readonly hooks: MarketEconomicManagerHooks,
  ) {}

  async loadMarkets(): Promise<void> {
    await this.hooks.ensureOpenbbStartupHealth();

    if (this.hooks.shouldRefreshOpenbbIntel()) {
      const openbbLoaded = await this.hooks.loadMarketsOpenbbFirst();
      if (!openbbLoaded) {
        await this.hooks.loadMarketsFallbackOnly();
      }
    } else {
      await this.hooks.loadMarketsFallbackOnly();
    }

    this.hooks.refreshOpenbbIntel();
    this.hooks.schedulePersistence();
  }

  async loadFredData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel | undefined;
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
    if (cbInfo.onCooldown) {
      economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      economicPanel?.setLoading(true);
      const data = await fetchFredData();

      const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
      if (postInfo.onCooldown) {
        economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        if (!isFeatureAvailable('economicFred')) {
          economicPanel?.setErrorState(true, 'FRED_API_KEY not configured - add in Settings');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.showRetrying();
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        const retryData = await fetchFredData();
        if (retryData.length === 0) {
          economicPanel?.setErrorState(true, 'FRED data temporarily unavailable - will retry');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.setErrorState(false);
        economicPanel?.update(retryData);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
        dataFreshness.recordUpdate('economic', retryData.length);
        return;
      }

      economicPanel?.setErrorState(false);
      economicPanel?.update(data);
      void pushMarketSignalsBatch(
        data
          .filter((item) => item.id && typeof item.value === 'number')
          .map((item) => ({
            symbol: item.id,
            price: item.value as number,
          })),
      ).catch(() => {});
      this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch (error) {
      if (isFeatureAvailable('economicFred')) {
        economicPanel?.showRetrying();
        try {
          await new Promise((resolve) => setTimeout(resolve, 20_000));
          const retryData = await fetchFredData();
          if (retryData.length > 0) {
            economicPanel?.setErrorState(false);
            economicPanel?.update(retryData);
            this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
            dataFreshness.recordUpdate('economic', retryData.length);
            return;
          }
        } catch {
          // fall through to shared error state
        }
      }
      logger.warn('FRED data unavailable after retry', { error: String(error) });
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      economicPanel?.setErrorState(true, 'FRED data temporarily unavailable - will retry');
      economicPanel?.setLoading(false);
    }
  }

  async loadOilAnalytics(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel | undefined;
    try {
      const data = await fetchOilAnalytics();
      economicPanel?.updateOil(data);
      const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
      this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        const metricCount = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(Boolean).length;
        dataFreshness.recordUpdate('oil', metricCount || 1);
      } else {
        dataFreshness.recordError('oil', 'Oil analytics returned no values');
      }
    } catch (error) {
      logger.error('Oil analytics failed', { error: String(error) });
      this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
      dataFreshness.recordError('oil', String(error));
    }
  }

  async loadGovernmentSpending(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel | undefined;
    try {
      const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
      economicPanel?.updateSpending(data);
      this.ctx.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
      if (data.awards.length > 0) {
        dataFreshness.recordUpdate('spending', data.awards.length);
      } else {
        dataFreshness.recordError('spending', 'No awards returned');
      }
    } catch (error) {
      logger.error('Government spending fetch failed', { error: String(error) });
      this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
      dataFreshness.recordError('spending', String(error));
    }
  }

  async loadBisData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel | undefined;
    try {
      const data = await fetchBisData();
      economicPanel?.updateBis(data);
      const hasData = data.policyRates.length > 0;
      this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        dataFreshness.recordUpdate('bis', data.policyRates.length);
      }
    } catch (error) {
      logger.error('BIS data failed', { error: String(error) });
      this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
      dataFreshness.recordError('bis', String(error));
    }
  }
}
