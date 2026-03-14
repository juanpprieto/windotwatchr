import { test, expect } from '@playwright/test';

test.describe('SSR safety — Next.js', () => {
  test('payments page renders without SSR window crash', async ({ page }) => {
    // Collect console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const response = await page.goto('/payments');
    expect(response?.status()).toBe(200);

    // Page should hydrate and eventually detect SDK
    await expect(page.locator('h1')).toContainText('Payments');

    // No SSR-related console errors (window is not defined, etc.)
    const ssrErrors = errors.filter(
      (e) => e.includes('window is not defined') || e.includes('document is not defined'),
    );
    expect(ssrErrors).toHaveLength(0);
  });

  test('dashboard page renders without SSR window crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(200);

    await expect(page.locator('h1')).toContainText('SDK Status Dashboard');

    const ssrErrors = errors.filter(
      (e) => e.includes('window is not defined') || e.includes('document is not defined'),
    );
    expect(ssrErrors).toHaveLength(0);
  });

  test('initial HTML from server does not contain window access errors', async ({ request }) => {
    // Direct HTTP request — no JS execution (pure SSR HTML)
    const response = await request.get('/payments');
    expect(response.status()).toBe(200);

    const html = await response.text();

    // Should contain the page structure
    expect(html).toContain('Payments');

    // Should NOT contain error messages about window
    expect(html).not.toContain('window is not defined');
    expect(html).not.toContain('ReferenceError');
  });

  test('page hydrates and then detects SDK after SSR', async ({ page }) => {
    await page.goto('/payments');

    // After hydration + script load, windotwatchr should detect
    await expect(page.getByTestId('new-way')).toHaveAttribute('data-status', 'ready', {
      timeout: 10_000,
    });
  });
});
