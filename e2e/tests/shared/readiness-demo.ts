import { expect, type Page, test } from '@playwright/test';

/** Exercise the same guided SDK lifecycle in each framework integration. */
export function testReadinessDemo(route: string) {
  test.describe('Guided API readiness', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const activeURLs = new Set<string>();
        const readyEvents: unknown[] = [];
        const createURL = URL.createObjectURL.bind(URL);
        const revokeURL = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => {
          const url = createURL(blob);
          activeURLs.add(url);
          return url;
        };
        URL.revokeObjectURL = url => { activeURLs.delete(url); revokeURL(url); };
        Object.defineProperty(window, 'readinessResourceTrace', { value: { activeURLs, readyEvents } });
        window.addEventListener('ww:ready', event => {
          if ((event as CustomEvent).detail.path === 'readinessPayments.ui.components') { readyEvents.push((event as CustomEvent).detail); }
        });
      });
      await page.goto(route);
    });

    test('script loading and API existence do not imply usability', async ({ page }) => {
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await page.getByRole('button', { name: '1. Load script', exact: true }).click();
      await expect(page.getByTestId('readiness-explanation')).toContainText('does not exist yet');
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await page.getByRole('button', { name: '2. Expose API', exact: true }).click();
      await expect(page.getByTestId('readiness-explanation')).toContainText('initialized is false');
      await expect(page.getByTestId('readiness-result')).toHaveAttribute('data-status', 'watching');
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await page.getByRole('button', { name: '3. Initialize API', exact: true }).click();
      await expect(page.getByTestId('readiness-result')).toHaveAttribute('data-status', 'ready');
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('1');
      await expect(page.getByTestId('readiness-result')).toContainText('Payment promo for $49.99');
      const timeline = await page.getByTestId('readiness-timeline').innerText();
      for (const entry of ['Script load event', 'Nested API exposed', 'SDK sets', 'Readiness predicate passed', 'Callback delivered']) {
        expect(timeline).toContain(entry);
      }
      expect(timeline.indexOf('Script load event')).toBeLessThan(timeline.indexOf('Nested API exposed'));
      expect(timeline.indexOf('SDK sets')).toBeLessThan(timeline.indexOf('Readiness predicate passed'));
      expect(timeline.indexOf('Readiness predicate passed')).toBeLessThan(timeline.indexOf('Callback delivered'));
    });

    test('cancelling suppresses delivery while the SDK can still initialize', async ({ page }) => {
      await loadAndExpose(page);
      await page.getByRole('button', { name: 'Cancel watcher', exact: true }).click();
      await page.getByRole('button', { name: '3. Initialize API', exact: true }).click();
      // Observe more than three configured polling intervals after cancellation.
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => Reflect.get(window, 'readinessResourceTrace').readyEvents.length)).toBe(0);
      await expect(page.getByTestId('readiness-result')).toHaveAttribute('data-status', 'cancelled');
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await expect(page.getByTestId('readiness-timeline')).not.toContainText('Callback delivered');
      await expect(page.getByTestId('readiness-explanation')).toContainText('stays at zero');
    });

    test('replay starts a fresh SDK and watcher, with one delivery per run', async ({ page }) => {
      await loadAndExpose(page);
      await page.getByRole('button', { name: '3. Initialize API', exact: true }).click();
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('1');
      await page.getByRole('button', { name: 'Replay', exact: true }).click();
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await expect(page.getByTestId('readiness-timeline').locator('li')).toHaveCount(1);
      expect(await page.evaluate(() => Reflect.get(window, 'readinessPayments') === undefined)).toBe(true);
      await loadAndExpose(page);
      await page.getByRole('button', { name: '3. Initialize API', exact: true }).click();
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('1');
      expect(await page.locator('script[src^="blob:"]').count()).toBe(1);
    });

    test('the experiment and comparison fit a narrow viewport', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('button', { name: '1. Load script', exact: true })).toBeVisible();
      await page.getByText('Show polling code', { exact: true }).click();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    });

    test('navigation removes the mock script and SDK without orphan deliveries', async ({ page }) => {
      await loadAndExpose(page);
      await page.getByRole('link', { name: /Home/ }).click();
      await expect(page.locator('h1')).toContainText('showcase');
      expect(await page.evaluate(() => Object.getOwnPropertyDescriptor(window, 'readinessPayments') === undefined)).toBe(true);
      await expect(page.locator('script[src^="blob:"]')).toHaveCount(0);
      await page.getByRole('link', { name: 'Payments', exact: true }).click();
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
      await loadAndExpose(page);
      await page.getByRole('button', { name: '3. Initialize API', exact: true }).click();
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('1');
    });

    test('replay during script loading releases the URL and prevents a late SDK', async ({ page }) => {
      await page.evaluate(() => {
        const controls = [...document.querySelectorAll<HTMLButtonElement>('.readiness-controls button')];
        controls.find(button => button.textContent === '1. Load script')!.click();
        controls.find(button => button.textContent === 'Replay')!.click();
      });
      await expect(page.getByTestId('readiness-timeline').locator('li')).toHaveCount(1);
      // A late script or polling task must not revive the previous run.
      await page.waitForTimeout(350);
      const resources = await page.evaluate(() => {
        const trace = Reflect.get(window, 'readinessResourceTrace');
        return { urls: trace.activeURLs.size, readyEvents: trace.readyEvents.length, sdk: Reflect.get(window, 'readinessPayments') !== undefined };
      });
      expect(resources).toEqual({ urls: 0, readyEvents: 0, sdk: false });
      await expect(page.locator('script[src^="blob:"]')).toHaveCount(0);
      await expect(page.getByTestId('readiness-callback-count')).toHaveText('0');
    });
  });
}

async function loadAndExpose(page: Page) {
  await page.getByRole('button', { name: '1. Load script', exact: true }).click();
  await page.getByRole('button', { name: '2. Expose API', exact: true }).click();
}
