// 데모 모드, 오류·빈 상태, IME, 세션 만료, 클립보드 실패 등 개별 상태
import { test, expect, serverMode, seedDb, sampleUser, mockDb, shot, TOKEN_KEY } from './helpers.js';

test('데모 모드: config가 비어 있으면 프로토타입 그대로', async ({ page }) => {
  await page.goto('/');                    // scripts/serve.py가 빈 config.js를 돌려줌
  await expect(page.locator('#btnText')).toBeVisible();
  await expect(page.locator('#btnPhoto')).toBeVisible();
  await expect(page.locator('#btnEdit')).toBeHidden();
  await expect(page.locator('#loginCard')).toBeHidden();
  await expect(page.locator('#srMessages li')).toHaveCount(3);
  await page.locator('#btnPattern').click();
  await expect(page.locator('#patternName')).toHaveText(/— .+ —/);
  await page.locator('#btnText').click();
  await expect(page.locator('#textPanel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#textPanel')).toBeHidden();
  // supabase-js는 데모 모드에서 불러오지 않음
  expect(await page.evaluate(() => typeof window.supabase)).toBe('undefined');
});

test('공유 링크: 없는 트리', async ({ page }) => {
  await serverMode(page);
  await page.goto('/?t=nope-nope-12');
  await expect(page.locator('#screenText')).toHaveText('트리를 찾을 수 없어요. 링크가 정확한지 확인해 주세요.');
  await expect(page.locator('#screenActions a')).toHaveText('✨ 나도 트리 만들기');
  await shot(page, '10-shared-not-found');
});

test('공유 링크: 네트워크 오류 → 다시 시도', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [sampleUser()], messages: [{ id: 1, user_id: sampleUser().id, body: '안녕' }] }) });
  await page.addInitScript(() => { window.__mock.fail = { fn: 'get_tree', error: 'network' }; });
  await page.goto('/?t=shareABC_123');
  await expect(page.locator('#screenText')).toContainText('네트워크 연결을 확인해 주세요');
  await shot(page, '11-shared-network-error');
  await page.evaluate(() => { window.__mock.fail = null; });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('#owner')).toHaveText('이영희님의 트리');
  await expect(page.locator('#screen')).toBeHidden();
  await expect(page.locator('#notice')).toBeHidden();
});

test('공유 링크: 빈 트리는 안내 문구', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [sampleUser()] }) });
  await page.goto('/?t=shareABC_123');
  await expect(page.locator('#notice')).toContainText('아직 꾸미는 중인 트리');
});

test('세션 만료: 저장된 토큰이 만료되면 로그인 화면으로', async ({ page }) => {
  const u = sampleUser();
  await serverMode(page, { seed: seedDb({ users: [u], sessions: { deadbeef: { user: u.id, exp: 0 } } }), token: 'deadbeef' });
  await page.goto('/');
  await expect(page.locator('#loginCard')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('로그인이 만료됐어요');
  expect(await page.evaluate(k => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
});

test('편집 중 세션 만료(unauthorized) → 로그인 화면으로', async ({ page }) => {
  const u = sampleUser();
  await serverMode(page, { seed: seedDb({ users: [u], sessions: { cafe: { user: u.id, exp: Date.now() + 1e9 } } }), token: 'cafe' });
  await page.goto('/');
  await expect(page.locator('#btnEdit')).toBeVisible();
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '글귀' }).click();
  await page.evaluate(() => window.__mock.expireSessions());
  await page.locator('#edMsg').fill('만료 후 글귀');
  await page.locator('#btnAddMsg').click();
  await expect(page.locator('#loginCard')).toBeVisible();
  await expect(page.locator('#editPanel')).toBeHidden();
  expect((await mockDb(page)).messages).toHaveLength(0);
});

test('불러오기 실패(네트워크) → 오류 화면에서 다시 시도', async ({ page }) => {
  const u = sampleUser();
  await serverMode(page, { seed: seedDb({ users: [u], sessions: { cafe: { user: u.id, exp: Date.now() + 1e9 } } }), token: 'cafe' });
  await page.addInitScript(() => { window.__mock.fail = { fn: 'get_my_tree', error: 'network' }; });
  await page.goto('/');
  await expect(page.locator('#screenText')).toContainText('내 트리를 불러오지 못했어요');
  await page.evaluate(() => { window.__mock.fail = null; });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('#btnEdit')).toBeVisible();
  await expect(page.locator('#title')).toHaveText('영희네 트리');
  await expect(page.locator('#notice')).toContainText('아직 비어 있는 트리');
});

