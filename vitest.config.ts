import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server-imports',
          environment: 'node',
          include: ['src/**/*.ssr.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.ssr.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            // A valid portable locale avoids native browser startup failures.
            provider: playwright({ launchOptions: { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } } }),
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
