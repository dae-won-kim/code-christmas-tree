// 내 트리 여러 개(최대 3개) · 산타·루돌프 · 무늬 8종
import { test, expect, serverMode, seedDb, sampleUser, mockDb, shot, makeJpeg } from './helpers.js';

const minsu = sampleUser({ id: '33333333-3333-4333-8333-333333333333', name: '김민수', birth: '990101', pw: 'Minsu#1357',
                           share_id: 'shareMIN_000', title: '민수네 트리', pattern: 0 });
const session = { cafe: { user: minsu.id, exp: Date.now() + 1e9 } };
const openLib = async page => {
  // 접히는 애니메이션 중에는 아직 보이므로, 상태는 aria-expanded로 판단
  if ((await page.locator('#btnLibrary').getAttribute('aria-expanded')) !== 'true') await page.locator('#btnLibrary').click();
  await expect(page.locator('#library')).toBeVisible();
};
const mineTitles = page => page.locator('#libMineList li .who').allTextContents();

test('내 트리 여러 개: 만들기(3개까지) · 이름 · 순서 · 전환 · 지우기', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [minsu], messages: [{ id: 1, user_id: minsu.id, body: '첫 트리 글귀' }], sessions: session }), token: 'cafe' });
  await page.goto('/');
  await expect(page.locator('#btnEdit')).toBeVisible();
  await openLib(page);
  await expect(page.locator('#libMine')).toBeVisible();
  await expect(page.locator('#libMineCount')).toHaveText('1/3');
  await expect(page.locator('#libMineList li a').first()).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: '트리 지우기: 민수네 트리' })).toBeDisabled();   // 마지막 1개는 못 지움

  // 새 트리 2개 → 3/3이면 더 못 만듦
  await page.locator('#libNewTree').click();
  await expect(page.locator('#title')).toHaveText('Merry Christmas');
  await expect(page.locator('#srMessages li')).toHaveCount(0);          // 새 트리는 글귀가 비어 있음
  await openLib(page);
  await expect(page.locator('#libMineCount')).toHaveText('2/3');
  await page.locator('#libNewTree').click();
  await openLib(page);
  await expect(page.locator('#libMineCount')).toHaveText('3/3');
  await expect(page.locator('#libNewTree')).toBeDisabled();
  await expect(page.locator('#libMineNote')).toContainText('3개까지');
  expect((await mockDb(page)).trees).toHaveLength(3);

  // 이름 바꾸기 (지금 편집 중인 3번째 트리) → 트리 제목도 바뀜
  const third = (await mockDb(page)).trees[2];
  await page.locator(`#libMineList li[data-id="${third.id}"]`).getByRole('button', { name: /이름 바꾸기/ }).click();
  const input = page.locator('#libMineList li.editing input');
  await expect(input).toBeFocused();
  await input.fill('셋째 트리');
  await input.press('Enter');
  await expect.poll(() => mineTitles(page)).toEqual(['민수네 트리', 'Merry Christmas', '셋째 트리']);
  await expect(page.locator('#title')).toHaveText('셋째 트리');
  expect((await mockDb(page)).trees.find(t => t.id === third.id).title).toBe('셋째 트리');

  // 순서 바꾸기: 셋째를 맨 위로
  await page.getByRole('button', { name: '위로: 셋째 트리' }).click();
  await page.getByRole('button', { name: '위로: 셋째 트리' }).click();
  await expect.poll(() => mineTitles(page)).toEqual(['셋째 트리', '민수네 트리', 'Merry Christmas']);
  expect((await mockDb(page)).trees.find(t => t.id === third.id).position).toBe(0);
  await expect(page.getByRole('button', { name: '위로: 셋째 트리' })).toBeDisabled();
  await page.waitForTimeout(300);
  await shot(page, '15-my-trees');

  // 전환: 첫 트리로 → 그 트리의 제목·글귀, 공유 링크는 트리마다 다름
  await page.locator('#libMineList a', { hasText: '민수네 트리' }).click();
  await expect(page.locator('#title')).toHaveText('민수네 트리');
  await expect(page.locator('#srMessages li')).toHaveText(['첫 트리 글귀']);
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '공유·계정' }).click();
  await expect(page.locator('#shareUrl')).toHaveValue(/\?t=shareMIN_000$/);
  await page.locator('#btnEditClose').click();

  // 다른 트리에 쓴 글귀는 그 트리에만
  await openLib(page);
  await page.locator('#libMineList a', { hasText: '셋째 트리' }).click();
  await expect(page.locator('#title')).toHaveText('셋째 트리');
  await page.locator('#btnEdit').click();
  await page.getByRole('tab', { name: '글귀' }).click();
  await page.locator('#edMsg').fill('셋째 트리 글귀');
  await page.locator('#edMsg').press('Enter');
  await expect(page.locator('#msgList li')).toHaveCount(1);
  const db = await mockDb(page);
  expect(db.messages.filter(m => m.tree_id === third.id).map(m => m.body)).toEqual(['셋째 트리 글귀']);
  expect(db.messages.filter(m => m.tree_id === minsu.id).map(m => m.body)).toEqual(['첫 트리 글귀']);
  // 사진도 이 트리에만
  await page.getByRole('tab', { name: '사진' }).click();
  await page.locator('#photoInput').setInputFiles([await makeJpeg(page, 'x.jpg')]);
  await expect(page.locator('#uploadState')).toHaveText('1장을 올렸어요.', { timeout: 15000 });
  expect((await mockDb(page)).photos.map(p => p.tree_id)).toEqual([third.id]);
  await page.locator('#btnEditClose').click();

  // 새로고침하면 마지막으로 편집한 트리가 열림
  await page.reload();
  await expect(page.locator('#title')).toHaveText('셋째 트리');

  // 지우기: 사진이 있는 트리는 안 됨, 빈 트리는 두 번 눌러 삭제
  await openLib(page);
  const delThird = page.getByRole('button', { name: '트리 지우기: 셋째 트리' });
  await delThird.click(); await delThird.click();
  await expect(page.locator('#libError')).toContainText('사진이 있는 트리는 지울 수 없어요');
  const delEmpty = page.getByRole('button', { name: '트리 지우기: Merry Christmas' });
  await delEmpty.click(); await delEmpty.click();
  await expect(page.locator('#libMineCount')).toHaveText('2/3');
  await expect(page.locator('#libNewTree')).toBeEnabled();
  expect((await mockDb(page)).trees.map(t => [t.title, t.position])).toEqual([['민수네 트리', 1], ['셋째 트리', 0]]);
});

