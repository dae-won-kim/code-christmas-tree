/**
 * 트리 렌더러 — 캔버스·레이아웃·3D 투영·렌더 루프·별·눈·반짝이·드래그 회전
 *
 *   const tree = createTree(canvas, { title, messages, pattern, autoRotate, patternCycle });
 *   tree.setPattern(2); tree.setMessages(['...']); await tree.addPhoto(url, '캡션', { id: 3, show: 'sparkle' });
 *   tree.removePhoto(3); tree.setTitle('...'); tree.destroy();
 *   tree.setDecorations([{ k: 'sock', t: .6, a: .25, c: 0 }]);  // 장식 (null이면 기본 장식)
 *   tree.setDecorEditing({ kind: 'bell', color: 1, onChange: list => save(list) });   // 트리를 눌러 달기·끌어 옮기기
 *
 * DOM 요소(제목·무늬 이름·글귀·확대 보기)는 options.elements로 바꿀 수 있고,
 * 기본값은 index.html의 id(#top, #title, #patternName, #message, #viewer, #card, #cardImg, #cardCap)이다.
 */
import { PATTERNS, buildTargets, TAU, TOP, TH, C, rnd, clamp01, easeInOut } from './patterns.js';
import { createPhotoStage } from './photos.js';
import { createViewer } from './viewer.js';
import { createTyper } from './messages.js';
import { createCharacters } from './characters.js';
import { createDecor, MAX_DECOR } from './decor.js';

const $ = id => document.getElementById(id);

