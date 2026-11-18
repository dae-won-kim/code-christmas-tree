/**
 * 배포 후 실제 사이트 + 실제 Supabase 점검 (장식 · 선물 · 사진 캡션 · 사진 삭제 · 공유 보기 · Console/CSP 오류)
 *
 *   PowerShell: $env:LIVE_CHECK_PIN = '<점검 계정 PIN>'; npm run check:live
 *   bash:       LIVE_CHECK_PIN=<점검 계정 PIN> npm run check:live
 *
 * ⚠ 운영 DB에 쓴다: 점검용 계정(없으면 새로 만듦)으로 장식을 바꾸고 사진 3장을 올렸다가 모두 지운다.
 *   끝나면 장식은 기본 장식으로 되돌린다. PIN은 공개 저장소에 적지 않도록 환경 변수로만 받는다.
 *   스크린샷: test-results/live/
 */
const path = require('path');
const fs = require('fs');
const out = path.resolve(__dirname, '..', 'test-results', 'live');
const { chromium } = require('@playwright/test');
const SITE = process.env.LIVE_CHECK_SITE || 'https://make-xmas-tree.com/';   // 운영 주소 (자체 도메인)
const USER = { name: process.env.LIVE_CHECK_NAME || '배포점검', email: process.env.LIVE_CHECK_EMAIL || 'deploy-check@example.com',
               pin: process.env.LIVE_CHECK_PIN };
if (!/^[0-9]{4,10}$/.test(USER.pin || '')) { console.error('LIVE_CHECK_PIN(숫자 4~10자리)을 환경 변수로 지정해 주세요.'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (ok, label, extra = '') => { results.push({ ok, label }); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? ' — ' + extra : '')); if (!ok) throw new Error(label); };
const nextFrame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

