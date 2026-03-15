import { test, expect } from '@playwright/test';
import { waitForWWApi } from '../shared/sdk-detection';

test.describe('Core features — Vite + React', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/dashboard');
    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');
    await waitForWWApi(page);
  });

  test('AbortSignal: aborting cancels detection', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ aborted: boolean; detected: boolean }>((resolve) => {
        let detected = false;

        const { watchWindot } = (window as any).__ww;
        const ctrl = new AbortController();
        watchWindot('acmePayments.ui.components', () => {
          detected = true;
        }, { signal: ctrl.signal });

        // Abort immediately
        ctrl.abort();

        setTimeout(() => {
          resolve({ aborted: true, detected });
        }, 2000);
      });
    });

    expect(result.aborted).toBe(true);
    expect(result.detected).toBe(false);
  });

  test('retry: retries after timeout and eventually succeeds', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      return waitForWindot('acme.maps.Map', {
        timeout: 200,
        retries: 10,
        pollInterval: 200,
      }).then((value: unknown) => {
        return { resolved: true, type: typeof value };
      }).catch(() => {
        return { resolved: false, type: '' };
      });
    });

    expect(result.resolved).toBe(true);
    expect(result.type).toBe('function');
  });

  test('custom ready predicate filters correctly', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ ready: boolean; loadedValue: unknown }>((resolve) => {
        const { watchWindot } = (window as any).__ww;
        watchWindot('acmePx.loaded', (value: unknown) => {
          resolve({ ready: true, loadedValue: value });
        }, {
          ready: (v: unknown) => v === true,
        });

        setTimeout(() => resolve({ ready: false, loadedValue: null }), 5000);
      });
    });

    expect(result.ready).toBe(true);
    expect(result.loadedValue).toBe(true);
  });

  test('dispose/cleanup stops notifications', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ notifiedAfterDispose: boolean }>((resolve) => {
        let notifiedAfterDispose = false;

        const { watchWindot } = (window as any).__ww;
        const dispose = watchWindot('acme.maps.Map', () => {
          notifiedAfterDispose = true;
        });

        dispose();

        setTimeout(() => {
          resolve({ notifiedAfterDispose });
        }, 2000);
      });
    });

    expect(result.notifiedAfterDispose).toBe(false);
  });

  test('waitForWindot rejects on timeout', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      return waitForWindot('nonExistentGlobal', {
        timeout: 500,
        retries: 0,
      }).then(() => {
        return { rejected: false, message: '' };
      }).catch((err: Error) => {
        return { rejected: true, message: err.message };
      });
    });

    expect(result.rejected).toBe(true);
    expect(result.message).toContain('timeout');
  });

  test('already-aborted signal rejects immediately', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      const ctrl = new AbortController();
      ctrl.abort();
      return waitForWindot('acmeDataLayer', { signal: ctrl.signal })
        .then(() => {
          return { rejected: false, message: '' };
        })
        .catch((err: Error) => {
          return { rejected: true, message: err.message };
        });
    });

    expect(result.rejected).toBe(true);
    expect(result.message).toContain('aborted');
  });

  test('ww:ready event shape is correct', async ({ page }) => {
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
    await expect(page.getByTestId('sdk-analytics')).toHaveAttribute('data-status', 'ready', {
      timeout: 5_000,
    });

    const events = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__e2e_ww_ready as Record<string, unknown>[],
    );
    const analyticsEvent = events.find((e) => e.path === 'acmeDataLayer');

    expect(analyticsEvent).toBeDefined();
    expect(analyticsEvent!.path).toBe('acmeDataLayer');
    expect(analyticsEvent!.value).toBeDefined();
  });

  test('multiple watchers on same root share singleton', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ bothResolved: boolean }>((resolve) => {
        let r1 = false;
        let r2 = false;

        const { watchWindot } = (window as any).__ww;
        watchWindot('acmePayments', () => { r1 = true; });
        watchWindot('acmePayments.ui', () => { r2 = true; });

        setTimeout(() => {
          resolve({ bothResolved: r1 && r2 });
        }, 2000);
      });
    });

    expect(result.bothResolved).toBe(true);
  });

  test('navigation cleanup: no leaks after route change', async ({ page }) => {
    // Start on dashboard
    await expect(page.getByTestId('sdk-analytics')).toHaveAttribute('data-status', 'ready', {
      timeout: 5_000,
    });

    // Navigate away
    await page.goto('#/');
    await expect(page.locator('h1')).toContainText('windotwatchr showcase');

    // Navigate back
    await page.goto('#/dashboard');
    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');

    // SDKs should still be detected (globals persist on window)
    await expect(page.getByTestId('sdk-analytics')).toHaveAttribute('data-status', 'ready', {
      timeout: 5_000,
    });
  });
});
