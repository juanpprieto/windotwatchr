import { test, expect } from '@playwright/test';
import { expectStatus, expectWindowGlobal, getDetectedAt } from '../shared/sdk-detection';

test.describe('Dashboard page — Vite + React', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/dashboard');
    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');
  });

  test('all 4 SDK cards eventually reach ready status', async ({ page }) => {
    await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);
  });

  test('detection timestamps show correct ordering', async ({ page }) => {
    await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);

    const analyticsAt = await getDetectedAt(page, 'sdk-analytics');
    const pixelAt = await getDetectedAt(page, 'sdk-pixel');
    const paymentsAt = await getDetectedAt(page, 'sdk-payments');
    const mapsAt = await getDetectedAt(page, 'sdk-maps');

    expect(analyticsAt).not.toBeNull();
    expect(pixelAt).not.toBeNull();
    expect(paymentsAt).not.toBeNull();
    expect(mapsAt).not.toBeNull();

    // Verify relative ordering
    expect(analyticsAt!).toBeLessThanOrEqual(pixelAt!);
    expect(pixelAt!).toBeLessThanOrEqual(paymentsAt! + 100);
    expect(paymentsAt!).toBeLessThanOrEqual(mapsAt! + 100);
  });

  test('analytics detected via immediate-value path (sync script)', async ({ page }) => {
    await expectStatus(page, 'sdk-analytics', 'ready', 3_000);
    await expectWindowGlobal(page, 'acmeDataLayer');

    const isArray = await page.evaluate(() => Array.isArray((window as any).acmeDataLayer));
    expect(isArray).toBe(true);
  });

  test('pixel detected with custom ready predicate (acmePx.loaded === true)', async ({ page }) => {
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);

    const loaded = await page.evaluate(() => (window as any).acmePx?.loaded);
    expect(loaded).toBe(true);
  });

  test('maps detected via incremental namespace building (3 stages)', async ({ page }) => {
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);
    await expectWindowGlobal(page, 'acme.maps.Map');

    const isFunction = await page.evaluate(
      () => typeof (window as any).acme?.maps?.Map === 'function',
    );
    expect(isFunction).toBe(true);
  });

  test('ww:ready events fire for all 4 SDKs', async ({ page }) => {
    // Install collector via addInitScript so it runs BEFORE any page JS,
    // catching synchronous ww:ready events like analytics
    await page.addInitScript(() => {
      const key = '__e2e_ww_ready';
      (window as unknown as Record<string, unknown>)[key] = [];
      window.addEventListener('ww:ready', (e: Event) => {
        const detail = (e as CustomEvent).detail;
        ((window as unknown as Record<string, unknown>)[key] as unknown[]).push({
          ...detail,
          _capturedAt: Date.now(),
        });
      });
    });

    // Reload so the addInitScript takes effect before page JS runs
    await page.reload();
    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');
    await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);

    const events = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__e2e_ww_ready as Record<string, unknown>[],
    );
    const paths = events.map((e) => e.path);

    expect(paths).toContain('acmeDataLayer');
    expect(paths).toContain('acmePx.loaded');
    expect(paths).toContain('acmePayments.ui.components');
    expect(paths).toContain('acme.maps.Map');
  });
});
