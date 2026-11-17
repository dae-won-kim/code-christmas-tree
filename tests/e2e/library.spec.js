// 트리 목록(사이드 서랍): 담은 트리 · 최근 본 트리, 읽기 전용 담기, 로그인 전 기록 합치기
import { test, expect, serverMode, seedDb, sampleUser, mockDb, shot, TOKEN_KEY } from './helpers.js';

const HISTORY_KEY = 'code-christmas-tree.history';
const younghee = sampleUser();   // 이영희, share_id shareABC_123
const cheolsu = sampleUser({ id: '22222222-2222-4222-8222-222222222222', name: '박철수', pin: '2468', share_id: 'shareXYZ_789', title: '철수의 겨울', pattern: 3 });
const minsu = sampleUser({ id: '33333333-3333-4333-8333-333333333333', name: '김민수', pin: '1357', share_id: 'shareMIN_000', title: '민수네 트리', pattern: 0 });
const messages = [
  { id: 1, user_id: younghee.id, body: '영희의 첫 글귀' },
  { id: 2, user_id: cheolsu.id, body: '철수의 첫 글귀' }
];
const session = user => ({ cafe: { user: user.id, exp: Date.now() + 1e9 } });

test('게스트: 본 기록은 브라우저에 → [담기] → 로그인하면 DB 목록으로 합쳐지고 담김', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [younghee, cheolsu], messages }) });

  await page.goto('/?t=shareABC_123');
  await expect(page.locator('#owner')).toHaveText('이영희님의 트리');
  await expect(page.locator('#btnLibrary')).toBeVisible();
  await expect(page.locator('#btnLibrary')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#library')).toBeHidden();                 // 기본은 접힘
  await expect(page.locator('#btnSave')).toHaveText('☆ 담기');

  await page.goto('/?t=shareXYZ_789');
  await expect(page.locator('#owner')).toHaveText('박철수님의 트리');
  const local = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), HISTORY_KEY);
  expect(local.map(x => x.name)).toEqual(['박철수', '이영희']);         // 최근 순
  expect((await mockDb(page)).log).not.toContain('record_view');       // 로그인 전에는 DB에 기록하지 않음

  await page.locator('#btnLibrary').click();
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.locator('#libHistory li')).toHaveCount(2);
  await expect(page.locator('#libHistory li').first().locator('a')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#libSavedEmpty')).toContainText('로그인하면');
  await page.waitForTimeout(400);
  await shot(page, '13-library-guest');
  await page.locator('#libClose').click();
  await expect(page.locator('#library')).toBeHidden();

  // 로그인 없이 [담기] → 로그인 화면 + 안내 → 새 트리 만들기
  await page.locator('#btnSave').click();
  await expect(page.locator('#loginCard')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator('#loginNote')).toHaveText('로그인하면 ‘박철수님의 트리’를 내 목록에 담아 둘게요.');
  await page.locator('#inName').fill('김민수');
  await page.locator('#inPin').fill('1357');
  await page.locator('#btnEnter').click();
  await page.locator('#btnCreate').click();
  await expect(page.locator('#btnEdit')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('박철수님의 트리를 담았어요', { timeout: 6000 });

  const db = await mockDb(page);
  const me = db.users.find(u => u.name === '김민수').id;
  const mine = db.views.filter(v => v.viewer === me);
  expect(mine).toHaveLength(2);                                         // 브라우저 기록 2개가 합쳐짐
  expect(mine.find(v => v.tree === cheolsu.id).saved).toBe(true);
  expect(await page.evaluate(k => localStorage.getItem(k), HISTORY_KEY)).toBeNull();

  await page.locator('#btnLibrary').click();
  await expect(page.locator('#libSaved li')).toHaveCount(1);
  await expect(page.locator('#libSaved li .who')).toHaveText('박철수님의 트리');
  await expect(page.locator('#libSaved li .meta')).toContainText('철수의 겨울');
  await expect(page.locator('#libHistory li')).toHaveCount(2);
  await expect(page.locator('#libHistory li .who').first()).toHaveText('★ 박철수님의 트리');   // 담은 트리 표시
});