async function jpeg(page, color) {
  const b64 = await page.evaluate(c => {
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 600;
    const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 800, 600);
    g.fillStyle = '#fff'; g.font = '160px serif'; g.textAlign = 'center'; g.fillText('🎄', 400, 360);
    return cv.toDataURL('image/jpeg', .9).split(',')[1];
  }, color);
  return { name: `check-${color.slice(1)}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { window.__TREE_DEBUG__ = true; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  try {
    // ── 로그인 (없으면 새로 만들기) ──
    await page.goto(SITE);
    await page.locator('#inName').waitFor();
    await page.locator('#inName').fill(USER.name);
    await page.locator('#inPin').fill(USER.pin);
    await page.locator('#inEmail').fill(USER.email);
    await page.locator('#btnEnter').click();
    const created = await Promise.race([
      page.locator('#btnCreate').waitFor({ state: 'visible', timeout: 15000 }).then(() => true),
      page.locator('#btnEdit').waitFor({ state: 'visible', timeout: 15000 }).then(() => false)
    ]);
    if (created) await page.locator('#btnCreate').click();
    await page.locator('#btnEdit').waitFor({ state: 'visible', timeout: 20000 });
    check(true, `로그인 (${created ? '새 트리 생성' : '기존 점검 계정'})`);

    // ── 장식: 기본 장식 · 선물 ──
    await page.waitForTimeout(3500);
    let info = await page.evaluate(() => window.__tree.decorInfo());
    check(info.items.length > 0 && info.gifts.length === 7, '장식·선물 상자 표시', `장식 ${info.items.length}개, 선물 ${info.gifts.length}개`);
    await page.screenshot({ path: path.join(out, '1-mine.png') });

    // ── 장식 탭: 모두 떼기 → 달기 → 끌어 옮기기 → 끌어내 떼기 → 저장 ──
    await page.locator('#btnEdit').click();
    await page.getByRole('tab', { name: '장식' }).click();
    await page.waitForTimeout(900);
    await page.locator('#btnDecorClear').click(); await page.locator('#btnDecorClear').click();
    await page.locator('#decorTotal').filter({ hasText: '0/60' }).waitFor();
    await page.getByRole('button', { name: '양말 달기' }).click();
    await page.getByRole('button', { name: '파랑색' }).click();
    await page.locator('#btnDecorAdd').click();
    await page.getByRole('button', { name: '별 달기' }).click();
    await page.getByRole('button', { name: '금색', exact: true }).click();
    await page.locator('#btnDecorAdd').click();
    await page.getByRole('button', { name: '종 달기' }).click();
    await page.locator('#btnDecorAdd').click();
    await page.locator('#decorTotal').filter({ hasText: '3/60' }).waitFor();
    await nextFrame(page);
    // 끌어 옮기기
    let p0 = (await page.evaluate(() => window.__tree.decorInfo())).items[0];
    const t0 = p0.t;
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(p0.x, p0.y - k * 12);
    await page.mouse.up();
    const t1 = (await page.evaluate(() => window.__tree.decorations))[0].t;
    check(t1 < t0 - 0.03, '장식 끌어서 옮기기', `높이 ${t0} → ${t1}`);
    // 끌어내 떼기 (세 번째 장식)
    await nextFrame(page);
    const p2 = (await page.evaluate(() => window.__tree.decorInfo())).items[2];
    await page.mouse.move(p2.x, p2.y); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(p2.x + (20 - p2.x) * k / 8, p2.y + (90 - p2.y) * k / 8);
    await page.mouse.up();
    await page.locator('#decorTotal').filter({ hasText: '2/60' }).waitFor();
    check(true, '트리 밖으로 끌어내 떼기');
    await page.locator('#saveState').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(out, '2-decor-tab.png') });
    const savedDecor = await page.evaluate(() => window.__tree.decorations);
    check(JSON.stringify(savedDecor.map(o => [o.k, o.c])) === JSON.stringify([['sock', 2], ['star', 1]]), '고른 색이 각 장식에 맞게 저장 (양말 파랑 · 별 금색)', savedDecor.map(o => `${o.k}(${o.c})`).join(', '));

    // ── 선물 상자 끄고 켜기 (설정 저장) ──
    await page.locator('#edGifts').uncheck();
    await page.locator('#saveState').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
    check((await page.evaluate(() => window.__tree.decorInfo())).gifts.length === 0, '선물 상자 끄기');

    // ── 새로고침해도 장식·설정 유지 (실제 DB) ──
    await page.reload();
    await page.locator('#btnEdit').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(3000);
    info = await page.evaluate(() => window.__tree.decorInfo());
    check(JSON.stringify(info.items.map(o => [o.k, o.c, o.t, o.a])) === JSON.stringify(savedDecor.map(o => [o.k, o.c, o.t, o.a])) && !info.isDefault,
          '새로고침 후 장식 위치·종류·색 그대로', info.items.map(o => `${o.k}(${o.c})`).join(', '));
    check(info.gifts.length === 0, '새로고침 후 선물 끄기 설정 유지');
    await page.locator('#btnEdit').click();
    await page.getByRole('tab', { name: '장식' }).click();
    await page.locator('#edGifts').check();
    await page.locator('#saveState').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });

    // ── 사진: 3장 올리기 → 캡션 고치기 → 새로고침 확인 → 2장 골라 삭제 → 나머지 삭제 ──
    await page.getByRole('tab', { name: '사진' }).click();
    await page.locator('#edCaption').fill('배포 점검');
    await page.locator('#photoInput').setInputFiles([await jpeg(page, '#3a6ea5'), await jpeg(page, '#a53a4a'), await jpeg(page, '#3aa56a')]);
    await page.locator('#uploadState').filter({ hasText: '3장을 올렸어요' }).waitFor({ timeout: 60000 });
    check((await page.locator('#photoGrid li').count()) === 3, '사진 3장 업로드 (실제 Storage)');
    const caps = page.locator('#photoGrid input.cap-input');
    await caps.nth(1).fill('고친 캡션 ✨');
    await caps.nth(1).press('Enter');
    await page.locator('#photoGrid input.cap-input.saved').first().waitFor({ timeout: 10000 });
    check(true, '캡션 고치기 저장');
    await page.screenshot({ path: path.join(out, '3-photos.png') });
    await page.reload();
    await page.locator('#btnEdit').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#btnEdit').click();
    await page.getByRole('tab', { name: '사진' }).click();
    await page.locator('#photoGrid li').nth(2).waitFor();
    const vals = await page.locator('#photoGrid input.cap-input').evaluateAll(els => els.map(e => e.value));
    check(JSON.stringify(vals) === JSON.stringify(['배포 점검', '고친 캡션 ✨', '배포 점검']), '새로고침 후 고친 캡션 유지', vals.join(' | '));

    // 공유 보기 (다른 브라우저 = 로그인 없음): 장식·사진 캡션이 보이는지
    const shareUrl = await page.locator('#shareUrl').inputValue();
    const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await guest.addInitScript(() => { window.__TREE_DEBUG__ = true; });
    const gp = await guest.newPage();
    const gErrors = [];
    gp.on('console', m => { if (m.type() === 'error') gErrors.push(m.text()); });
    await gp.goto(shareUrl);
    await gp.locator('#btnSave').waitFor({ state: 'visible', timeout: 20000 });
    await gp.waitForTimeout(3500);
    const gi = await gp.evaluate(() => window.__tree.decorInfo());
    check(gi.items.map(o => o.k).join() === savedDecor.map(o => o.k).join() && gi.gifts.length === 7, '공유 보기(로그인 없음)에서 장식·선물 보임');
    const g = gi.gifts.filter(x => x.front).sort((a, b) => b.y - a.y)[0];
    await gp.mouse.click(g.x, g.y);
    await gp.waitForTimeout(200);
    check((await gp.evaluate(() => window.__tree.decorInfo())).gifts.some(x => x.open), '공유 보기에서 선물 상자 누르면 열림');
    await gp.screenshot({ path: path.join(out, '4-shared-mobile.png') });
    check(gErrors.length === 0, '공유 보기 Console 오류·CSP 위반 없음', gErrors.join(' / '));
    await guest.close();

    // 2장 골라 삭제 → 남은 1장도 삭제 (실제 Storage 삭제 정책)
    const picks = page.locator('#photoGrid input.pick');
    await picks.nth(0).check(); await picks.nth(2).check();
    await page.locator('#btnPhotoDeleteSel').click(); await page.locator('#btnPhotoDeleteSel').click();
    await page.locator('#uploadState').filter({ hasText: '사진 2장을 삭제했어요' }).waitFor({ timeout: 30000 });
    check((await page.locator('#photoGrid li').count()) === 1, '사진 2장 골라 삭제');
    await page.locator('#photoSelectAll').check();
    await page.locator('#btnPhotoDeleteSel').click(); await page.locator('#btnPhotoDeleteSel').click();
    await page.locator('#photoEmpty').waitFor({ state: 'visible', timeout: 30000 });
    check(true, '남은 사진 삭제 → 사진 0장');
    await page.reload();
    await page.locator('#btnEdit').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('#btnEdit').click();
    await page.getByRole('tab', { name: '사진' }).click();
    await page.locator('#photoEmpty').waitFor({ state: 'visible', timeout: 15000 });
    check(true, '새로고침 후에도 사진 0장 (DB·Storage 모두 삭제)');

    // 정리: 장식은 기본 장식으로 되돌림
    await page.getByRole('tab', { name: '장식' }).click();
    await page.locator('#btnDecorReset').click();
    await page.locator('#saveState').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
    await page.locator('#btnEditClose').click();
    check(errors.length === 0, '내 트리 Console 오류·CSP 위반 없음', errors.join(' / '));
  } catch (e) {
    console.log('ERROR', e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(out, 'error.png') }).catch(() => {});
    if (errors.length) console.log('console errors:', errors.join(' / '));
  }
  await browser.close();
  const bad = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} 통과`);
  process.exit(bad || results.length < 18 ? 1 : 0);
})();
