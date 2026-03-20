import './styles/main.css';
import { initI18n } from '@/services/i18n';
import { applyStoredTheme } from '@/utils/theme-manager';
import { initBacktestHubWindow } from '@/backtest-hub-window';

async function main(): Promise<void> {
  applyStoredTheme();
  await initI18n();
  await initBacktestHubWindow();
}

void main().catch(console.error);
