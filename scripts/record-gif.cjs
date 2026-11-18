/**
 * README용 데모 GIF 녹화 (docs/images/demo.gif)
 *
 *   npm run record:gif            (Playwright Chromium + Python Pillow 필요: pip install pillow)
 *
 * 실제 Supabase 대신 E2E와 같은 mock(tests/e2e/mock-supabase.js)으로 "내 트리" 화면을 띄우므로 운영 DB에는 아무것도 쓰지 않는다.
 * 장면: 글귀 타이핑 → 사진 반짝 등장 → 무늬 모핑 → 장식 탭에서 장식 달기 → 선물 상자 열기
 * 프레임은 CDP screencast로 받고(test-results/gif/frames), scripts/make-gif.py가 GIF로 묶는다.
 * 헤드리스 브라우저에는 마우스 커서가 안 보이므로 녹화 때만 가짜 커서를 그린다(앱 코드는 바꾸지 않음).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results', 'gif');
const FRAMES = path.join(OUT, 'frames');
const PORT = 8131;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { width: 1280, height: 800 };   // 짧은 변이 700px 미만이면 렌더러가 모바일로 판정(입자 수 감소 · hover 없음)하므로 데스크톱 크기로
const python = process.platform === 'win32' ? 'python' : 'python3';

const CONFIG_JS = 'window.TREE_CONFIG = { SUPABASE_URL: "https://mock-project.supabase.co", SUPABASE_KEY: "sb_publishable_mock_key" };';
const TOKEN_KEY = 'code-christmas-tree.token';
const USER_ID = '77777777-7777-4777-8777-777777777777';
/** mock DB 상태. 사진은 앱의 샘플 사진(data URL)을 Storage 파일처럼 objects에 넣어 실제 사진처럼 불러오게 한다 */
const makeSeed = samples => ({
  seq: 100,
  users: [{ id: USER_ID, name: '김하늘', email: 'haneul@example.com', pin: '1225', created_at: Date.now() }],
  trees: [{ id: USER_ID, owner: USER_ID, share_id: 'shareDEMO_01', title: '하늘이네 트리', pattern: 1,
            settings: { characters: false }, decorations: null, position: 0, created_at: Date.now() }],
  sessions: { demo: { user: USER_ID, exp: Date.now() + 1e9 } },
  attempts: [], tickets: [], views: [], log: [],
  objects: Object.fromEntries(samples.map((p, i) => [`${USER_ID}/sample${i}.jpg`, p.src])),
  photos: samples.map((p, i) => ({ id: i + 1, tree_id: USER_ID, path: `${USER_ID}/sample${i}.jpg`, caption: p.caption })),
  messages: [
    { id: 1, tree_id: USER_ID, body: '올 한 해도 정말 고생 많았어요 🎄', position: 0, created_at: Date.now() },
    { id: 2, tree_id: USER_ID, body: '따뜻하고 반짝이는 연말 보내세요 ✨', position: 1, created_at: Date.now() }
  ]
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 서버가 뜰 때까지 대기 (fetch(undici)는 python http.server의 연결 종료에서 assert로 죽는 경우가 있어 http 모듈 사용) */
const ping = () => new Promise(resolve => {
  http.get(BASE, res => { res.resume(); resolve(res.statusCode === 200); }).on('error', () => resolve(false));
});
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    if (await ping()) return;
    await sleep(200);
  }
  throw new Error('로컬 서버가 뜨지 않았습니다');
}

/** 녹화용 가짜 커서 + 누를 때 퍼지는 원 (CSP 때문에 style 속성 대신 CSSOM으로 설정) */
function installCursor() {
  const dot = document.createElement('div');
  const set = (el, css) => { for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v); };
  set(dot, { position: 'fixed', left: '0', top: '0', width: '18px', height: '18px', 'margin-left': '-9px', 'margin-top': '-9px',
    'border-radius': '50%', background: 'rgba(255,255,255,.85)', 'box-shadow': '0 0 0 2px rgba(0,0,0,.35), 0 0 14px rgba(255,240,200,.9)',
    'pointer-events': 'none', 'z-index': '2147483647', transition: 'transform .12s', opacity: '0' });
  const attach = () => document.documentElement.append(dot);
  if (document.documentElement) attach(); else addEventListener('DOMContentLoaded', attach, { once: true });
  addEventListener('mousemove', e => { set(dot, { transform: `translate(${e.clientX}px, ${e.clientY}px)`, opacity: '1' }); }, true);
  addEventListener('mousedown', e => {
    const ring = document.createElement('div');
    set(ring, { position: 'fixed', left: `${e.clientX - 22}px`, top: `${e.clientY - 22}px`, width: '44px', height: '44px',
      'border-radius': '50%', border: '3px solid rgba(255,230,160,.95)', 'pointer-events': 'none', 'z-index': '2147483646',
      transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.3)', opacity: '1' });
    document.documentElement.append(ring);
    requestAnimationFrame(() => requestAnimationFrame(() => set(ring, { transform: 'scale(1.4)', opacity: '0' })));
    setTimeout(() => ring.remove(), 600);
  }, true);
}

