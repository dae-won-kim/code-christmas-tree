// PIN을 잊었을 때: 이메일로 복구 PIN 받기 → 새 PIN 정하기 (Supabase Auth 이메일 OTP는 mock)
import { test, expect, serverMode, seedDb, sampleUser, mockDb, shot } from './helpers.js';

const younghee = sampleUser();   // 이영희 · younghee@example.com · PIN 5050
const oldSession = { other: { user: younghee.id, exp: Date.now() + 1e9 } };   // 다른 기기의 로그인
const lastCode = (page, email) => page.evaluate(e => window.__mock.lastCode(e), email);

test('PIN 복구: 메일로 받은 복구 PIN → 새 PIN → 바로 내 트리', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [younghee], sessions: oldSession }) });
  await page.goto('/');

  // 로그인 칸에 적은 이름·이메일을 그대로 가져감
  await page.locator('#inName').fill('이영희');
  await page.locator('#inEmail').fill('YoungHee@example.com');
  await page.locator('#btnForgot').click();
  await expect(page.locator('#recoverCard')).toBeVisible();
  await expect(page.locator('#loginCard')).toBeHidden();
  await expect(page.locator('#rcName')).toHaveValue('이영희');
  await expect(page.locator('#rcStep2')).toBeHidden();

  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcStep2')).toBeVisible();
  await expect(page.locator('#rcSent')).toContainText('younghee@example.com 로 복구 PIN을 보냈어요');
  await expect(page.locator('#rcEmail')).toHaveAttribute('readonly', '');
  await expect(page.locator('#btnResend')).toBeDisabled();             // 1분 동안 다시 보내기 잠금
  await expect(page.locator('#btnResend')).toContainText('초)');
  await expect(page.locator('#btnRecover')).toHaveText('PIN 바꾸고 트리 열기');
  await expect(page.locator('#rcCode')).toBeFocused();
  const code = await lastCode(page, 'younghee@example.com');
  expect(code).toMatch(/^[0-9]{6}$/);
  await page.waitForTimeout(300);
  await shot(page, '15-recover-code');

  // 틀린 복구 PIN
  await page.locator('#rcCode').fill('000000');
  await page.locator('#rcPin').fill('4321');
  await page.locator('#rcPin2').fill('4321');
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toContainText('복구 PIN이 맞지 않거나 만료됐어요');

  // 새 PIN 확인 불일치 · 형식
  await page.locator('#rcCode').fill(code);
  await page.locator('#rcPin2').fill('4322');
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toHaveText('새 PIN 확인이 일치하지 않아요.');
  await page.locator('#rcPin').fill('43');
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toHaveText('새 PIN은 4자리 이상이에요.');
  await page.locator('#rcPin').fill('4321');
  await page.locator('#rcPin2').fill('4321');

  // 이름 오타: 메일 확인은 끝났으니 복구 PIN은 다시 받지 않고 이름만 고치면 됨
  await page.locator('#rcName').fill('이영이');
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toContainText('이 이메일로 그 이름의 트리가 없어요');
  await expect(page.locator('#rcCode')).toBeDisabled();
  await expect(page.locator('#rcName')).toBeFocused();
  await page.locator('#rcName').fill('이영희');
  await page.locator('#btnRecover').click();

  await expect(page.locator('#btnEdit')).toBeVisible();
  await expect(page.locator('#title')).toHaveText('영희네 트리');
  await expect(page.locator('#recoverCard')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('새 PIN으로 바꿨어요');
  const db = await mockDb(page);
  expect(db.users[0].pin).toBe('4321');
  expect(Object.keys(db.sessions)).not.toContain('other');                 // 다른 기기 로그인은 해제
  expect(db.log.filter(f => f === 'auth.verifyOtp')).toHaveLength(1);     // 이름을 고칠 때 메일을 다시 확인하지 않음

  // 로그아웃 후 새 PIN으로 로그인, 옛 PIN은 거부
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '공유·계정' }).click();
  await page.locator('#btnLogout').click();
  await page.locator('#inName').fill('이영희');
  await page.locator('#inPin').fill('5050');
  await page.locator('#inEmail').fill('younghee@example.com');
  await page.locator('#btnEnter').click();
  await expect(page.locator('#loginError')).toContainText('PIN이 맞지 않아요');
  await page.locator('#inPin').fill('4321');
  await page.locator('#btnEnter').click();
  await expect(page.locator('#btnEdit')).toBeVisible();
});

test('PIN 복구: 메일 발송 실패 · 1분 제한 · 로그인으로 돌아가기', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [younghee] }) });
  await page.goto('/');
  await page.locator('#btnForgot').click();
  await expect(page.locator('#rcName')).toBeFocused();                   // 로그인 칸이 비어 있었으면 이름부터

  // 입력 검사 (메일을 보내기 전에)
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toHaveText('이름을 입력해 주세요.');
  await page.locator('#rcName').fill('이영희');
  await page.locator('#rcEmail').fill('younghee@');
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toContainText('이메일 주소를 확인');
  expect((await mockDb(page)).log).not.toContain('auth.signInWithOtp');

  // 메일 서버 오류
  await page.locator('#rcEmail').fill('younghee@example.com');
  await page.evaluate(() => { window.__mock.authFail = 'send'; });
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toHaveText('복구 메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
  await expect(page.locator('#rcStep2')).toBeHidden();
  await expect(page.locator('#btnRecover')).toBeEnabled();

  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcStep2')).toBeVisible();

  // ← 로그인으로 → 다시 열어서 1분 안에 또 보내면 Supabase 제한 메시지
  await page.locator('#btnRecoverBack').click();
  await expect(page.locator('#loginCard')).toBeVisible();
  await expect(page.locator('#recoverCard')).toBeHidden();
  await page.locator('#inName').fill('이영희');
  await page.locator('#inEmail').fill('younghee@example.com');
  await page.locator('#btnForgot').click();
  await expect(page.locator('#rcStep2')).toBeHidden();                   // 처음 단계부터
  await page.locator('#btnRecover').click();
  await expect(page.locator('#rcError')).toContainText('메일은 잠시 뒤에 다시 보낼 수 있어요');
  await shot(page, '16-recover-rate');

  // Esc로도 로그인 화면으로
  await page.keyboard.press('Escape');
  await expect(page.locator('#loginCard')).toBeVisible();
  expect((await mockDb(page)).users[0].pin).toBe('5050');               // 아무것도 바뀌지 않음
});