test('로그인 사용자: 열면 DB에 기록, 담기 토글, 목록에서 이동·뒤로 가기, 지우기', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [younghee, cheolsu, minsu], messages, sessions: session(minsu) }), token: 'cafe' });

  await page.goto('/?t=shareABC_123');
  await expect(page.locator('#owner')).toHaveText('이영희님의 트리');
  await expect(page.locator('#btnMake')).toHaveText('🎄 내 트리로 가기');
  await expect(page.locator('#btnSave')).toHaveText('☆ 담기');
  expect((await mockDb(page)).views).toHaveLength(1);

  await page.locator('#btnSave').click();
  await expect(page.locator('#btnSave')).toHaveText('★ 담김');
  await expect(page.locator('#btnSave')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toast')).toContainText('이영희님의 트리를 담았어요');
  expect((await mockDb(page)).views[0].saved).toBe(true);
  // 담아도 읽기 전용: 편집 버튼이 없음
  await expect(page.locator('#btnEdit')).toBeHidden();

  // 서랍을 펼친 상태는 새로고침해도 기억
  await page.locator('#btnLibrary').click();
  await page.goto('/?t=shareXYZ_789');
  await expect(page.locator('#owner')).toHaveText('박철수님의 트리');
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.locator('#libHistory li')).toHaveCount(2);
  await expect(page.locator('#libSaved li')).toHaveCount(1);
  await page.waitForTimeout(400);
  await shot(page, '14-library-open');

  // 목록에서 고르면 새로고침 없이 이동, 뒤로 가기도 동작
  await page.locator('#libHistory a', { hasText: '이영희님의 트리' }).click();
  await expect(page.locator('#owner')).toHaveText('이영희님의 트리');
  await expect(page).toHaveURL(/\?t=shareABC_123$/);
  await expect(page.locator('#btnSave')).toHaveText('★ 담김');
  await page.goBack();
  await expect(page.locator('#owner')).toHaveText('박철수님의 트리');

  // 서랍에서 담기 취소 → 지금 보는 트리 버튼과 상관없이 목록만 바뀜
  if (!(await page.locator('#library').isVisible())) await page.locator('#btnLibrary').click();
  await page.getByRole('button', { name: '담기 취소: 이영희님의 트리' }).click();
  await expect(page.locator('#libSaved li')).toHaveCount(0);
  expect((await mockDb(page)).views.find(v => v.tree === younghee.id).saved).toBe(false);

  // 기록 하나 지우기 → 모두 지우기(두 번 눌러 확인)
  await page.getByRole('button', { name: '기록에서 지우기: 이영희님의 트리' }).click();
  await expect(page.locator('#libHistory li')).toHaveCount(1);
  await page.locator('#libClear').click();
  await expect(page.locator('#libClear')).toHaveText('정말 다 지울까요?');
  await page.locator('#libClear').click();
  await expect(page.locator('#libHistory li')).toHaveCount(0);
  await expect(page.locator('#libHistoryEmpty')).toBeVisible();
  expect((await mockDb(page)).views).toHaveLength(0);

  // Esc로 접기 → 버튼으로 포커스 복귀, 접힌 서랍은 Tab으로 못 들어감(inert)
  await page.locator('#libClose').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#btnLibrary')).toBeFocused();
  expect(await page.evaluate(() => document.getElementById('library').inert)).toBe(true);
});

test('내 트리의 공유 링크: 담기 버튼 없음, 기록하지 않음, [내 트리로 가기]', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [younghee], messages, sessions: session(younghee) }), token: 'cafe' });
  await page.goto('/?t=shareABC_123');
  await expect(page.locator('#owner')).toHaveText('이영희님의 트리');
  await expect(page.locator('#btnMake')).toHaveText('🎄 내 트리로 가기');
  await expect.poll(async () => (await mockDb(page)).log.includes('record_view')).toBe(true);
  await expect(page.locator('#btnSave')).toBeHidden();
  expect((await mockDb(page)).views).toHaveLength(0);
  await page.locator('#btnMake').click();
  await expect(page.locator('#btnEdit')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(k => localStorage.getItem(k), TOKEN_KEY)).toBe('cafe');
});

test('사용자 입력은 목록에서도 글자 그대로 (XSS)', async ({ page }) => {
  const evil = sampleUser({ id: '44444444-4444-4444-8444-444444444444', name: '최악당', share_id: 'shareEVIL_01', title: '<img src=x onerror="window.__xss=1">' });
  await serverMode(page, { seed: seedDb({ users: [evil] }) });
  await page.goto('/?t=shareEVIL_01');
  await expect(page.locator('#owner')).toHaveText('최악당님의 트리');
  await page.locator('#btnLibrary').click();
  await expect(page.locator('#libHistory li .meta')).toContainText('<img src=x');
  expect(await page.locator('#library img').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
