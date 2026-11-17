// 트리 장식(달기·옮기기·떼기·저장) · 선물 상자 · 사진 캡션 고치기 · 사진 여러 장 삭제
import { test, expect, serverMode, seedDb, sampleUser, mockDb, shot, makeJpeg } from './helpers.js';

const jiwoo = sampleUser({ id: '55555555-5555-4555-8555-555555555555', name: '박지우', email: 'jiwoo@example.com', pin: '2468',
                           share_id: 'shareJIW_000', title: '지우네 트리', pattern: 1 });
const session = { deco: { user: jiwoo.id, exp: Date.now() + 1e9 } };
const info = page => page.evaluate(() => window.__tree.decorInfo());

const capValues = page => page.locator('#photoGrid input.cap-input').evaluateAll(els => els.map(e => e.value));

async function openMine(page, seed = {}) {
  await page.addInitScript(() => {
    window.__TREE_DEBUG__ = true;
    window.nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await serverMode(page, { seed: seedDb({ users: [{ ...jiwoo, ...seed }], sessions: session }), token: 'deco' });
  await page.goto('/');
  await expect(page.locator('#btnEdit')).toBeVisible();
}

test('장식: 기본 장식 → 탭에서 달기 · 끌어 옮기기 · 밖으로 끌어내 떼기 · 저장 · 공유 보기', async ({ page }) => {
  await openMine(page);
  // 손대지 않은 트리는 기본 장식 + 선물 상자
  await expect.poll(async () => (await info(page)).items.length).toBeGreaterThan(20);
  expect((await info(page)).isDefault).toBe(true);
  expect((await info(page)).gifts.length).toBeGreaterThan(3);

  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '장식' }).click();
  await expect(page.locator('#pane-decor')).toBeVisible();
  await expect(page.locator('#editPanel')).toHaveClass(/decor-mode/);
  await expect(page.locator('#decorTotal')).toContainText('기본 장식');
  await page.waitForTimeout(800);   // 편집 모드: 자동 회전이 멈출 때까지

  // ① 모두 떼기 (두 번 눌러 확인) → 빈 트리
  await page.locator('#btnDecorClear').click();
  await page.locator('#btnDecorClear').click();
  await expect(page.locator('#decorTotal')).toHaveText('0/60');
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations).toEqual([]);

  // ② 양말 + 파랑을 고르고 트리 가운데를 누르면 그 자리에 달림
  const box = await page.locator('canvas').boundingBox();
  const target = await page.evaluate(async () => {   // 트리 앞면의 빈 자리 화면 좌표 (임시로 달았다가 바로 뗌)
    const before = window.__tree.decorations.length;
    window.__tree.addDecorAnywhere('star', 1);               // 좌표 계산용 임시 장식
    await nextFrame();                                       // 화면 좌표는 다음 프레임에 계산됨
    const p = window.__tree.decorInfo().items[before];
    window.__tree.removeSelectedDecor();
    return { x: p.x, y: p.y };
  });
  expect(target.x).toBeGreaterThan(box.x); expect(target.y).toBeGreaterThan(box.y);
  // (장식을 고르면 색 버튼이 그 장식의 색을 따라가므로, 종류·색은 임시 장식을 뗀 뒤에 고름)
  await page.getByRole('button', { name: '양말 달기' }).click();
  await page.getByRole('button', { name: '파랑색' }).click();
  await expect(page.getByRole('button', { name: '양말 달기' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '파랑색' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(target.x, target.y);
  await expect(page.locator('#decorTotal')).toHaveText('1/60');
  let items = (await info(page)).items;
  expect(items[0]).toMatchObject({ k: 'sock', c: 2, front: true });
  await expect(page.locator('#btnDecorRemove')).toBeEnabled();     // 방금 단 장식이 골라져 있음
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations?.length).toBe(1);

  // ③ 끌어서 옮기기: 높이(t)가 바뀌고 저장됨
  const before = (await mockDb(page)).trees[0].decorations[0];
  const p0 = (await info(page)).items[0];
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(p0.x, p0.y - k * 12);
  await page.mouse.up();
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations[0].t).toBeLessThan(before.t - 0.03);

  // ④ 아무 곳에 달기(키보드) → 2개, 고른 장식 떼기 → 1개
  await page.locator('#btnDecorAdd').click();
  await expect(page.locator('#decorTotal')).toHaveText('2/60');
  await page.locator('#btnDecorRemove').click();
  await expect(page.locator('#decorTotal')).toHaveText('1/60');

  // ⑤ 트리 밖으로 끌어내면 떼어짐
  const p1 = (await info(page)).items[0];
  await page.mouse.move(p1.x, p1.y);
  await page.mouse.down();
  const vp = page.viewportSize();
  for (let k = 1; k <= 8; k++) await page.mouse.move(p1.x + (12 - p1.x) * k / 8, p1.y + (vp.height * 0.08 - p1.y) * k / 8);
  await page.mouse.up();
  await expect(page.locator('#decorTotal')).toHaveText('0/60');
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations).toEqual([]);

  // ⑥ 다시 몇 개 달고 저장 → 새로고침해도 그대로 → 공유 보기에서도 보임
  await page.getByRole('button', { name: '종 달기' }).click();
  await page.locator('#btnDecorAdd').click();
  await page.getByRole('button', { name: '전구 달기' }).click();
  await page.locator('#btnDecorAdd').click();
  await expect(page.locator('#decorTotal')).toHaveText('2/60');
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations?.map(d => d.k)).toEqual(['bell', 'bulb']);
  await page.waitForTimeout(400);
  await shot(page, '20-decor-edit');

  await page.reload();
  await expect(page.locator('#btnEdit')).toBeVisible();
  await expect.poll(async () => (await info(page)).items.map(d => d.k)).toEqual(['bell', 'bulb']);
  expect((await info(page)).isDefault).toBe(false);

  await page.goto('/?t=' + jiwoo.share_id);                         // (내 트리의 공유 링크라 [담기]는 없음)
  await expect(page.locator('#title')).toHaveText('지우네 트리');
  await expect.poll(async () => (await info(page)).items.map(d => d.k)).toEqual(['bell', 'bulb']);

  // ⑦ 기본 장식으로 되돌리기 → DB는 null
  await page.goto('/');
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '장식' }).click();
  await page.locator('#btnDecorReset').click();
  await expect(page.locator('#decorTotal')).toContainText('기본 장식');
  await expect.poll(async () => (await mockDb(page)).trees[0].decorations).toBeNull();

  // 장식 탭을 벗어나면 편집 모드도 끝남
  await page.getByRole('tab', { name: '기본' }).click();
  await expect(page.locator('#editPanel')).not.toHaveClass(/decor-mode/);
});

