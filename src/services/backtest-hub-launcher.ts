import { isDesktopRuntime } from '@/services/runtime';
import { invokeTauri } from '@/services/tauri-bridge';

export async function openBacktestHubWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      await invokeTauri<void>('open_backtest_hub_window_command');
      return;
    } catch (error) {
      console.warn('[backtest-hub] Desktop window open failed, falling back to browser tab.', error);
    }
  }

  if (typeof window !== 'undefined') {
    const popup = window.open('/backtest-hub.html', '_blank', 'noopener');
    if (!popup) {
      window.location.assign('/backtest-hub.html');
    }
  }
}
