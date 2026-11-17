// E2E 테스트 설정 — 실제 Supabase 없이 window.supabase를 mock으로 바꿔서 화면 흐름을 검증한다.
//   npm install && npx playwright install chromium
//   npm run test:e2e
import { defineConfig } from '@playwright/test';

const PORT = 8130;
const python = process.platform === 'win32' ? 'python' : 'python3';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    browserName: 'chromium'
  },
  webServer: {
    command: `${python} scripts/serve.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
  ]
});
