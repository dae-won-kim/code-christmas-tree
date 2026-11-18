// 전체 흐름: 로그인 → 새 트리 → 꾸미기(제목·무늬·설정) → 글귀 → 사진 업로드·삭제 → 공유 링크 → PIN 변경 → 로그아웃 → 다시 로그인 → 공유 보기
import { test, expect, serverMode, mockDb, makeJpeg, shot, TOKEN_KEY } from './helpers.js';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('로그인부터 공유 보기까지 전체 흐름', async ({ page, browser }) => {
  test.setTimeout(240_000);   // 단계가 많은 긴 시나리오 (병렬 실행 시 렌더링 부하로 느려질 수 있음)
  await serverMode(page);
  await page.goto('/');

  const name = page.locator('#inName'), email = page.locator('#inEmail'), pin = page.locator('#inPin');

  await test.step('로그인 화면', async () => {
    await expect(page.locator('#loginCard')).toBeVisible();
    await expect(page.locator('#btnEdit')).toBeHidden();
    await expect(page.locator('#btnText')).toBeHidden();        // 데모 전용 버튼은 숨김
    await expect(pin).toHaveAttribute('type', 'password');
    await expect(pin).toHaveAttribute('autocomplete', 'current-password');
    await expect(pin).toHaveAttribute('inputmode', 'numeric');
    await expect(pin).toHaveAttribute('maxlength', '10');
    await expect(email).toHaveAttribute('type', 'email');
    await expect(page.locator('#emailWarn')).toContainText('이 이메일로 복구 PIN');   // 복구 주소라 정확히 적으라는 안내
    await expect(page.locator('#btnForgot')).toBeVisible();
    await page.waitForTimeout(3500);                              // 트리가 모이고 제목이 나타날 때까지
    await shot(page, '01-login');
  });

  await test.step('이름·PIN·이메일 검증 메시지', async () => {
    await name.fill('kim1');
    await expect(page.locator('#nameMsg')).toContainText('숫자');
    await name.fill('kim!');
    await expect(page.locator('#nameMsg')).toContainText('한글과 영문만');
    await name.fill('Kim Minsu');                                   // 영문 이름(공백 한 칸)도 허용
    await expect(page.locator('#nameMsg')).toBeEmpty();
    await name.fill('김민수');
    await expect(page.locator('#nameMsg')).toBeEmpty();
    await pin.fill('12a');
    await expect(page.locator('#pinMsg')).toContainText('숫자만');
    await pin.fill('12');
    await email.fill('minsu@');
    await page.locator('#btnEnter').click();
    await expect(page.locator('#pinMsg')).toContainText('4자리 이상');
    await pin.fill('2580');
    await page.locator('#btnEnter').click();
    await expect(page.locator('#emailMsg')).toContainText('이메일 주소를 확인');
    await email.fill('minsu @example.com');
    await expect(page.locator('#emailMsg')).toContainText('공백');
  });

  await test.step('없는 트리 → 새로 만들기 확인 → 생성', async () => {
    await email.fill('  MinSu@Example.com ');                         // 대소문자·공백은 정리됨
    await pin.fill('1234');                                          // 쉬운 PIN → 한 번 더 안내
    await page.locator('#btnEnter').click();
    await expect(page.locator('#createConfirm')).toBeVisible();
    await expect(page.locator('#createText')).toContainText('‘김민수’ · minsu@example.com');
    await expect(page.locator('#createText')).toContainText('주소가 맞는지');
    await expect(page.locator('#createText')).toContainText('쉬운 PIN');
    await page.locator('#btnCreateCancel').click();
    await pin.fill('2580');
    await page.locator('#btnEnter').click();
    await expect(page.locator('#createConfirm')).toBeVisible();
    await expect(page.locator('#createText')).not.toContainText('쉬운 PIN');
    await shot(page, '02-login-confirm');
    await page.locator('#btnCreate').click();
    await expect(page.locator('#btnEdit')).toBeVisible();
    await expect(page.locator('#loginCard')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('새 트리를 만들었어요');
    await expect(page.locator('#notice')).toContainText('아직 비어 있는 트리');
    const db = await mockDb(page);
    expect(db.users).toHaveLength(1);
    expect(db.users[0].name).toBe('김민수');
    expect(await page.evaluate(k => localStorage.getItem(k), TOKEN_KEY)).toMatch(/^[0-9a-f]{64}$/);
    await page.waitForTimeout(800);
    await shot(page, '03-mine-empty');
  });

  await test.step('꾸미기: 제목 (debounce 저장 1회)', async () => {
    await page.locator('#btnEdit').click();
    await expect(page.locator('#editPanel')).toBeVisible();
    await expect(page.locator('#btnEdit')).toHaveAttribute('aria-expanded', 'true');
    const title = page.locator('#edTitle');
    await expect(title).toHaveValue('Merry Christmas');
    await title.fill('');
    await expect(page.locator('#edTitleMsg')).toContainText('비워 둘 수 없어요');
    await title.pressSequentially('민수네 트리', { delay: 40 });
    await expect(page.locator('#title')).toHaveText('민수네 트리');
    await expect(page.locator('#saveState')).toHaveText('저장됨', { timeout: 5000 });
    const db = await mockDb(page);
    expect(db.trees[0].title).toBe('민수네 트리');
    expect(db.log.filter(f => f === 'update_tree')).toHaveLength(1);
  });

  await test.step('꾸미기: 무늬·설정', async () => {
    await page.getByRole('button', { name: '빛의 고리' }).click();
    await expect(page.getByRole('button', { name: '빛의 고리' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#edAutoRotate').uncheck();
    await expect(page.locator('#saveState')).toHaveText('저장됨', { timeout: 5000 });
    const u = (await mockDb(page)).trees[0];
    expect(u.pattern).toBe(2);
    expect(u.settings).toEqual({ autoRotate: false, patternCycle: true, characters: true, gifts: true });
    await shot(page, '04-edit-basic');
  });

  await test.step('글귀: Enter로 추가, 버튼으로 추가, XSS 문자열은 글자 그대로', async () => {
    await page.getByRole('tab', { name: '글귀' }).click();
    await expect(page.locator('#msgEmpty')).toBeVisible();
    const input = page.locator('#edMsg');
    await input.fill('메리 크리스마스!');
    await expect(page.locator('#edMsgCount')).toHaveText('9/100');
    await input.press('Enter');
    await expect(page.locator('#msgList li')).toHaveCount(1);
    const xss = '<img src=x onerror="window.__xss=1">';
    await input.fill(xss);
    await page.locator('#btnAddMsg').click();
    await expect(page.locator('#msgList li')).toHaveCount(2);
    await expect(page.locator('#msgList li .text').nth(1)).toHaveText(xss);
    expect(await page.locator('#msgList img, #message img, #srMessages img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#srMessages li')).toHaveText(['메리 크리스마스!', xss]);
    await expect(page.locator('#msgTotal')).toHaveText('2/50');
    // 두 번째 글귀 삭제
    await page.getByRole('button', { name: `글귀 삭제: ${xss}` }).click();
    await expect(page.locator('#msgList li')).toHaveCount(1);
    expect((await mockDb(page)).messages.map(m => m.body)).toEqual(['메리 크리스마스!']);
    await expect(page.locator('#notice')).toContainText('사진이 아직 없어요');
    await shot(page, '05-edit-messages');
  });

  await test.step('사진: 여러 장 업로드 (캡션) → 1장 삭제', async () => {
    await page.getByRole('tab', { name: '사진' }).click();
    await expect(page.locator('#photoEmpty')).toBeVisible();
    await page.locator('#edCaption').fill('첫 사진');
    const files = [await makeJpeg(page, 'a.jpg'), await makeJpeg(page, 'b.jpg', { w: 480, h: 640, color: '#a53a4a' })];
    await page.locator('#photoInput').setInputFiles(files);
    await expect(page.locator('#uploadState')).toContainText('2장을 올렸어요.', { timeout: 15000 });
    await expect(page.locator('#photoGrid li')).toHaveCount(2);
    await expect(page.locator('#photoTotal')).toHaveText('2/30');
    await expect(page.locator('#notice')).toBeHidden();
    let db = await mockDb(page);
    expect(db.photos.map(p => p.caption)).toEqual(['첫 사진', '첫 사진']);
    expect(Object.keys(db.objects)).toHaveLength(2);
    expect(db.tickets).toHaveLength(0);                              // 업로드 티켓은 확정 후 삭제
    await shot(page, '06-edit-photos');

    const del = page.locator('#photoGrid li').first().getByRole('button');
    await del.click();
    await expect(del).toHaveText('정말 삭제?');                       // 두 번 눌러야 삭제
    await del.click();
    await expect(page.locator('#photoGrid li')).toHaveCount(1);
    db = await mockDb(page);
    expect(db.photos).toHaveLength(1);
    expect(Object.keys(db.objects)).toHaveLength(1);                 // Storage 파일도 지워짐
  });

  let shareUrl;
  await test.step('공유 링크 복사', async () => {
    await page.getByRole('tab', { name: '공유·계정' }).click();
    const db = await mockDb(page);
    shareUrl = await page.locator('#shareUrl').inputValue();
    expect(shareUrl).toBe(new URL(`/?t=${db.trees[0].share_id}`, page.url()).toString());
    await page.locator('#btnCopy').click();
    await expect(page.locator('#copyState')).toHaveText('링크를 복사했어요.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
    await expect(page.locator('#whoami')).toHaveText('김민수님으로 로그인됨');
    await shot(page, '07-edit-account');
  });

  await test.step('PIN 변경', async () => {
    await page.locator('#pinOld').fill('2580');
    await page.locator('#pinNew').fill('97531');
    await page.locator('#pinNew2').fill('97532');
    await page.locator('#btnPin').click();
    await expect(page.locator('#pinState')).toHaveText('새 PIN 확인이 일치하지 않아요.');
    await page.locator('#pinNew2').fill('97531');
    await page.locator('#pinNew').fill('97a');
    await page.locator('#btnPin').click();
    await expect(page.locator('#pinState')).toHaveText('새 PIN은 숫자 4~10자리로 입력해 주세요.');
    await page.locator('#pinNew').fill('97531');
    await page.locator('#pinOld').fill('0000');
    await page.locator('#btnPin').click();
    await expect(page.locator('#pinState')).toHaveText('지금 PIN이 맞지 않아요.');
    await page.locator('#pinOld').fill('2580');
    await page.locator('#btnPin').click();
    await expect(page.locator('#pinState')).toContainText('PIN을 바꿨어요');
    expect((await mockDb(page)).users[0].pin).toBe('97531');
  });

  await test.step('Esc로 패널 닫기 → 포커스 복귀, 도구 막대 공유 버튼', async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('#editPanel')).toBeHidden();
    await expect(page.locator('#btnEdit')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#btnEdit')).toBeFocused();
    await page.locator('#btnShare').click();
    await expect(page.locator('#toast')).toContainText('공유 링크를 복사했어요');
    await page.waitForTimeout(1500);
    await shot(page, '08-mine-filled');
  });

  await test.step('새로고침해도 로그인 유지 + 저장한 내용 그대로', async () => {
    await page.reload();
    await expect(page.locator('#btnEdit')).toBeVisible();
    await expect(page.locator('#title')).toHaveText('민수네 트리');
    await expect(page.locator('#srMessages li')).toHaveText(['메리 크리스마스!']);
    await page.locator('#btnEdit').click();
    await expect(page.getByRole('button', { name: '빛의 고리' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#edAutoRotate')).not.toBeChecked();
    await page.locator('#btnEditClose').click();
  });

  await test.step('로그아웃 → 새 PIN으로 다시 로그인', async () => {
    await page.locator('#btnEdit').click();
    await page.getByRole('tab', { name: '공유·계정' }).click();
    await page.locator('#btnLogout').click();
    await expect(page.locator('#loginCard')).toBeVisible();
    await expect(page.locator('#btnEdit')).toBeHidden();
    expect(await page.evaluate(k => localStorage.getItem(k), TOKEN_KEY)).toBeNull();
    expect(Object.keys((await mockDb(page)).sessions)).toHaveLength(0);

    await name.fill('김민수');
    await email.fill('minsu@example.com');
    await pin.fill('2580');                                   // 옛 PIN → 새 트리를 만들자고 하지 않고 PIN이 틀렸다고 안내
    await page.locator('#btnEnter').click();
    await expect(page.locator('#loginError')).toContainText('PIN이 맞지 않아요');
    await expect(page.locator('#loginError')).toContainText('PIN을 잊었어요');
    await expect(page.locator('#createConfirm')).toBeHidden();
    await pin.fill('97531');
    await pin.press('Enter');
    await expect(page.locator('#btnEdit')).toBeVisible();
    await expect(page.locator('#title')).toHaveText('민수네 트리');
    expect((await mockDb(page)).users).toHaveLength(1);
  });

  await test.step('공유 보기: 다른 브라우저(시크릿 창)에서 읽기 전용', async () => {
    const db = await mockDb(page);
    const ctx = await browser.newContext(test.info().project.use);
    const guest = await ctx.newPage();
    const errors = [];
    guest.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    db.sessions = {}; db.log = [];                             // 다른 브라우저 = 로그인 정보 없음
    await serverMode(guest, { seed: db });
    await guest.goto(shareUrl);
    await expect(guest.locator('#owner')).toHaveText('김민수님의 트리');
    await expect(guest.locator('#title')).toHaveText('민수네 트리');
    await expect(guest.locator('#btnMake')).toHaveText('✨ 나도 트리 만들기');
    await expect(guest.locator('#btnEdit')).toBeHidden();
    await expect(guest.locator('#btnShare')).toBeHidden();
    await expect(guest.locator('#loginCard')).toBeHidden();
    await expect(guest).toHaveTitle('김민수님의 트리 · Code Christmas Tree');
    await guest.waitForTimeout(4000);
    await guest.screenshot({ path: `test-results/screens/${test.info().project.name}-09-shared.png` });
    // 공유 보기에서는 쓰기 RPC를 부르지 않음
    const log = (await mockDb(guest)).log;
    expect(log.every(f => f === 'get_tree')).toBe(true);
    await guest.locator('#btnMake').click();
    await expect(guest.locator('#loginCard')).toBeVisible();
    expect(new URL(guest.url()).search).toBe('');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
