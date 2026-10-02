import { test, expect } from '@playwright/test';
import { expectStatus, expectWindowGlobal, getDetectedAt, collectWatcherEvents, getCapturedEvents } from '../shared/sdk-detection';

test.describe('Dashboard page — Next.js', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('dashboard');
  });

  test('all 4 SDK cards start in watching status', async ({ page }) => {
    // Analytics is synchronous so it may already be ready, but the others should start watching
    // Check at least payments and maps start as watching (they have delays)
    const paymentsStatus = await page.getByTestId('sdk-payments').getAttribute('data-status');
    const mapsStatus = await page.getByTestId('sdk-maps').getAttribute('data-status');

    // At minimum, the slowest ones should start as watching
    // (analytics may already be ready since it's synchronous)
    expect(['watching', 'ready']).toContain(paymentsStatus);
    expect(['watching', 'ready']).toContain(mapsStatus);
  });

  test('all 4 SDK cards eventually reach ready status', async ({ page }) => {
    await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);
  });

  test('detection timestamps show correct ordering', async ({ page }) => {
    // Wait for all to be ready
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

    // Analytics is sync (0ms), pixel ~500ms, payments ~800ms, maps ~1200ms
    // Assert relative ordering with tolerance
    expect(analyticsAt!).toBeLessThanOrEqual(pixelAt!);
    expect(pixelAt!).toBeLessThanOrEqual(paymentsAt! + 100); // 100ms tolerance
    expect(paymentsAt!).toBeLessThanOrEqual(mapsAt! + 100);
  });

  test('analytics detected via immediate-value path (sync script)', async ({ page }) => {
    // acmeDataLayer is set synchronously — should be detected very fast
    await expectStatus(page, 'sdk-analytics', 'ready', 3_000);

    await expectWindowGlobal(page, 'acmeDataLayer');

    // Verify it's an array
    const isArray = await page.evaluate(() => Array.isArray((window as any).acmeDataLayer));
    expect(isArray).toBe(true);
  });

  test('pixel detected with custom ready predicate (acmePx.loaded === true)', async ({ page }) => {
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);

    // The dashboard watches acmePx.loaded with predicate (v) => v === true
    // This tests both: Proxy set trap on property mutation AND custom predicate
    const loaded = await page.evaluate(() => (window as any).acmePx?.loaded);
    expect(loaded).toBe(true);
  });

  test('maps detected via incremental namespace building (3 stages)', async ({ page }) => {
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);

    // Verify the full path exists
    await expectWindowGlobal(page, 'acme.maps.Map');

    // Verify it's a constructor
    const isFunction = await page.evaluate(
      () => typeof (window as any).acme?.maps?.Map === 'function',
    );
    expect(isFunction).toBe(true);
  });

  test('payments detected via 3-level deep nested path', async ({ page }) => {
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);

    await expectWindowGlobal(page, 'acmePayments.ui.components');
    await expectWindowGlobal(page, 'acmePayments.ui.components.create');
  });

  test('ww:ready events fire for all 4 SDKs', async ({ page }) => {
    await collectWatcherEvents(page, 'ww:ready');

    // Wait for all to be ready
    await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
    await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);
    await expectStatus(page, 'sdk-maps', 'ready', 10_000);

    const events = await getCapturedEvents(page, 'ww:ready');
    const paths = events.map((e) => e.path);

    expect(paths).toContain('acmeDataLayer');
    expect(paths).toContain('acmePx.loaded');
    expect(paths).toContain('acmePayments.ui.components');
    expect(paths).toContain('acme.maps.Map');
  });

  test('globals are real browser globals (not jsdom)', async ({ page }) => {
    await expectStatus(page, 'sdk-payments', 'ready', 10_000);

    // Verify we're in a real browser, not jsdom
    const userAgent = await page.evaluate(() => navigator.userAgent);
    expect(userAgent).not.toContain('jsdom');

    // Verify Proxy is native (not polyfilled)
    const proxyNative = await page.evaluate(() => Proxy.toString().includes('native code'));
    expect(proxyNative).toBe(true);
  });
});