test('한글 IME: 조합 중에는 검증 메시지가 깜빡이지 않음', async ({ page }) => {
  await serverMode(page);
  await page.goto('/');
  const msg = page.locator('#nameMsg');
  // 실제 IME처럼 compositionstart → (조합 중 input) → compositionend 순서로 이벤트를 보냄
  const compose = (steps, end) => page.evaluate(([steps, end]) => {
    const i = document.getElementById('inName');
    i.focus();
    i.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    const seen = [];
    for (const v of steps) {
      i.value = v;
      i.dispatchEvent(new InputEvent('input', { isComposing: true, inputType: 'insertCompositionText', data: v.slice(-1) }));
      seen.push(document.getElementById('nameMsg').textContent);
    }
    if (end) {
      i.dispatchEvent(new CompositionEvent('compositionend', { data: steps.at(-1) }));
      i.dispatchEvent(new InputEvent('input', { isComposing: false, inputType: 'insertCompositionText' }));
    }
    return seen;
  }, [steps, end]);

  // "김민수" 입력: ㄱ → 기 → 김 → 김ㅁ → 김미 → 김민 → 김민ㅅ → 김민수 (조합 도중 자모 상태가 섞임)
  const seen = await compose(['ㄱ', '기', '김', '김ㅁ', '김미', '김민', '김민ㅅ', '김민수'], true);
  expect(seen.every(t => t === '')).toBe(true);           // 조합 중에는 메시지 없음
  await expect(msg).toBeEmpty();                           // 조합 끝: 올바른 이름
  await expect(page.locator('#inName')).toHaveAttribute('aria-invalid', 'false');

  // 조합이 끝난 뒤 남은 자모(예: ㅋ)는 오류로 알림
  await page.evaluate(() => {
    const i = document.getElementById('inName');
    i.value = '김민수ㅋ';
    i.dispatchEvent(new InputEvent('input', { isComposing: false, inputType: 'insertText', data: 'ㅋ' }));
  });
  await expect(msg).toContainText('자음·모음만');

  // 한 글자는 입력 중에는 알리지 않고, 칸을 벗어날 때 알림
  await page.locator('#inName').fill('김');
  await expect(msg).toBeEmpty();
  await page.locator('#inPin').focus();
  await expect(msg).toHaveText('이름은 2자 이상이에요.');

  // 조합 중 Enter(확정)로는 제출하지 않음
  await page.evaluate(() => {
    const i = document.getElementById('inName');
    i.value = '김민';
    i.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
  });
  await page.locator('#inPin').fill('1234');
  await page.evaluate(() => document.getElementById('loginCard').requestSubmit());
  await page.waitForTimeout(300);
  expect((await mockDb(page)).log).toEqual([]);
});

test('속도 제한: 서버 오류 메시지를 그대로 표시', async ({ page }) => {
  const attempts = Array.from({ length: 10 }, () => ({ name: '김민수', at: Date.now() }));
  await serverMode(page, { seed: seedDb({ attempts }) });
  await page.goto('/');
  await page.locator('#inName').fill('김민수');
  await page.locator('#inPin').fill('123456');
  await page.locator('#btnEnter').click();
  await expect(page.locator('#loginError')).toHaveText('시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.');
  await shot(page, '12-login-rate-limited');
});

test('클립보드 실패: 링크를 선택 가능한 텍스트로 보여 줌', async ({ page }) => {
  const u = sampleUser();
  await serverMode(page, { seed: seedDb({ users: [u], sessions: { cafe: { user: u.id, exp: Date.now() + 1e9 } } }), token: 'cafe' });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await page.goto('/');
  await page.locator('#btnShare').click();
  await expect(page.locator('#editPanel')).toBeVisible();
  await expect(page.getByRole('tab', { name: '공유·계정' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#copyState')).toContainText('자동 복사가 안 돼요');
  await expect(page.locator('#shareUrl')).toBeFocused();
  expect(await page.evaluate(() => { const i = document.getElementById('shareUrl'); return i.value.slice(i.selectionStart, i.selectionEnd); }))
    .toContain('?t=shareABC_123');
});

test('사진 30장 제한 · 업로드 실패 메시지', async ({ page }) => {
  const u = sampleUser();
  const photos = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, user_id: u.id, path: `${u.id}/0000000${i}.jpg`, caption: '' }));
  await serverMode(page, { seed: seedDb({ users: [u], photos, sessions: { cafe: { user: u.id, exp: Date.now() + 1e9 } } }), token: 'cafe' });
  await page.goto('/');
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '사진' }).click();
  await expect(page.locator('#photoTotal')).toHaveText('30/30');
  await expect(page.locator('#btnUpload')).toBeDisabled();
});

test('키보드: 탭 방향키 이동, 패널 열면 첫 입력칸으로 포커스', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '키보드 탐색은 데스크톱에서 확인');
  const u = sampleUser();
  await serverMode(page, { seed: seedDb({ users: [u], sessions: { cafe: { user: u.id, exp: Date.now() + 1e9 } } }), token: 'cafe' });
  await page.goto('/');
  await page.locator('#btnEdit').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#edTitle')).toBeFocused();
  await page.getByRole('tab', { name: '기본' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '글귀' })).toBeFocused();
  await expect(page.locator('#pane-msgs')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.locator('#pane-account')).toBeVisible();
});

test('실제 supabase-js(CDN, SRI 고정)가 로드되고 로그인 화면이 뜸', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'CDN 확인은 한 번만');
  await serverMode(page, { mock: false });
  await page.goto('/');
  await expect(page.locator('#loginCard')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => typeof window.supabase?.createClient)).toBe('function');
});
