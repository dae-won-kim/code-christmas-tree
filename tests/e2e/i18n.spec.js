// 영어 화면 · 언어 전환 · 영문 이름 · 사이드 목록 로그아웃
import { test, expect, serverMode, seedDb, sampleUser, fillLogin, mockDb, shot, TOKEN_KEY } from './helpers.js';

const openLib = async page => {
  if ((await page.locator('#btnLibrary').getAttribute('aria-expanded')) !== 'true') await page.locator('#btnLibrary').click();
  await expect(page.locator('#library')).toBeVisible();
};

test.describe('브라우저 언어가 영어', () => {
  test.use({ locale: 'en-US' });

  test('영어로 시작 → 한국어로 바꾸면 기억 → 다시 영어', async ({ page }) => {
    await serverMode(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#loginHeading')).toHaveText('Open my tree');
    await expect(page.locator('#btnEnter')).toHaveText('Open my tree');
    await expect(page.locator('#btnLang')).toHaveText('한국어');
    await expect(page.locator('#emailWarn b')).toHaveText('a recovery PIN to this email');   // **굵게**가 <b>로
    await expect(page.locator('#btnLibrary')).toHaveText('☰ List');

    // 입력 검사 · 서버 오류도 영어
    await page.locator('#inName').fill('Jane1');
    await expect(page.locator('#nameMsg')).toHaveText('Names can’t contain numbers.');
    await page.waitForTimeout(3500);
    await shot(page, '30-login-en');

    await page.locator('#btnLang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.locator('#loginHeading')).toHaveText('내 트리 열기');
    await expect(page.locator('#btnLang')).toHaveText('English');
    await page.reload();
    await expect(page.locator('#loginHeading')).toHaveText('내 트리 열기');   // 이 브라우저에 기억

    await page.locator('#btnLang').click();
    await expect(page.locator('#loginHeading')).toHaveText('Open my tree');
  });

  test('영문 이름으로 만들고, 대소문자만 다르게 적어도 같은 트리 · 영어 꾸미기 화면', async ({ page }) => {
    await serverMode(page);
    await page.goto('/');
    await fillLogin(page, { name: '  John   Smith ', email: 'john@example.com', pin: '2468' });
    await page.locator('#btnEnter').click();
    await expect(page.locator('#createText')).toContainText('There is no tree for ‘John Smith’');   // 공백 정리
    await page.locator('#btnCreate').click();
    await expect(page.locator('#btnEdit')).toBeVisible();
    await expect(page.locator('#btnEdit')).toHaveText('✎ Decorate');

    await page.locator('#btnEdit').click();
    await expect(page.locator('#tab-decor')).toHaveText('Ornaments');
    await page.locator('#tab-account').click();
    await expect(page.locator('#whoami')).toHaveText('Logged in as John Smith');
    await page.locator('#tab-basic').click();
    await expect(page.locator('#patternChoices button').first()).toHaveText('Spiral Ribbon');
    await page.waitForTimeout(500);
    await shot(page, '31-edit-en');

    // 로그아웃 → 대소문자만 다른 이름으로 다시 열면 같은 트리 (새로 만들자고 하지 않음)
    await page.locator('#tab-account').click();
    await page.locator('#btnLogout').click();
    await expect(page.locator('#loginCard')).toBeVisible();
    await fillLogin(page, { name: 'JOHN smith', email: 'JOHN@example.com', pin: '2468' });
    await page.locator('#btnEnter').click();
    await expect(page.locator('#btnEdit')).toBeVisible();
    await expect(page.locator('#createConfirm')).toBeHidden();
    const db = await mockDb(page);
    expect(db.users.map(u => u.name)).toEqual(['John Smith']);   // 처음 만든 이름 그대로 한 명

    // 틀린 PIN 안내도 영어
    await page.locator('#btnEdit').click();
    await page.locator('#tab-account').click();
    await page.locator('#btnLogout').click();
    await fillLogin(page, { name: 'john smith', email: 'john@example.com', pin: '1111' });
    await page.locator('#btnEnter').click();
    await expect(page.locator('#loginError')).toContainText('Wrong PIN.');
  });
});

test('한글·영문 섞은 이름, 숫자·기호는 거부 (한국어 화면)', async ({ page }) => {
  await serverMode(page);
  await page.goto('/');
  const name = page.locator('#inName'), msg = page.locator('#nameMsg');
  await name.fill('김John');
  await expect(msg).toBeEmpty();
  await name.fill('김John2');
  await expect(msg).toHaveText('이름에는 숫자를 넣을 수 없어요.');
  await name.fill('김-John');
  await expect(msg).toHaveText('이름은 한글과 영문만 쓸 수 있어요. (숫자·기호 불가)');
  await name.fill('가나다라마바사아자차카타파하 Abcdefg');   // 21자
  await expect(msg).toHaveText('이름은 20자까지예요.');
  await fillLogin(page, { name: '김John', email: 'mix@example.com', pin: '2468' });
  await page.locator('#btnEnter').click();
  await page.locator('#btnCreate').click();
  await expect(page.locator('#btnEdit')).toBeVisible();
});

test('사이드 목록에서 로그아웃: 내 트리 → 로그인 화면, 공유 보기 → 그대로 손님으로', async ({ page }) => {
  const yh = sampleUser();
  const other = sampleUser({ id: '22222222-2222-4222-8222-222222222222', name: 'Mary', email: 'mary@example.com', share_id: 'shareMARY_01', title: "Mary's tree" });
  await serverMode(page, { seed: seedDb({ users: [yh, other], sessions: { tok1: { user: yh.id, exp: Date.now() + 1e9 } } }), token: 'tok1' });
  await page.goto('/');
  await expect(page.locator('#btnEdit')).toBeVisible();
  await openLib(page);
  await expect(page.locator('#libAccount')).toBeVisible();
  await expect(page.locator('#libWho')).toHaveText('이영희님으로 로그인됨');
  await page.waitForTimeout(400);
  await shot(page, '32-library-logout');
  await page.locator('#libLogout').click();
  await expect(page.locator('#loginCard')).toBeVisible();
  await expect(page.locator('#libMine')).toBeHidden();                  // 로그아웃하면 내 트리 · 로그아웃 칸이 사라짐
  expect(await page.evaluate(k => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
  expect(Object.keys((await mockDb(page)).sessions)).toEqual([]);      // 서버 세션도 지움

  // 다시 로그인해서 남의 공유 트리를 보다가 로그아웃 → 그 트리를 손님으로 계속 봄
  await fillLogin(page, { name: '이영희', email: 'younghee@example.com', pin: '5050' });
  await page.locator('#btnEnter').click();
  await expect(page.locator('#btnEdit')).toBeVisible();
  await page.goto('/?t=shareMARY_01');
  await expect(page.locator('#owner')).toHaveText('Mary님의 트리');
  await expect(page.locator('#btnMake')).toHaveText('🎄 내 트리로 가기');
  await openLib(page);
  await expect(page.locator('#libWho')).toHaveText('로그인됨');           // 이 화면에서는 이름을 모름(저장하지 않음)
  await page.locator('#libLogout').click();
  await expect(page.locator('#owner')).toHaveText('Mary님의 트리');
  await expect(page.locator('#btnMake')).toHaveText('✨ 나도 트리 만들기');
  await expect(page.locator('#toast')).toHaveText('로그아웃했어요.');
});
