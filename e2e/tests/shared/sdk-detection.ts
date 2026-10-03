import { type Page, expect } from '@playwright/test';

/**
 * Wait for the windotwatchr API to be exposed on window.__ww.
 * Dashboard pages expose { watchWindot, waitForWindot } on mount.
 */
export async function waitForWWApi(page: Page, timeout = 5_000) {
  await page.waitForFunction(() => !!(window as any).__ww, { timeout });
}

/**
 * Wait for a data-testid element to reach a specific data-status.
 */
export async function expectStatus(
  page: Page,
  testId: string,
  status: string,
  timeout = 5_000,
) {
  await expect(page.getByTestId(testId)).toHaveAttribute('data-status', status, { timeout });
}

/**
 * Assert a window global exists at a dot-notation path.
 */
export async function expectWindowGlobal(page: Page, path: string) {
  const exists = await page.evaluate((p) => {
    return p.split('.').reduce<unknown>((obj, key) => {
      if (obj !== null && obj !== undefined && typeof obj === 'object') { return (obj as Record<string, unknown>)[key]; }
      return undefined;
    }, window) !== undefined;
  }, path);
  expect(exists).toBe(true);
}

/**
 * Get the data-detected-at timestamp from an element.
 * Returns null if not yet set.
 */
export async function getDetectedAt(page: Page, testId: string): Promise<number | null> {
  const val = await page.getByTestId(testId).getAttribute('data-detected-at');
  if (!val || val === '') { return null; }
  return parseInt(val, 10);
}

/**
 * Wait for a ww:* CustomEvent and return its detail.
 */
export async function waitForWatcherEvent(
  page: Page,
  eventName: string,
  pathFilter?: string,
  timeout = 5_000,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    (args) => {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${args.eventName}`)), args.timeout);
        window.addEventListener(args.eventName, function handler(e: Event) {
          const detail = (e as CustomEvent).detail as Record<string, unknown>;
          if (args.pathFilter && detail.path !== args.pathFilter) { return; }
          clearTimeout(timer);
          window.removeEventListener(args.eventName, handler);
          resolve(detail);
        });
      });
    },
    { eventName, pathFilter, timeout },
  );
}

/**
 * Install a ww:* collector before the next navigation or reload.
 * It runs before page scripts so synchronous readiness events are captured.
 */
export async function collectWatcherEvents(
  page: Page,
  eventName: string,
): Promise<void> {
  await page.addInitScript((name) => {
    (window as unknown as Record<string, unknown[]>)[`__e2e_${name}`] = [];
    window.addEventListener(name, (e: Event) => {
      const detail = (e as CustomEvent).detail;
      (window as unknown as Record<string, unknown[]>)[`__e2e_${name}`].push({
        ...detail,
        _capturedAt: Date.now(),
      });
    });
  }, eventName);
}

/**
 * Retrieve collected ww:* events.
 */
export async function getCapturedEvents(
  page: Page,
  eventName: string,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (name) => (window as unknown as Record<string, unknown[]>)[`__e2e_${name}`] ?? [],
    eventName,
  );
}

/** Exercise client navigation, raw polling identity and descriptor cleanup in either production demo. */
export async function verifyNavigationCleanup(page: Page) {
  await expectStatus(page, 'sdk-payments', 'ready', 10_000);
  await expectStatus(page, 'sdk-pixel', 'ready', 5_000);
  await expectStatus(page, 'sdk-maps', 'ready', 10_000);
  await page.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>;
    globals.navigationRawSDK = globals.acme;
  });
  await page.getByRole('link', { name: /Home/ }).click();
  await expect(page.locator('h1')).toContainText('windotwatchr showcase');
  await expect.poll(() => page.evaluate(() => {
    const globals = window as unknown as Record<string, unknown>;
    return globals.acme === globals.navigationRawSDK
      && !Object.getOwnPropertyDescriptor(window, 'acme')?.get
      && !Object.getOwnPropertyDescriptor(window, 'acmePx')?.get
      && !Object.getOwnPropertyDescriptor(window, 'acmePayments')?.get;
  })).toBe(true);
  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  await expect(page.locator('h1')).toContainText('Payments');
  await expectStatus(page, 'new-way', 'ready', 10_000);
  await page.getByRole('link', { name: /Home/ }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('h1')).toContainText('SDK Status Dashboard');
  await expectStatus(page, 'sdk-analytics', 'ready', 5_000);
  await expectStatus(page, 'sdk-payments', 'ready', 10_000);
  await expectStatus(page, 'sdk-maps', 'ready', 10_000);
}