/** 마우스를 부드럽게 옮기기 (녹화에 이동 경로가 보이게) */
async function glide(page, from, to, ms = 500) {
  const steps = Math.max(2, Math.round(ms / 33));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
  return to;
}
/**
 * 캔버스의 그 자리를 누르되, 떨어지는 사진이 마침 그 위를 지나면 사진 확대 보기가 열리므로
 * 캔버스가 원하는 상태(want: 'pointing' 선물 · 'placing' 장식 달 자리)이고 사진 위(hovering)가 아닐 때까지 기다렸다가 누른다
 */
async function clickCanvasWhen(page, pt, want) {
  for (let i = 0; i < 80; i++) {
    await page.mouse.move(pt.x + (i % 2), pt.y);   // 상태 클래스는 pointermove 때 갱신됨
    const ok = await page.evaluate(w => { const c = document.querySelector('canvas').classList; return c.contains(w) && !c.contains('hovering'); }, want);
    if (ok) break;
    await sleep(50);
  }
  await page.mouse.down(); await page.mouse.up();
}
const center = async loc => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const server = spawn(python, [path.join('scripts', 'serve.py'), String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    // 녹화용 사진을 캔버스 도형으로 그려 data URL로 받아 둔다.
    //  - 앱의 샘플 사진에는 "샘플" 안내 글이 있어서 따로 그림
    //  - 이모지를 크게 그리면 녹화한 PC의 이모지 글꼴(제3자 저작물)이 GIF에 박히므로 도형만 씀
    const boot = await browser.newPage();
    await boot.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await boot.goto(BASE);
    const samples = await boot.evaluate(() => {
      const circle = (g, x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
      const draw = {
        snowman(g, w, h) {
          circle(g, w / 2, h * .66, h * .2, '#f4f6fb'); circle(g, w / 2, h * .38, h * .13, '#f4f6fb');
          g.fillStyle = '#c8384a'; g.fillRect(w / 2 - h * .14, h * .47, h * .28, h * .05);           // 목도리
          circle(g, w / 2 - h * .045, h * .35, h * .015, '#222'); circle(g, w / 2 + h * .045, h * .35, h * .015, '#222');
          g.fillStyle = '#f08a2c'; g.beginPath();                                                     // 당근 코
          g.moveTo(w / 2, h * .38); g.lineTo(w / 2 + h * .09, h * .4); g.lineTo(w / 2, h * .41); g.fill();
          for (const k of [0, 1, 2]) circle(g, w / 2, h * (.6 + k * .06), h * .014, '#2a2a3a');
        },
        gift(g, w, h) {
          const bw = w * .5, bh = h * .38, x = (w - bw) / 2, y = h * .42;
          g.fillStyle = '#2f9a62'; g.fillRect(x, y, bw, bh);
          g.fillStyle = '#278a55'; g.fillRect(x - bw * .05, y - h * .07, bw * 1.1, h * .08);          // 뚜껑
          g.fillStyle = '#f2c14e'; g.fillRect(w / 2 - bw * .07, y - h * .07, bw * .14, bh + h * .07);  // 리본
          for (const s of [-1, 1]) { g.beginPath(); g.ellipse(w / 2 + s * bw * .14, y - h * .1, bw * .14, h * .05, s * .5, 0, Math.PI * 2); g.fill(); }
        },
        candle(g, w, h) {
          const glow = g.createRadialGradient(w / 2, h * .3, 4, w / 2, h * .3, h * .35);
          glow.addColorStop(0, 'rgba(255,220,140,.75)'); glow.addColorStop(1, 'rgba(255,220,140,0)');
          g.fillStyle = glow; g.fillRect(0, 0, w, h);
          g.fillStyle = '#f3e7d0'; g.fillRect(w / 2 - w * .08, h * .4, w * .16, h * .42);
          g.fillStyle = '#ffd36a'; g.beginPath(); g.ellipse(w / 2, h * .33, w * .035, h * .07, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fff6d8'; g.beginPath(); g.ellipse(w / 2, h * .35, w * .015, h * .035, 0, 0, Math.PI * 2); g.fill();
        }
      };
      return [
        ['snowman', '#1d3a6e', '#6a9ae0', '첫눈 온 날', 640, 480],
        ['gift', '#6e1d2a', '#e07080', '선물 포장', 480, 600],
        ['candle', '#3a2a12', '#a8763c', '따뜻한 저녁', 560, 560]
      ].map(([kind, c1, c2, caption, w, h]) => {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, c1); bg.addColorStop(1, c2);
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {   // 보케(흐린 빛망울)
          g.globalAlpha = .08 + Math.random() * .18;
          circle(g, Math.random() * w, Math.random() * h, 8 + Math.random() * 40, '#fff');
        }
        g.globalAlpha = 1;
        draw[kind](g, w, h);
        return { src: cv.toDataURL('image/jpeg', .88), caption };
      });
    });
    await boot.close();

    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG_JS }));
    await ctx.addInitScript(([seed, key]) => {
      window.__TREE_DEBUG__ = true;
      localStorage.setItem('__mockdb', seed);
      localStorage.setItem(key, 'demo');
    }, [JSON.stringify(makeSeed(samples)), TOKEN_KEY]);
    await ctx.addInitScript({ path: path.join(ROOT, 'tests', 'e2e', 'mock-supabase.js') });
    await ctx.addInitScript(installCursor);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE);
    await page.locator('#btnEdit').waitFor({ state: 'visible' });
    await sleep(2500);   // 트리가 모이는 첫 장면은 녹화에서 빼고, 모인 뒤부터 녹화

    // ── 녹화 시작 (CDP screencast: 프레임마다 브라우저 시각이 함께 옴) ──
    const cdp = await ctx.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', async f => {
      const file = `${String(frames.length).padStart(4, '0')}.jpg`;
      fs.writeFileSync(path.join(FRAMES, file), Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });

    let mouse = { x: VIEW.width * .78, y: VIEW.height * .55 };
    await page.mouse.move(mouse.x, mouse.y);

    // ① 글귀 타이핑 + 사진이 반짝이며 등장 (트리에 올린 사진이 차례로)
    await sleep(3200);

    // ② 무늬 바꾸기 → 입자가 다른 모양으로 모핑
    mouse = await glide(page, mouse, await center(page.locator('#btnPattern')), 450);
    await page.mouse.down(); await page.mouse.up();   // 실제 버튼 클릭 (커서 원이 보이게 마우스로)
    await sleep(2600);

    // ③ 꾸미기 → 장식 탭 → 별·금색 고르고 트리를 눌러 달기
    mouse = await glide(page, mouse, await center(page.locator('#btnEdit')), 400);
    await page.locator('#btnEdit').click();
    await sleep(300);
    mouse = await glide(page, mouse, await center(page.getByRole('tab', { name: '장식' })), 350);
    await page.getByRole('tab', { name: '장식' }).click();
    await sleep(700);   // 편집 모드: 자동 회전이 멈출 때까지
    // 트리 앞면의 빈 자리 화면 좌표 (임시로 달았다가 바로 뗌 — 화면 좌표가 계산되는 두 프레임 동안만 보여 GIF에서는 거의 안 보임)
    const spots = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 2; i++) {
        const before = window.__tree.decorations.length;
        window.__tree.addDecorAnywhere('star', 1);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const p = window.__tree.decorInfo().items[before];
        window.__tree.removeSelectedDecor();
        out.push({ x: p.x, y: p.y });
      }
      return out;
    });
    const picks = [['별 달기', '금색'], ['양말 달기', '파랑색']];
    for (let i = 0; i < picks.length; i++) {
      const [kind, color] = picks[i];
      mouse = await glide(page, mouse, await center(page.getByRole('button', { name: kind })), 350);
      await page.getByRole('button', { name: kind }).click();
      mouse = await glide(page, mouse, await center(page.getByRole('button', { name: color })), 250);
      await page.getByRole('button', { name: color }).click();
      mouse = await glide(page, mouse, spots[i], 400);
      await clickCanvasWhen(page, mouse, 'placing');
      await sleep(500);
    }

    // ④ 꾸미기 닫기 → 선물 상자 열기
    mouse = await glide(page, mouse, await center(page.locator('#btnEditClose')), 400);
    await page.locator('#btnEditClose').click();
    await sleep(600);
    const gift = await page.evaluate(() => window.__tree.decorInfo().gifts.filter(g => g.front).sort((a, b) => b.y - a.y)[0]);
    if (gift) {
      mouse = await glide(page, mouse, gift, 450);
      await clickCanvasWhen(page, mouse, 'pointing');
    }
    if (await page.evaluate(() => window.__tree.viewing)) throw new Error('선물 대신 사진이 눌렸습니다. 다시 녹화해 주세요');
    await sleep(2000);

    await cdp.send('Page.stopScreencast');
    await sleep(200);
    fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames));
    console.log(`프레임 ${frames.length}장, ${(frames.at(-1).t - frames[0].t).toFixed(1)}초`);
    if (errors.length) { console.error('Console 오류:', errors); process.exitCode = 1; }
  } finally {
    await browser.close();
    server.kill();
  }

  const r = spawnSync(python, [path.join(ROOT, 'scripts', 'make-gif.py'), OUT, path.join(ROOT, 'docs', 'images', 'demo.gif')], { stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = r.status || 1;
})().catch(e => { console.error(e); process.exit(1); });