export function createTree(canvas, options = {}) {
  const opt = {
    title: 'Merry Christmas',
    messages: [],
    pattern: 0,
    autoRotate: true,        // 자동 회전
    patternCycle: true,      // 무늬 자동 전환
    characters: true,        // 배경에 산타·루돌프
    gifts: true,             // 트리 아래 선물 상자
    decorations: null,       // 장식 목록 (null이면 기본 장식)
    patternInterval: 60,     // 무늬 자동 전환 간격(초)
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
  const SNOW = isMobile ? 170 : 300;         // 눈송이 수
  const ctx = canvas.getContext('2d');
  const view = { W: 0, H: 0, scale: 1 };     // 사진·확대 보기 모듈과 공유
  let DPR, centerY, insetBottom = null;      // insetBottom: 편집 패널이 트리 아래를 가릴 때 그 위까지만 트리를 그림

  /* 상단 제목과 하단 글귀 사이의 빈 공간에 트리가 꽉 차도록 배율 계산 */
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    const W = view.W = innerWidth, H = view.H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const top = el.top.getBoundingClientRect().bottom + 8;
    const bottom = Math.min(el.message.getBoundingClientRect().top, insetBottom ?? Infinity) - 4;
    const availH = Math.max(160, bottom - top);
    // 트리의 월드 크기: 폭 ≈ 2R × 1.1(바닥 원반) × 1.1(원근), 높이 ≈ 별(-330) ~ 바닥(+315) + 앞쪽 선물 상자 여유
    view.scale = Math.min((W * 0.94) / (2 * 230 * 1.21), availH / 700);
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
  const newFlake = anyY => {
    const r = Math.random() < .12 ? rnd(2.2, 3.4) : rnd(.5, 2.2);           // 가끔 큰 눈송이
    return { x: Math.random() * innerWidth, y: anyY ? Math.random() * innerHeight : -10,
             r, vy: rnd(.3, 1.1) * (.7 + r / 4), sway: rnd(0, TAU) };          // 큰 눈은 조금 빨리
  };
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
  const characters = createCharacters({ ctx, view, burst, isMobile });
  characters.setEnabled(opt.characters);
  const decor = createDecor({ ctx, view, burst, isMobile });
  decor.set(opt.decorations);
  decor.setGifts(opt.gifts);
  let edit = null;   // 장식 편집 중이면 { kind, color, onChange, onSelect, onLimit }
  const typer = createTyper(el.message, { srList: el.srMessages, onFirstStart: () => { el.title.style.opacity = 1; } });
  let lastPhotoSpawn = 0;

  /* ---------- 회전(드래그) & 클릭 ---------- */
  let rotY = 0, rotX = 0.12, velY = 0.004, dragging = false, lastX = 0, lastY = 0, moved = 0;
  let AUTO = opt.autoRotate ? 0.004 : 0;
  let dragOrn = -1, dragNew = false;   // 장식 편집: 끌고 있는 장식
  const ON_TREE = 34;                   // 트리 표면에서 이만큼(px) 안이면 "트리 위"
  const changed = () => edit?.onChange?.(decor.items.map(o => ({ ...o })));
  const onDown = e => {
    moved = 0; lastX = e.clientX; lastY = e.clientY;
    if (edit && !viewer.viewing) {
      const i = decor.hitOrnament(e.clientX, e.clientY);
      if (i >= 0) { dragOrn = i; dragNew = false; decor.select(i); edit.onSelect?.(i); canvas.classList.add('dragging'); return; }
      const s = edit.kind && decor.surfaceAt(e.clientX, e.clientY);
      if (s && s.d < ON_TREE) {
        if (decor.count >= MAX_DECOR) { edit.onLimit?.(); return; }
        dragOrn = decor.add({ k: edit.kind, t: s.t, a: s.a, c: edit.color ?? 0 }); dragNew = true;
        decor.select(dragOrn); edit.onSelect?.(dragOrn);
        burst(e.clientX, e.clientY, 16, 2.4);
        canvas.classList.add('dragging');
        return;
      }
      decor.select(-1); edit.onSelect?.(-1);
    }
    dragging = true;
    canvas.classList.add('dragging');
  };
  const onMove = e => {
    if (dragOrn >= 0) {
      moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      if (moved < 4 && !dragNew) return;
      const s = decor.surfaceAt(e.clientX, e.clientY);
      if (s && s.d < ON_TREE * 1.4) { decor.move(dragOrn, s.t, s.a); decor.setGhost(null); }
      else decor.setGhost({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!dragging) {
      if (!isMobile) {
        const x = e.clientX, y = e.clientY, onPhoto = !!photos.hit(x, y);
        canvas.classList.toggle('hovering', onPhoto);
        canvas.classList.toggle('pointing', !onPhoto && !!(characters.hit(x, y) || decor.hitGift(x, y) || decor.hitOrnament(x, y) >= 0));
        canvas.classList.toggle('placing', !!edit?.kind && !onPhoto && (decor.surfaceAt(x, y)?.d ?? 99) < ON_TREE);
      }
      return;
    }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    rotY += dx * 0.008; velY = dx * 0.0008;
    rotX = Math.max(-0.4, Math.min(0.5, rotX + dy * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = e => {
    if (dragOrn >= 0) {
      const i = dragOrn; dragOrn = -1; canvas.classList.remove('dragging');
      if (decor.ghost) {                                     // 트리 밖에 놓음 → 떼기
        decor.setGhost(null); decor.remove(i); edit?.onSelect?.(-1);
        burst(e.clientX, e.clientY, 20, 3);
        changed();
      } else if (dragNew || moved >= 4) changed();
      else decor.jingle(i, performance.now() / 1000);
      return;
    }
    if (!dragging) return;
    dragging = false; canvas.classList.remove('dragging');
    if (e.type === 'pointerup' && moved < 8) {
      const now = performance.now() / 1000;
      const s = photos.hit(e.clientX, e.clientY);
      const c = s ? null : characters.hit(e.clientX, e.clientY);
      const g = s || c ? null : decor.hitGift(e.clientX, e.clientY);
      const o = s || c || g ? -1 : decor.hitOrnament(e.clientX, e.clientY);
      if (s) viewer.open(s);
      else if (c) characters.react(c, now);
      else if (g) decor.openGift(g, now);
      else if (o >= 0) decor.jingle(o, now);
      else burst(e.clientX, e.clientY);
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

    if (!dragging) { rotY += velY; velY += ((edit ? 0 : AUTO) - velY) * (edit ? 0.08 : 0.02); }   // 장식 편집 중엔 멈춤

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
    decor.prepare(project, y => y * sx, now);   // 트리 중심축(0, y, 0)의 깊이 = y·sin(rotX)

    // 밤하늘(별·달) · 트리 뒤 불빛 · 눈 언덕 → 배경 캐릭터 (모두 트리 뒤)
    decor.drawSky(now);
    ctx.globalCompositeOperation = 'source-over';
    characters.step(now);
    ctx.globalCompositeOperation = 'source-over';
    decor.drawBack(now);                  // 트리 너머의 장식·선물은 흐리게, 입자보다 먼저

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

    // 앞쪽 장식 · 선물 상자
    ctx.globalCompositeOperation = 'source-over';
    decor.drawFront(now);

    // 꼭대기 별
    ctx.globalCompositeOperation = 'lighter';
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

    /** { autoRotate, patternCycle, characters, gifts } 중 넘긴 값만 바꾼다 */
    setSettings({ autoRotate, patternCycle, characters: chars, gifts } = {}) {
      if (typeof chars === 'boolean') { opt.characters = chars; characters.setEnabled(chars); }
      if (typeof gifts === 'boolean') { opt.gifts = gifts; decor.setGifts(gifts); }
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
    /** 걸린 사진의 캡션 바꾸기 (다음에 등장할 때부터 반영) */
    setPhotoCaption(id, caption) { const item = photos.find(id); if (item) item.caption = caption; return !!item; },

    /* ---------- 장식 ---------- */
    /** 장식 목록 바꾸기. null이면 기본 장식 */
    setDecorations(list) { decor.set(list); dragOrn = -1; },
    /** 지금 장식 목록 (복사본) */
    get decorations() { return decor.items.map(o => ({ ...o })); },
    get decorationsAreDefault() { return decor.isDefault; },
    /**
     * 장식 편집 켜기/끄기. cfg가 null이면 끔.
     *  { kind: 'ball' 등(없으면 옮기기만), color: 0~5, onChange(list), onSelect(index), onLimit() }
     *  켜져 있는 동안 자동 회전을 멈추고, 트리를 누르면 그 자리에 달고, 장식을 끌면 옮기고, 트리 밖에 놓으면 뗀다.
     */
    setDecorEditing(cfg) {
      edit = cfg ? { ...(edit || {}), ...cfg } : null;
      if (!edit) { decor.select(-1); decor.setGhost(null); dragOrn = -1; canvas.classList.remove('placing'); }
    },
    /** 보이는 앞면의 빈 자리에 장식 하나 달기 (키보드용). 반환: 달았으면 true */
    addDecorAnywhere(kind, color = 0) {
      if (decor.count >= MAX_DECOR) return false;
      const i = decor.add({ k: kind, ...decor.freeSpot(rotY), c: color });
      decor.select(i); edit?.onSelect?.(i); decor.jingle(i, nowSec()); changed();
      return true;
    },
    /** 고른 장식 떼기 */
    removeSelectedDecor() {
      const i = decor.selected;
      if (i < 0 || !decor.remove(i)) return false;
      edit?.onSelect?.(-1); changed();
      return true;
    },
    /** 고른 장식의 색 바꾸기 */
    recolorSelectedDecor(color) {
      const o = decor.items[decor.selected];
      if (!o) return false;
      o.c = color; changed();
      return true;
    },
    get selectedDecor() { const o = decor.items[decor.selected]; return o ? { ...o } : null; },
    /** 테스트·디버그용: 장식·선물의 화면 위치 */
    decorInfo: () => decor.info(),
    /** 트리를 그릴 아래쪽 한계(px). null이면 글귀 위까지 (편집 패널이 트리를 가릴 때) */
    setInsetBottom(px) { const v = px == null ? null : Math.round(px); if (v !== insetBottom) { insetBottom = v; layout(); } },

    /** 테스트·디버그용: 산타·루돌프의 위치와 반응 상태 */
    characterInfo: () => characters.info(),

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
      canvas.classList.remove('dragging', 'hovering', 'pointing', 'placing');
    }
  };
}
