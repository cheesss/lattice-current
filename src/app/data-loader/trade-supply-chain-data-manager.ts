import type { AppContext } from '@/app/app-context';
import type { AisDensityZone, AisDisruptionEvent } from '@/types';
import {
  fetchTradeRestrictions,
  fetchTariffTrends,
  fetchTradeFlows,
  fetchTradeBarriers,
  fetchShippingRates,
  fetchChokepointStatus,
  fetchCriticalMinerals,
  fetchPortWatchSnapshot,
  toPortWatchAisOverlays,
} from '@/services';
import { dataFreshness } from '@/services/data-freshness';
import { TradePolicyPanel, SupplyChainPanel } from '@/components';
import { createLogger } from '@/utils/logger';

const logger = createLogger('trade-supply-chain-data');

export interface TradeSupplyChainManagerHooks {
  setPortWatchOverlays: (disruptions: AisDisruptionEvent[], density: AisDensityZone[]) => void;
  reloadAisSignals: () => Promise<void> | void;
}

export class TradeSupplyChainDataManager {
  constructor(
    private readonly ctx: AppContext,
    private readonly hooks: TradeSupplyChainManagerHooks,
  ) {}

  async loadTradePolicy(): Promise<void> {
    const tradePanel = this.ctx.panels['trade-policy'] as TradePolicyPanel | undefined;
    if (!tradePanel) return;

    try {
      const [restrictions, tariffs, flows, barriers] = await Promise.all([
        fetchTradeRestrictions([], 50),
        fetchTariffTrends('840', '156', '', 10),
        fetchTradeFlows('840', '156', 10),
        fetchTradeBarriers([], '', 50),
      ]);

      tradePanel.updateRestrictions(restrictions);
      tradePanel.updateTariffs(tariffs);
      tradePanel.updateFlows(flows);
      tradePanel.updateBarriers(barriers);

      const totalItems =
        restrictions.restrictions.length +
        tariffs.datapoints.length +
        flows.flows.length +
        barriers.barriers.length;
      const anyUnavailable =
        restrictions.upstreamUnavailable ||
        tariffs.upstreamUnavailable ||
        flows.upstreamUnavailable ||
        barriers.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('WTO', {
        status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error',
      });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('wto_trade', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
      }
    } catch (error) {
      logger.error('Trade policy refresh failed', { error: String(error) });
      this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
      dataFreshness.recordError('wto_trade', String(error));
    }
  }

  async loadSupplyChain(): Promise<void> {
    const supplyChainPanel = this.ctx.panels['supply-chain'] as SupplyChainPanel | undefined;
    if (!supplyChainPanel) return;

    try {
      const [shipping, chokepoints, minerals, portWatch] = await Promise.allSettled([
        fetchShippingRates(),
        fetchChokepointStatus(),
        fetchCriticalMinerals(),
        fetchPortWatchSnapshot(),
      ]);

      const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
      const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
      const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;
      const portWatchData = portWatch.status === 'fulfilled' ? portWatch.value : null;

      if (shippingData) supplyChainPanel.updateShippingRates(shippingData);
      if (chokepointData) supplyChainPanel.updateChokepointStatus(chokepointData);
      if (mineralsData) supplyChainPanel.updateCriticalMinerals(mineralsData);

      let portWatchCount = 0;
      if (portWatchData) {
        const overlays = toPortWatchAisOverlays(portWatchData);
        this.hooks.setPortWatchOverlays(overlays.disruptions, overlays.density);
        portWatchCount = overlays.disruptions.length + overlays.density.length;
        this.ctx.statusPanel?.updateApi('PortWatch', {
          status: portWatchData.upstreamUnavailable ? 'warning' : portWatchCount > 0 ? 'ok' : 'warning',
        });
        if (portWatchCount > 0) {
          dataFreshness.recordUpdate('portwatch', portWatchCount);
        } else if (portWatchData.upstreamUnavailable) {
          dataFreshness.recordError('portwatch', 'PortWatch upstream unavailable');
        }
        if (this.ctx.mapLayers.ais) {
          void this.hooks.reloadAisSignals();
        }
      } else {
        this.ctx.statusPanel?.updateApi('PortWatch', { status: 'error' });
        dataFreshness.recordError('portwatch', 'PortWatch fetch failed');
      }

      const totalItems =
        (shippingData?.indices.length || 0) +
        (chokepointData?.chokepoints.length || 0) +
        (mineralsData?.minerals.length || 0) +
        portWatchCount;
      const anyUnavailable = Boolean(
        shippingData?.upstreamUnavailable ||
          chokepointData?.upstreamUnavailable ||
          mineralsData?.upstreamUnavailable ||
          portWatchData?.upstreamUnavailable,
      );

      this.ctx.statusPanel?.updateApi('SupplyChain', {
        status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error',
      });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('supply_chain', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
      }
    } catch (error) {
      logger.error('Supply chain refresh failed', { error: String(error) });
      this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
      this.ctx.statusPanel?.updateApi('PortWatch', { status: 'error' });
      dataFreshness.recordError('portwatch', String(error));
      dataFreshness.recordError('supply_chain', String(error));
    }
  }
}
