// E2E 공통 도우미
import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const MOCK = path.resolve('tests/e2e/mock-supabase.js');
const CONFIG_JS = 'window.TREE_CONFIG = { SUPABASE_URL: "https://mock-project.supabase.co", SUPABASE_KEY: "sb_publishable_mock_key" };';
export const TOKEN_KEY = 'code-christmas-tree.token';

/** 모든 테스트: Console 오류·페이지 예외를 모아서 끝날 때 0개인지 확인 */
export const test = base.extend({
  errors: [async ({ page }, use) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await use(errors);
    expect(errors, 'Console 오류가 없어야 함').toEqual([]);
  }, { auto: true }]
});
export { expect };

/**
 * 서버 모드로 열기 준비: config.js를 가짜 값으로, window.supabase를 mock으로
 * @param {{ mock?: boolean, seed?: object, token?: string }} opts
 */
export async function serverMode(page, { mock = true, seed, token } = {}) {
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG_JS }));
  if (seed || token) {
    await page.addInitScript(([s, t, key]) => {
      if (sessionStorage.getItem('__seeded')) return;   // 새로고침 때는 다시 넣지 않음
      sessionStorage.setItem('__seeded', '1');
      if (s) localStorage.setItem('__mockdb', s);
      if (t) localStorage.setItem(key, t);
    }, [seed ? JSON.stringify(seed) : null, token || null, TOKEN_KEY]);
  }
  if (mock) await page.addInitScript({ path: MOCK });
}

/** 기본 mock DB 상태 하나 만들기 */
export function seedDb({ users = [], messages = [], photos = [], objects = {}, sessions = {}, attempts = [] } = {}) {
  return { seq: 100, users, sessions, attempts, tickets: [], messages, photos, objects, log: [] };
}
export const sampleUser = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', name: '이영희', pin: '5678', share_id: 'shareABC_123',
  title: '영희네 트리', pattern: 1, settings: {}, created_at: Date.now(), ...over
});

export const mockDb = page => page.evaluate(() => window.__mock.db());

/** 브라우저 canvas로 테스트용 JPEG 만들기 */
export async function makeJpeg(page, name, { w = 640, h = 480, color = '#3a6ea5' } = {}) {
  const b64 = await page.evaluate(([w, h, color]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = `${h / 4}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🎄', w / 2, h / 2);
    return c.toDataURL('image/jpeg', .9).split(',')[1];
  }, [w, h, color]);
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** 화면 확인용 스크린샷: test-results/screens/<프로젝트>-<이름>.png */
export async function shot(page, name) {
  const dir = path.resolve('test-results/screens');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${test.info().project.name}-${name}.png`) });
}
