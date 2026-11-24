import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel worktrees run their own preview server without clashing.
const port = Number(process.env['E2E_PORT'] ?? 4173);
const isCI = Boolean(process.env['CI']);

// Smoke flows run against the production build served by `vite preview`,
// so `bun run build` must run first (CI and `bun run check` do this).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx vite preview --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !isCI,
  },
});
