/**
 * 사진: 라이브러리 + 화면 연출(show)
 *  - fall   : 화면 위에서 흔들리며 떨어짐
 *  - sparkle: 반짝 하고 나타났다가 잠시 후 사라짐
 *  - 히트 테스트: 클릭 좌표가 어느 사진 안에 있는지
 */
import { TAU, R, rnd, clamp01, easeOutBack } from './patterns.js';
import { t } from '../i18n.js';

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

/**
 * @param {{ ctx: CanvasRenderingContext2D, view: {W:number,H:number,scale:number}, isMobile: boolean,
 *           burst: (x:number, y:number, n?:number, spread?:number) => void }} env
 *   view는 렌더러가 레이아웃 때마다 값을 갱신하는 공유 객체
 */
export function createPhotoStage({ ctx, view, isMobile, burst }) {
  const lib = [];     // { id, img, caption, sample }
  const shows = [];   // 현재 화면에 떠 있는 사진들
  let cursor = 0;

  async function add(src, caption = '', opts = {}) {
    const img = await loadImage(src);
    const item = { id: opts.id ?? null, img, caption, sample: !!opts.sample };
    if (!item.sample) {                       // 진짜 사진이 들어오면 샘플은 제거(화면에 떠 있는 연출은 끝까지 보여 줌)
      for (let i = lib.length - 1; i >= 0; i--) if (lib[i].sample) lib.splice(i, 1);
    }
    lib.push(item);
    return item;
  }

  /** 라이브러리와 화면에서 사진을 뺀다. 확대 보기 중인 사진은 렌더러가 먼저 닫는다. */
  function removeItem(item) {
    const i = lib.indexOf(item);
    if (i >= 0) lib.splice(i, 1);
    for (let k = shows.length - 1; k >= 0; k--) if (shows[k].item === item) shows.splice(k, 1);
  }
  const find = id => lib.find(it => it.id === id) || null;

  const photoBase = () => Math.max(90, Math.min(230, Math.min(view.W, view.H) * 0.24));

  function spawn(now, item, mode) {
    const { W, H, scale } = view;
    const max = isMobile ? 2 : 3;
    if (!item) {
      if (!lib.length || shows.length >= max) return;
      for (let k = 0; k < lib.length; k++) {
        const cand = lib[(cursor + k) % lib.length];
        if (!shows.some(s => s.item === cand)) { item = cand; cursor = (cursor + k + 1) % lib.length; break; }
      }
      if (!item) return;
    }
    const base = photoBase(), ar = item.img.width / item.img.height;
    const iw = ar >= 1 ? base : base * ar, ih = ar >= 1 ? base / ar : base;
    const pad = base * 0.06, bot = base * 0.2;
    const s = {
      item, mode: mode || (Math.random() < .5 ? 'fall' : 'sparkle'),
      t0: now, pausedTotal: 0, paused: false, pauseStart: 0, hidden: false,
      iw, ih, pad, bot, w: iw + pad * 2, h: ih + pad + bot, base,
      phase: rnd(0, TAU), x: 0, y: 0, rot: 0, sc: 1, alpha: 0, burstIn: false, burstOut: false
    };
    if (s.mode === 'fall') {
      s.x0 = rnd(.15, .85) * W; s.speed = H / rnd(7, 10);
    } else {
      // 다른 사진과 겹치지 않는 자리 찾기
      // 넓은 화면이면 트리 양옆 빈 공간에, 좁은 화면이면 아무 곳에나
      const half = R * 1.25 * scale + s.w / 2, side = (W / 2 - half) > s.w * .6;
      for (let tries = 0; tries < 12; tries++) {
        if (side) {
          const left = Math.random() < .5, lo = s.w * .6, hi = W / 2 - half;
          s.x = left ? rnd(lo, hi) : W - rnd(lo, hi);
        } else s.x = rnd(.15, .85) * W;
        s.y = rnd(.22, .72) * H;
        if (shows.every(o => Math.hypot(o.x - s.x, o.y - s.y) > base * 1.1)) break;
      }
      s.rot = rnd(-.15, .15);
    }
    shows.push(s);
  }

  const localTime = (s, now) => (s.paused ? s.pauseStart : now) - s.t0 - s.pausedTotal;

  /* 연출별 위치·크기·투명도 계산. 끝났으면 false 반환 */
  function updateShow(s, now) {
    const { H } = view;
    const t = localTime(s, now);
    if (s.mode === 'fall') {
      s.y = -s.h + t * s.speed;
      s.x = s.x0 + Math.sin(t * 1.3 + s.phase) * s.base * 0.25;
      s.rot = Math.sin(t * 0.9 + s.phase) * 0.22;
      s.sc = 1;
      const fadeOut = s.y > H * .82 ? clamp01((H + s.h / 2 - s.y) / (H * .18 + s.h / 2)) : 1;
      s.alpha = clamp01(t / .4) * fadeOut;
      return s.y - s.h / 2 < H;
    } else {
      const IN = .6, HOLD = 3.6, OUT = 4.4;
      if (t < IN) { s.sc = Math.max(0.01, easeOutBack(t / IN)); s.alpha = clamp01(t / IN * 1.5); }
      else if (t < HOLD) { s.sc = 1 + Math.sin((t - IN) * 2) * 0.015; s.alpha = 1; }
      else { const k = clamp01((t - HOLD) / (OUT - HOLD)); s.sc = 1 - k * .2; s.alpha = 1 - k; }
      if (!s.burstIn && t >= 0) { s.burstIn = true; burst(s.x, s.y, 50, 5); }
      if (!s.burstOut && t >= HOLD) { s.burstOut = true; burst(s.x, s.y, 30, 3); }
      return t < OUT;
    }
  }

  function drawTwinkle(x, y, r, a) {
    ctx.strokeStyle = `rgba(255,240,200,${a})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
  }

  function drawShow(s, time) {
    if (s.hidden || s.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.scale(s.sc, s.sc);
    ctx.shadowColor = 'rgba(255,210,120,0.65)'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#fdfaf3'; ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
    ctx.shadowBlur = 0;
    ctx.drawImage(s.item.img, -s.w / 2 + s.pad, -s.h / 2 + s.pad, s.iw, s.ih);
    if (s.item.caption) {
      ctx.fillStyle = '#3a2f24';
      ctx.font = `${Math.round(s.base * 0.075)}px 'Gowun Batang', serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.item.caption, 0, s.h / 2 - s.bot / 2, s.w - s.pad * 2);
    }
    ctx.restore();
    // 반짝 연출 중에는 모서리에 작은 별빛
    if (s.mode === 'sparkle' && s.alpha > .3) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const a = time * 1.5 + i * TAU / 4 + s.phase;
        const px = s.x + Math.cos(a) * s.w * .62 * s.sc, py = s.y + Math.sin(a) * s.h * .62 * s.sc;
        drawTwinkle(px, py, 6 + 3 * Math.sin(time * 6 + i), s.alpha);
      }
      ctx.restore();
    }
  }

  /** 한 프레임: 끝난 연출 정리 후 그리기. keep(확대 보기 중인 사진)은 지우지 않는다 */
  function step(now, keep) {
    for (let i = shows.length - 1; i >= 0; i--) {
      if (!updateShow(shows[i], now) && shows[i] !== keep) shows.splice(i, 1);
    }
    shows.forEach(s => drawShow(s, now));
  }

  /* 클릭 좌표가 사진 안에 있는지: 회전·확대를 역으로 적용해 검사 */
  function hit(x, y) {
    for (let i = shows.length - 1; i >= 0; i--) {
      const s = shows[i];
      if (s.hidden || s.alpha < .3) continue;
      const dx = x - s.x, dy = y - s.y, c = Math.cos(-s.rot), sn = Math.sin(-s.rot);
      const lx = (dx * c - dy * sn) / s.sc, ly = (dx * sn + dy * c) / s.sc;
      if (Math.abs(lx) < s.w / 2 && Math.abs(ly) < s.h / 2) return s;
    }
    return null;
  }

  return { lib, shows, add, removeItem, find, spawn, step, hit, clear: () => { lib.length = 0; shows.length = 0; cursor = 0; } };
}

/* ---------- 샘플 사진 (데모 모드 전용, 내 사진을 넣으면 자동으로 빠짐) ---------- */
export function makeSample(emoji, c1, c2, label, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {           // 보케 조명
    g.fillStyle = `rgba(255,${200 + Math.random() * 55 | 0},${150 + Math.random() * 80 | 0},${rnd(.08, .3)})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(8, 40), 0, TAU); g.fill();
  }
  g.font = `${Math.min(w, h) * .42}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(emoji, w / 2, h * .46);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `${Math.min(w, h) * .06}px sans-serif`;
  g.fillText(t('sample.note'), w / 2, h * .88, w * .92);
  return { src: cv.toDataURL('image/jpeg', .85), caption: label };
}

export const SAMPLE_PHOTOS = () => [
  makeSample('⛄', '#1d3a6e', '#5a8fd6', t('sample.snowman'), 640, 480),
  makeSample('🎁', '#6e1d2a', '#d65a6a', t('sample.gift'), 480, 600),
  makeSample('🦌', '#2a4a2a', '#6aa86a', t('sample.deer'), 640, 480),
  makeSample('🕯️', '#3a2a12', '#c8963c', t('sample.candle'), 520, 520)
];
