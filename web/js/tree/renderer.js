/**
 * 트리 렌더러 — 캔버스·레이아웃·3D 투영·렌더 루프·별·눈·반짝이·드래그 회전
 *
 *   const tree = createTree(canvas, { title, messages, pattern, autoRotate, patternCycle });
 *   tree.setPattern(2); tree.setMessages(['...']); await tree.addPhoto(url, '캡션', { id: 3, show: 'sparkle' });
 *   tree.removePhoto(3); tree.setTitle('...'); tree.destroy();
 *
 * DOM 요소(제목·무늬 이름·글귀·확대 보기)는 options.elements로 바꿀 수 있고,
 * 기본값은 index.html의 id(#top, #title, #patternName, #message, #viewer, #card, #cardImg, #cardCap)이다.
 */
import { PATTERNS, buildTargets, TAU, TOP, TH, C, rnd, clamp01, easeInOut } from './patterns.js';
import { createPhotoStage } from './photos.js';
import { createViewer } from './viewer.js';
import { createTyper } from './messages.js';

const $ = id => document.getElementById(id);

export function createTree(canvas, options = {}) {
  const opt = {
    title: 'Merry Christmas',
    messages: [],
    pattern: 0,
    autoRotate: true,        // 자동 회전
    patternCycle: true,      // 무늬 자동 전환
    patternInterval: 12,     // 무늬 자동 전환 간격(초)
    morphDuration: 2.6,      // 무늬 전환 애니메이션 길이(초)
    photoInterval: 3.2,      // 사진 등장 간격(초)
    typingDelay: 3200,       // 첫 글귀가 나오기까지(ms) — 트리가 모이는 동안 기다림
    onPatternChange: null,   // (index) => void
    ...options
  };
  const el = {
    top: $('top'), title: $('title'), patternName: $('patternName'), message: $('message'),
    viewer: $('viewer'), card: $('card'), cardImg: $('cardImg'), cardCap: $('cardCap'),
    ...(options.elements || {})
  };

  /* ---------- 기기 판별 & 캔버스 ---------- */
  const isMobile = Math.min(innerWidth, innerHeight) < 700 || matchMedia('(pointer: coarse)').matches;
  const N = isMobile ? 1500 : 2600;          // 트리 입자 수
  const SNOW = isMobile ? 90 : 160;
  const ctx = canvas.getContext('2d');
  const view = { W: 0, H: 0, scale: 1 };     // 사진·확대 보기 모듈과 공유
  let DPR, centerY;

  /* 상단 제목과 하단 글귀 사이의 빈 공간에 트리가 꽉 차도록 배율 계산 */
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    const W = view.W = innerWidth, H = view.H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const top = el.top.getBoundingClientRect().bottom + 8;
    const bottom = el.message.getBoundingClientRect().top - 4;
    const availH = Math.max(160, bottom - top);
    // 트리의 월드 크기: 폭 ≈ 2R × 1.1(바닥 원반) × 1.1(원근), 높이 ≈ 별(-330) ~ 바닥(+315)
    view.scale = Math.min((W * 0.94) / (2 * 230 * 1.21), availH / 670);
    centerY = top + availH / 2 + 8 * view.scale;
  }
  el.title.textContent = opt.title;
  addEventListener('resize', layout);
  layout();

  /* ---------- 무늬 목표점 & 입자 상태 ---------- */
  const targets = buildTargets(N);
  const P = Array.from({ length: N }, () => {
    const a = rnd(0, TAU), r = rnd(200, 700);   // 시작: 바닥에 넓게 흩어져 있다가 모여듦
    return {
      x: Math.cos(a) * r, y: TOP + TH + 80, z: Math.sin(a) * r, c: [255, 255, 255], s: 1, d: 0,
      from: null, to: null, delay: 0, sx: 0, sy: 0, sz: 0,
      phase: rnd(0, TAU), tw: rnd(.5, 3)
    };
  });
  let current = -1, morphStart = 0, morphing = false, lastSwitch = 0;
  let bgFrom = [2, 3, 10], bgTo = PATTERNS[0].bg, currentBg = [2, 3, 10];
  let startPattern = Number.isInteger(opt.pattern) ? opt.pattern : 0;

  function setPattern(idx, now) {
    current = (idx + PATTERNS.length) % PATTERNS.length;
    const tg = targets[current], dur = opt.morphDuration;
    for (let i = 0; i < N; i++) {
      const p = P[i], t = tg[i];
      p.from = { x: p.x, y: p.y, z: p.z, c: p.c.slice(), s: p.s, d: p.d };
      p.to = t;
      p.delay = clamp01((t.y - TOP) / TH) * dur * 0.3 + rnd(0, dur * 0.15);  // 위에서 아래로 물결치듯
      const a = rnd(0, TAU), b = rnd(-1, 1), m = rnd(40, 140);              // 전환 중 흩어지는 방향
      p.sx = Math.cos(a) * m; p.sy = b * m * .6; p.sz = Math.sin(a) * m;
    }
    bgFrom = currentBg.slice(); bgTo = PATTERNS[current].bg;
    morphStart = now; morphing = true; lastSwitch = now;
    showPatternName(PATTERNS[current].name);
    opt.onPatternChange?.(current);
  }

  let pnTimer;
  function showPatternName(name) {
    el.patternName.textContent = '— ' + name + ' —';
    el.patternName.classList.add('show');
    clearTimeout(pnTimer);
    pnTimer = setTimeout(() => el.patternName.classList.remove('show'), 2800);
  }

  /* ---------- 눈 ---------- */
  const newFlake = anyY => ({ x: Math.random() * innerWidth, y: anyY ? Math.random() * innerHeight : -10,
                              r: rnd(.5, 2.2), vy: rnd(.3, 1.1), sway: rnd(0, TAU) });
  const snow = Array.from({ length: SNOW }, () => newFlake(true));

  /* ---------- 반짝이 입자(클릭 폭죽, 사진 등장/퇴장) ---------- */
  const sparks = [];
  function burst(x, y, n = 40, spread = 4) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = rnd(1, spread);
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1,
                    c: [C.gold, C.white, C.red, C.mint][(Math.random() * 4) | 0] });
    }
  }

  /* ---------- 사진 · 확대 보기 · 글귀 ---------- */
  const photos = createPhotoStage({ ctx, view, isMobile, burst });
  const viewer = createViewer(el, view);
  const typer = createTyper(el.message, { srList: el.srMessages, onFirstStart: () => { el.title.style.opacity = 1; } });
  let lastPhotoSpawn = 0;

  /* ---------- 회전(드래그) & 클릭 ---------- */
  let rotY = 0, rotX = 0.12, velY = 0.004, dragging = false, lastX = 0, lastY = 0, moved = 0;
  let AUTO = opt.autoRotate ? 0.004 : 0;
  const onDown = e => {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('dragging');
  };
  const onMove = e => {
    if (!dragging) {
      if (!isMobile) canvas.classList.toggle('hovering', !!photos.hit(e.clientX, e.clientY));
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    rotY += dx * 0.008; velY = dx * 0.0008;
    rotX = Math.max(-0.4, Math.min(0.5, rotX + dy * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = e => {
    if (!dragging) return;
    dragging = false; canvas.classList.remove('dragging');
    if (e.type === 'pointerup' && moved < 8) {
      const s = photos.hit(e.clientX, e.clientY);
      s ? viewer.open(s) : burst(e.clientX, e.clientY);
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);

  /* =========================================================
   *  렌더 루프
   * ========================================================= */
  let rafId = 0;
  function frame(ms) {
    const now = ms / 1000;
    const { W, H, scale } = view;
    if (current < 0) setPattern(startPattern, now);
    const viewing = viewer.viewing;

    // 무늬 자동 전환 (사진 확대 중엔 멈춤)
    if (opt.patternCycle && !viewing && !morphing && now - lastSwitch > opt.patternInterval) setPattern(current + 1, now);
    // 사진 등장
    if (!viewing && now - lastPhotoSpawn > opt.photoInterval) { lastPhotoSpawn = now; photos.spawn(now); }

    if (!dragging) { rotY += velY; velY += (AUTO - velY) * 0.02; }

    // 배경 (무늬마다 색조가 달라짐)
    const dur = opt.morphDuration;
    const g = easeInOut(clamp01((now - morphStart) / dur));
    currentBg = bgFrom.map((v, i) => v + (bgTo[i] - v) * g);
    const bg = ctx.createRadialGradient(W / 2, H * .6, 0, W / 2, H * .6, Math.max(W, H) * .8);
    bg.addColorStop(0, `rgb(${currentBg.map(Math.round).join(',')})`); bg.addColorStop(1, '#02030a');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 3D 투영 준비
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const FOCAL = 900, CAM = 900, cxs = W / 2;
    const project = (x, y, z) => {
      const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
      const y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      const k = FOCAL / (CAM + z2);
      return [cxs + x1 * k * scale, centerY + y1 * k * scale, k, z2];
    };

    // 트리 입자: 가산 혼합으로 빛 번짐
    ctx.globalCompositeOperation = 'lighter';
    let allDone = true;
    const span = dur * 0.55;   // 입자 하나가 이동하는 시간
    for (const p of P) {
      if (morphing) {
        const e = clamp01((now - morphStart - p.delay) / span);
        if (e < 1) allDone = false;
        const k = easeInOut(e), f = p.from, t = p.to, bump = Math.sin(Math.PI * k);
        p.x = f.x + (t.x - f.x) * k + p.sx * bump;
        p.y = f.y + (t.y - f.y) * k + p.sy * bump;
        p.z = f.z + (t.z - f.z) * k + p.sz * bump;
        p.c[0] = f.c[0] + (t.c[0] - f.c[0]) * k;
        p.c[1] = f.c[1] + (t.c[1] - f.c[1]) * k;
        p.c[2] = f.c[2] + (t.c[2] - f.c[2]) * k;
        p.s = f.s + (t.s - f.s) * k; p.d = f.d + (t.d - f.d) * k;
      }
      const [X, Y, k, z] = project(p.x, p.y, p.z);
      const depth = Math.max(.25, Math.min(1, 1.15 - z / 500));
      const a = depth * (.55 + .45 * Math.sin(now * p.tw + p.phase)) * p.d;
      if (a < .02) continue;
      const r = Math.max(.6, p.s * k * scale * 1.3);
      const col = `${p.c[0] | 0},${p.c[1] | 0},${p.c[2] | 0}`;
      ctx.fillStyle = `rgba(${col},${a * .18})`;
      ctx.beginPath(); ctx.arc(X, Y, r * 2.6, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(${col},${a})`;
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
    }
    if (morphing && allDone) morphing = false;

    // 꼭대기 별
    const starP = project(0, TOP - 22, 0);
    drawStar(starP[0], starP[1], starP[2], now);

    // 반짝이
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += .05; s.life -= .02;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${s.life})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, TAU); ctx.fill();
    }

    // 사진
    ctx.globalCompositeOperation = 'source-over';
    photos.step(now, viewing);

    // 눈
    ctx.fillStyle = '#fff';
    for (const f of snow) {
      f.y += f.vy; f.sway += .01; f.x += Math.sin(f.sway) * .3;
      if (f.y > H + 10) Object.assign(f, newFlake(false));
      ctx.globalAlpha = .3 + f.r / 3.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    rafId = requestAnimationFrame(frame);
  }

  function drawStar(x, y, k, time) {
    const Rr = 20 * k * view.scale, r = Rr * .45, pulse = 1 + .08 * Math.sin(time * 3) + (morphing ? .15 : 0);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, Rr * 4 * pulse);
    glow.addColorStop(0, 'rgba(255,230,150,0.9)'); glow.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, Rr * 4 * pulse, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * .5);
    ctx.fillStyle = '#fff3c4'; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = (i % 2 ? r : Rr) * pulse, a = i / 10 * TAU - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /* ---------- 시작 ---------- */
  const nowSec = () => performance.now() / 1000;
  const onFonts = () => layout();
  document.fonts && document.fonts.ready.then(onFonts);
  typer.set(opt.messages, opt.typingDelay);
  lastPhotoSpawn = nowSec();   // 트리가 모인 뒤부터 사진 등장
  rafId = requestAnimationFrame(frame);
  let destroyed = false;

  /* ---------- 공개 API ---------- */
  return {
    patterns: PATTERNS.map(p => p.name),
    get pattern() { return current < 0 ? startPattern : current; },
    get viewing() { return !!viewer.viewing; },
    get photoCount() { return photos.lib.length; },

    /** 무늬 바꾸기 (0~3, 범위를 넘으면 순환) */
    setPattern(i) {
      if (current < 0) { startPattern = ((i % PATTERNS.length) + PATTERNS.length) % PATTERNS.length; return; }
      setPattern(i, nowSec());
    },
    nextPattern() { this.setPattern(this.pattern + 1); },

    /** 글귀 목록 교체 → 처음부터 다시 타이핑 */
    setMessages(list) { typer.set(list, 0); },

    setTitle(text) { el.title.textContent = text; layout(); },

    /** { autoRotate, patternCycle } 중 넘긴 값만 바꾼다 */
    setSettings({ autoRotate, patternCycle } = {}) {
      if (typeof autoRotate === 'boolean') { opt.autoRotate = autoRotate; AUTO = autoRotate ? 0.004 : 0; }
      if (typeof patternCycle === 'boolean') { opt.patternCycle = patternCycle; lastSwitch = nowSec(); }
    },

    /**
     * 사진 추가. opts.id로 나중에 removePhoto(id) 가능.
     * opts.show: 'sparkle' | 'fall'이면 추가하자마자 그 연출로 등장. opts.sample: 샘플 사진 표시
     * @returns {Promise<object>} 이미지 로드 실패 시 reject
     */
    async addPhoto(src, caption = '', opts = {}) {
      const item = await photos.add(src, caption, opts);
      if (destroyed) return item;
      if (opts.show) photos.spawn(nowSec(), item, opts.show);
      return item;
    },
    removePhoto(id) {
      const item = photos.find(id);
      if (!item) return false;
      if (viewer.viewing?.item === item) viewer.closeNow();
      photos.removeItem(item);
      return true;
    },
    clearPhotos() { viewer.closeNow(); photos.clear(); },

    /** 레이아웃 다시 계산 (위·아래 UI 크기가 바뀌었을 때) */
    layout,

    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(pnTimer);
      typer.stop();
      viewer.destroy();
      removeEventListener('resize', layout);
      canvas.removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      canvas.classList.remove('dragging', 'hovering');
    }
  };
}
