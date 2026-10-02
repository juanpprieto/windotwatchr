import { defineConfig, devices } from '@playwright/test';

const origin = `http://127.0.0.1:${process.env.WINDOT_EXAMPLE_PORT ?? '4173'}`;

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
    url: `${origin}/windotwatchr/nextjs/`,
    reuseExistingServer: false,
    cwd: '..',
    timeout: 30_000,
  },
  projects: [
    {
      name: 'nextjs',
      testDir: './tests/nextjs',
      use: { ...devices['Desktop Chrome'], baseURL: `${origin}/windotwatchr/nextjs/` },
    },
    {
      name: 'vite-react',
      testDir: './tests/vite-react',
      use: { ...devices['Desktop Chrome'], baseURL: `${origin}/windotwatchr/vite-react/` },
    },
  ],
});
