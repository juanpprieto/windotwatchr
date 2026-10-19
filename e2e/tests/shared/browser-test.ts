import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') {errors.push(message.text());} });
    await use();
    expect(errors, 'Unexpected browser errors').toEqual([]);
  }, { auto: true }],
});

export { expect };