test('내 트리 목록: 이름 바꾸기는 Esc로 취소, 빈 이름은 거부', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [minsu], sessions: session }), token: 'cafe' });
  await page.goto('/');
  await openLib(page);
  await page.getByRole('button', { name: '이름 바꾸기: 민수네 트리' }).click();
  await page.locator('#libMineList li.editing input').fill('바꾸다 만 이름');
  await page.keyboard.press('Escape');
  await expect.poll(() => mineTitles(page)).toEqual(['민수네 트리']);
  await expect(page.locator('#library')).toBeVisible();        // Esc는 이름 편집만 취소하고 서랍은 그대로
  await page.getByRole('button', { name: '이름 바꾸기: 민수네 트리' }).click();
  await page.locator('#libMineList li.editing input').fill('   ');
  await page.locator('#libMineList li.editing input').press('Enter');
  await expect(page.locator('#libError')).toContainText('1~30자');
  expect((await mockDb(page)).trees[0].title).toBe('민수네 트리');
});

test('산타·루돌프: 누르면 반응, 꾸미기에서 끄면 사라짐', async ({ page }) => {
  await page.addInitScript(() => { window.__TREE_DEBUG__ = true; });
  await serverMode(page, { seed: seedDb({ users: [minsu], sessions: session }), token: 'cafe' });
  await page.goto('/');
  await expect(page.locator('#btnEdit')).toBeVisible();
  await page.waitForTimeout(800);
  const info = () => page.evaluate(() => window.__tree.characterInfo());
  expect((await info()).map(c => c.kind)).toEqual(['santa', 'rudolph']);
  // 캐릭터가 버튼·글귀 같은 화면 요소 밑을 지나는 순간에는 그 요소가 눌리므로, 캔버스 위에 있을 때 누른다
  const clickable = kind => page.evaluate(k => {
    const c = window.__tree.characterInfo().find(x => x.kind === k);
    const el = document.elementFromPoint(c.x, c.y);
    return el && el.id === 'c' ? { x: c.x, y: c.y } : null;
  }, kind);
  const clickCharacter = async kind => {
    let at = null;
    await expect.poll(async () => (at = await clickable(kind)), { timeout: 20000 }).not.toBeNull();
    await page.mouse.click(at.x, at.y);
  };

  for (const kind of ['santa', 'rudolph']) {
    await clickCharacter(kind);
    await expect.poll(async () => (await info()).find(x => x.kind === kind).reacting).toBe(true);
    expect((await info()).find(x => x.kind === kind).bubble).toBeTruthy();
  }
  await shot(page, '16-characters');

  // 꾸미기 → 산타·루돌프 끄기 → 저장, 눌러도 반응 없음
  await page.locator('#btnEdit').click();
  await page.locator('#edCharacters').uncheck();
  await expect(page.locator('#saveState')).toHaveText('저장됨', { timeout: 5000 });
  expect((await mockDb(page)).trees[0].settings.characters).toBe(false);
  await page.locator('#btnEditClose').click();
  await page.waitForTimeout(1800);                                  // 앞선 반응이 끝나길 기다림
  await clickCharacter('santa');
  await page.waitForTimeout(200);
  expect((await info()).find(x => x.kind === 'santa').reacting).toBe(false);
});

test('무늬 8종 · 자동 전환 1분', async ({ page }) => {
  await serverMode(page, { seed: seedDb({ users: [minsu], sessions: session }), token: 'cafe' });
  await page.goto('/');
  await page.locator('#btnEdit').click();
  const choices = page.locator('#patternChoices button');
  await expect(choices).toHaveText(['나선 리본', '층층 전나무', '빛의 고리', '얼음 크리스탈', '은하수 소용돌이', '캔디 스트라이프', '눈꽃 결정층', '금빛 가랜드']);
  await expect(page.locator('label.check', { hasText: '무늬 자동 전환' })).toContainText('1분마다');
  await page.getByRole('button', { name: '금빛 가랜드' }).click();
  await expect(page.locator('#saveState')).toHaveText('저장됨', { timeout: 5000 });
  expect((await mockDb(page)).trees[0].pattern).toBe(7);
  await expect(page.locator('#patternName')).toHaveText('— 금빛 가랜드 —');
});
