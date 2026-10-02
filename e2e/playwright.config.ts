import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    launchOptions: { env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
  },
  webServer: {
    command: 'bun scripts/serve-examples.ts',
    url: 'http://127.0.0.1:4173/windotwatchr/nextjs/',
    reuseExistingServer: false,
    cwd: '..',
    timeout: 30_000,
  },
  projects: [
    {
      name: 'nextjs',
      testDir: './tests/nextjs',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173/windotwatchr/nextjs/' },
    },
    {
      name: 'vite-react',
      testDir: './tests/vite-react',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173/windotwatchr/vite-react/' },
    },
  ],
});
