import { test, expect } from '@playwright/test';
import { waitForWWApi } from '../shared/sdk-detection';

test.describe('Core features — Next.js', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('dashboard');
    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');
    await waitForWWApi(page);
  });

  test('AbortSignal: aborting cancels detection', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ aborted: boolean; detected: boolean }>((resolve) => {
        const ctrl = new AbortController();
        let detected = false;

        const { watchWindot } = (window as any).__ww;
        watchWindot('acmePayments.ui.components', () => {
          detected = true;
        }, { signal: ctrl.signal });

        // Abort immediately — before the 800ms script load
        ctrl.abort();

        // Wait for the script to actually load, then check
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

  test('custom ready predicate: acmePx.loaded must be true', async ({ page }) => {
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

  test('dispose/cleanup: unmounting stops notifications', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ notifiedAfterDispose: boolean }>((resolve) => {
        let notifiedAfterDispose = false;

        const { watchWindot } = (window as any).__ww;
        const dispose = watchWindot('acme.maps.Map', () => {
          notifiedAfterDispose = true;
        });

        // Dispose immediately
        dispose();

        // Wait for the script to load
        setTimeout(() => {
          resolve({ notifiedAfterDispose });
        }, 2000);
      });
    });

    expect(result.notifiedAfterDispose).toBe(false);
  });

  test('ww:ready event contains correct detail shape', async ({ page }) => {
    // Install collector via addInitScript so it runs BEFORE any page JS,
    // catching even synchronous ww:ready events like analytics
    await page.addInitScript(() => {
      const key = '__e2e_ww_ready';
      (window as Record<string, unknown>)[key] = [];
      window.addEventListener('ww:ready', (e: Event) => {
        const detail = (e as CustomEvent).detail;
        ((window as Record<string, unknown>)[key] as unknown[]).push({
          ...detail,
          _capturedAt: Date.now(),
        });
      });
    });

    // Navigate fresh so addInitScript takes effect
    await page.goto('dashboard');
    await expect(page.getByTestId('sdk-analytics')).toHaveAttribute('data-status', 'ready', {
      timeout: 5_000,
    });

    const events = await page.evaluate(
      () => (window as Record<string, unknown>).__e2e_ww_ready as Record<string, unknown>[],
    );
    const analyticsEvent = events.find((e) => e.path === 'acmeDataLayer');

    expect(analyticsEvent).toBeDefined();
    expect(analyticsEvent!.path).toBe('acmeDataLayer');
    expect(analyticsEvent!.value).toBeDefined();
    expect(analyticsEvent!._capturedAt).toBeDefined();
  });

  test('multiple watchers on same root key share singleton', async ({ page }) => {
    const result = await page.evaluate(() => {
      return new Promise<{ bothResolved: boolean }>((resolve) => {
        let resolved1 = false;
        let resolved2 = false;

        const { watchWindot } = (window as any).__ww;
        watchWindot('acmePayments', () => { resolved1 = true; });
        watchWindot('acmePayments.ui', () => { resolved2 = true; });

        setTimeout(() => {
          resolve({ bothResolved: resolved1 && resolved2 });
        }, 2000);
      });
    });

    expect(result.bothResolved).toBe(true);
  });

  test('waitForWindot promise resolves in real browser', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      return waitForWindot('acmeDataLayer', { timeout: 5000 })
        .then((value: unknown) => {
          return { resolved: true, isArray: Array.isArray(value) };
        })
        .catch((err: Error) => {
          return { resolved: false, isArray: false, error: err.message };
        });
    });

    expect(result.resolved).toBe(true);
    expect(result.isArray).toBe(true);
  });

  test('waitForWindot rejects on timeout when value never appears', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      return waitForWindot('nonExistentGlobal.deep.path', {
        timeout: 500,
        retries: 0,
      }).then(() => {
        return { rejected: false, errorMessage: '' };
      }).catch((err: Error) => {
        return { rejected: true, errorMessage: err.message };
      });
    });

    expect(result.rejected).toBe(true);
    expect(result.errorMessage).toContain('timeout');
    expect(result.errorMessage).toContain('nonExistentGlobal.deep.path');
  });

  test('AbortSignal: already-aborted signal rejects immediately', async ({ page }) => {
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

  test('function-type globals detected correctly (acmeTag)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { waitForWindot } = (window as any).__ww;
      return waitForWindot('acmeTag', { timeout: 5000 })
        .then((value: unknown) => {
          return { resolved: true, type: typeof value };
        })
        .catch(() => {
          return { resolved: false, type: '' };
        });
    });

    expect(result.resolved).toBe(true);
    expect(result.type).toBe('function');
  });
});
