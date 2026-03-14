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
  },
  webServer: [
    {
      command: 'pnpm --filter nextjs-showcase dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter vite-react-showcase dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      cwd: '..',
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'nextjs',
      testDir: './tests/nextjs',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3000' },
    },
    {
      name: 'vite-react',
      testDir: './tests/vite-react',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
  ],
});
