import { expect, test } from '@playwright/test';

test.describe('event intelligence panel', () => {
  test('renders non-empty signal content in the main app surface', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('[data-panel="event-intelligence"]'));
          const visible = candidates
            .map((node) => {
              const element = node as HTMLElement;
              const rect = element.getBoundingClientRect();
              return {
                text: element.innerText,
                visible: rect.width > 0 && rect.height > 0,
              };
            })
            .find((entry) => entry.visible && entry.text.trim().length > 0);

          const text = visible?.text ?? '';
          return {
            hasVisiblePanel: Boolean(visible),
            loading: text.includes('Loading...'),
            hasTemperatures: text.includes('THEME TEMPERATURES') || text.includes('Temperature data is being collected.'),
            hasHeatmap: text.includes('SENSITIVITY HEATMAP') || text.includes('Sensitivity heatmap is warming up.'),
            hasEvents: text.includes("TODAY'S EVENTS") || text.includes('No recent events yet. The feed is still collecting signal candidates.'),
            hasStrategies: text.includes('BEST STRATEGIES') || text.includes('Replay validation candidates are still being assembled.'),
            hasOffline: text.includes('Event Intelligence API offline'),
          };
        });
      }, { timeout: 60_000 })
      .toEqual({
        hasVisiblePanel: true,
        loading: false,
        hasTemperatures: true,
        hasHeatmap: true,
        hasEvents: true,
        hasStrategies: true,
        hasOffline: false,
      });
  });
});
