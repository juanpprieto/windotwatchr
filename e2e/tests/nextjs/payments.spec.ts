import { test, expect } from '@playwright/test';
import { expectStatus, expectWindowGlobal, getDetectedAt, collectWatcherEvents, getCapturedEvents } from '../shared/sdk-detection';

test.describe('Payments page — Next.js', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/payments');
  });

  test('detects acmePayments.ui.components (3-level deep path)', async ({ page }) => {
    await expectStatus(page, 'new-way', 'ready', 10_000);
    await expectWindowGlobal(page, 'acmePayments.ui.components');
  });

  test('old-way polling also detects the SDK', async ({ page }) => {
    await expectStatus(page, 'old-way', 'ready', 10_000);
    await expectWindowGlobal(page, 'acmePayments.ui.components.create');
  });

  test('windotwatchr detects before or same time as polling (instrumented timestamps)', async ({ page }) => {
    // Wait for both columns to be ready
    await expectStatus(page, 'new-way', 'ready', 10_000);
    await expectStatus(page, 'old-way', 'ready', 10_000);

    const newWayAt = await getDetectedAt(page, 'new-way');
    const oldWayAt = await getDetectedAt(page, 'old-way');

    expect(newWayAt).not.toBeNull();
    expect(oldWayAt).not.toBeNull();

    // windotwatchr (event-driven) should detect at same time or before polling (100ms interval)
    // Allow 50ms tolerance — the point is event-driven doesn't wait for a poll tick
    expect(newWayAt!).toBeLessThanOrEqual(oldWayAt! + 50);
  });

  test('SDK renders promo component into DOM', async ({ page }) => {
    // Wait for detection
    await expectStatus(page, 'new-way', 'ready', 10_000);

    // Verify the fake SDK actually rendered into the container
    const rendered = await page.locator('[data-acme-rendered="true"]').first();
    await expect(rendered).toBeVisible({ timeout: 3_000 });
  });

  test('ww:ready event fires for deep path', async ({ page }) => {
    // Set up listener before scripts fully execute
    await collectWatcherEvents(page, 'ww:ready');

    // Wait for detection
    await expectStatus(page, 'new-way', 'ready', 10_000);

    const events = await getCapturedEvents(page, 'ww:ready');
    const paymentsEvent = events.find((e) => e.path === 'acmePayments.ui.components');
    expect(paymentsEvent).toBeDefined();
    expect(paymentsEvent!.value).toBeDefined();
  });

  test('window.acmePayments has expected structure after load', async ({ page }) => {
    await expectStatus(page, 'new-way', 'ready', 10_000);

    const structure = await page.evaluate(() => {
      const ap = (window as any).acmePayments;
      return {
        hasCheckout: typeof ap?.checkout === 'object',
        hasUI: typeof ap?.ui === 'object',
        hasComponents: typeof ap?.ui?.components === 'object',
        hasCreate: typeof ap?.ui?.components?.create === 'function',
        version: ap?.version,
      };
    });

    expect(structure.hasCheckout).toBe(true);
    expect(structure.hasUI).toBe(true);
    expect(structure.hasComponents).toBe(true);
    expect(structure.hasCreate).toBe(true);
    expect(structure.version).toBe('1.0.0');
  });
});
