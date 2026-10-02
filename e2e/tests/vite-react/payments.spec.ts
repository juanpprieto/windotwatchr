import { test, expect } from '@playwright/test';
import { expectStatus, expectWindowGlobal, getDetectedAt, collectWatcherEvents, getCapturedEvents } from '../shared/sdk-detection';

test.describe('Payments page — Vite + React', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/payments');
    // Wait for route to render
    await expect(page.locator('h1')).toContainText('Payments');
  });

  test('detects acmePayments.ui.components (3-level deep path)', async ({ page }) => {
    await expectStatus(page, 'new-way', 'ready', 10_000);
    await expectWindowGlobal(page, 'acmePayments.ui.components');
  });

  test('old-way polling also detects the SDK', async ({ page }) => {
    await expectStatus(page, 'old-way', 'ready', 10_000);
  });

  test('windotwatchr detects before or same time as polling (instrumented timestamps)', async ({ page }) => {
    await expectStatus(page, 'new-way', 'ready', 10_000);
    await expectStatus(page, 'old-way', 'ready', 10_000);

    const newWayAt = await getDetectedAt(page, 'new-way');
    const oldWayAt = await getDetectedAt(page, 'old-way');

    expect(newWayAt).not.toBeNull();
    expect(oldWayAt).not.toBeNull();

    // Event-driven should detect at same time or before polling
    expect(newWayAt!).toBeLessThanOrEqual(oldWayAt! + 50);
  });

  test('SDK renders promo component into DOM', async ({ page }) => {
    await expectStatus(page, 'new-way', 'ready', 10_000);

    const rendered = await page.locator('[data-acme-rendered="true"]').first();
    await expect(rendered).toBeVisible({ timeout: 3_000 });
  });

  test('ww:ready event fires for deep path', async ({ page }) => {
    await collectWatcherEvents(page, 'ww:ready');

    await expectStatus(page, 'new-way', 'ready', 10_000);

    const events = await getCapturedEvents(page, 'ww:ready');
    const paymentsEvent = events.find((e) => e.path === 'acmePayments.ui.components');
    expect(paymentsEvent).toBeDefined();
  });
});