test('선물 상자: 누르면 열리고, 설정에서 끄면 사라짐 · 장식을 눌러도 반응', async ({ page }) => {
  await openMine(page);
  await expect.poll(async () => (await info(page)).gifts.length).toBeGreaterThan(3);
  const g = (await info(page)).gifts.filter(x => x.front).sort((a, b) => b.y - a.y)[0];
  await page.mouse.click(g.x, g.y);
  await expect.poll(async () => (await info(page)).gifts.some(x => x.open)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, '21-gift-open');

  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '장식' }).click();
  await page.locator('#edGifts').uncheck();
  await expect.poll(async () => (await info(page)).gifts.length).toBe(0);
  await expect.poll(async () => (await mockDb(page)).trees[0].settings.gifts).toBe(false);
});

test('사진: 사진마다 캡션 고치기 · 여러 장 골라 삭제', async ({ page }) => {
  await openMine(page);
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '사진' }).click();
  await expect(page.locator('#photoTools')).toBeHidden();       // 사진이 없으면 선택 도구 숨김
  await page.locator('#edCaption').fill('함께');
  await page.locator('#photoInput').setInputFiles([
    await makeJpeg(page, 'a.jpg'), await makeJpeg(page, 'b.jpg', { color: '#a53a4a' }), await makeJpeg(page, 'c.jpg', { color: '#3aa56a' })
  ]);
  await expect(page.locator('#uploadState')).toContainText('사진마다 캡션을 고칠 수 있어요', { timeout: 20000 });
  await expect(page.locator('#photoGrid li')).toHaveCount(3);
  expect(await capValues(page)).toEqual(['함께', '함께', '함께']);

  // 캡션 고치기: Enter로 확정 → 저장, 다른 사진은 그대로
  const caps = page.locator('#photoGrid input.cap-input');
  await caps.nth(1).fill('둘째 사진 <b>굵게</b>');
  await caps.nth(1).press('Enter');
  await expect(caps.nth(1)).toHaveClass(/saved/);
  await expect.poll(async () => (await mockDb(page)).photos.map(p => p.caption)).toEqual(['함께', '둘째 사진 <b>굵게</b>', '함께']);
  expect(await page.evaluate(() => window.__mock.db().log.filter(f => f === 'update_photo_caption').length)).toBe(1);

  // 입력을 멈추면 자동 저장 (칸을 벗어나지 않아도)
  await caps.nth(2).fill('');
  await expect.poll(async () => (await mockDb(page)).photos[2].caption, { timeout: 5000 }).toBe('');

  // 바뀌지 않았으면 저장 요청을 보내지 않음
  await caps.nth(0).focus(); await caps.nth(0).blur();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__mock.db().log.filter(f => f === 'update_photo_caption').length)).toBe(2);

  // 새로고침해도 고친 캡션
  await page.reload();
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '사진' }).click();
  await expect(page.locator('#photoGrid li')).toHaveCount(3);
  expect(await capValues(page)).toEqual(['함께', '둘째 사진 <b>굵게</b>', '']);
  await shot(page, '22-photo-captions');

  // 여러 장 선택 → 삭제 (두 번 눌러 확인)
  const picks = page.locator('#photoGrid input.pick');
  await picks.nth(0).check();
  await picks.nth(2).check();
  await expect(page.locator('#photoTotal')).toHaveText('3/30 · 2장 선택');
  const delSel = page.locator('#btnPhotoDeleteSel');
  await delSel.click();
  await expect(delSel).toHaveText('정말 삭제할까요?');
  await delSel.click();
  await expect(page.locator('#uploadState')).toHaveText('사진 2장을 삭제했어요.');
  await expect(page.locator('#photoGrid li')).toHaveCount(1);
  let db = await mockDb(page);
  expect(db.photos.map(p => p.caption)).toEqual(['둘째 사진 <b>굵게</b>']);
  expect(Object.keys(db.objects)).toHaveLength(1);                // Storage 파일도 지워짐

  // 모두 선택 → 삭제 → 빈 목록
  await page.locator('#photoSelectAll').check();
  await expect(page.locator('#photoTotal')).toHaveText('1/30 · 1장 선택');
  await delSel.click(); await delSel.click();
  await expect(page.locator('#photoEmpty')).toBeVisible();
  db = await mockDb(page);
  expect(db.photos).toHaveLength(0);
  expect(Object.keys(db.objects)).toHaveLength(0);
});

test('캡션 저장 실패 · 31자 · 장식 저장 실패는 메시지로 알림', async ({ page }) => {
  await openMine(page);
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '사진' }).click();
  await page.locator('#photoInput').setInputFiles([await makeJpeg(page, 'a.jpg')]);
  await expect(page.locator('#photoGrid li')).toHaveCount(1, { timeout: 15000 });
  const cap = page.locator('#photoGrid input.cap-input').first();
  await page.evaluate(() => { window.__mock.fail = { fn: 'update_photo_caption', error: 'network' }; });
  await cap.fill('저장 안 될 캡션');
  await cap.press('Enter');
  await expect(cap).toHaveClass(/bad/);
  await expect(page.locator('#uploadState')).toContainText('네트워크 연결을 확인해 주세요');

  await page.getByRole('tab', { name: '장식' }).click();
  await page.evaluate(() => { window.__mock.fail = { fn: 'set_decorations', error: 'network' }; });
  await page.locator('#btnDecorAdd').click();
  await expect(page.locator('#decorState')).toContainText('장식을 저장하지 못했어요', { timeout: 5000 });
});
