/**
 * 트리 장식 · 선물 상자 · 밤하늘 — 그림 파일 없이 캔버스 도형으로 직접 그린다
 *
 *  장식 { k, t, a, c }: 트리 원뿔 표면 위의 위치라서 트리와 함께 돈다 (DB trees.decorations와 같은 형식)
 *    k 종류(ORNAMENTS의 k) · t 높이 0.05~1(아래로 갈수록 큼) · a 둘레 각도 0~1 · c 색(DECOR_COLORS 번호)
 *  뒤쪽(트리 너머)에 있는 장식·선물은 입자보다 먼저 흐리게 그려서 트리 뒤에 있는 것처럼 보인다.
 *
 *  renderer.js가 매 프레임 prepare(project, axisZ) → drawSky → drawBack → (트리 입자) → drawFront 순서로 부른다.
 */
import { TAU, TOP, TH, R, rnd, clamp01 } from './patterns.js';
import { t } from '../i18n.js';

/** 장식 종류. k 값은 DB에 저장되므로 바꾸지 말 것 (새 종류는 SQL의 private.clean_decorations에도 추가)
 *  이름은 i18n.js의 'decor.<k>' (방울 · 전구 · 별 · 양말 · 종 · 사탕 · 리본 · 눈꽃) */
const ornament = (k, icon) => ({ k, icon, get name() { return t(`decor.${k}`); } });
export const ORNAMENTS = [
  ornament('ball', '🔴'), ornament('bulb', '💡'), ornament('star', '⭐'), ornament('sock', '🧦'),
  ornament('bell', '🔔'), ornament('candy', '🍭'), ornament('bow', '🎀'), ornament('flake', '❄️')
];
/** 장식 색 [이름 키, 색]. 순서(번호)가 DB에 저장되므로 맨 뒤에만 추가 (SQL은 0~5까지 허용)
 *  이름은 i18n.js의 'color.<키>' (빨강 · 금 · 파랑 · 초록 · 분홍 · 하양) */
export const DECOR_COLORS = [
  ['red', '#e8384f'], ['gold', '#f2c14e'], ['blue', '#4f8ef7'],
  ['green', '#3fbf7f'], ['pink', '#f27ab3'], ['white', '#f4f1ea']
];
export const MAX_DECOR = 60;

/** 처음 만든 트리(장식을 손대지 않은 트리)에 보여 줄 기본 장식 — 늘 같은 배치 */
export function defaultDecorations() {
  const kinds = ['ball', 'bulb', 'bell', 'bulb', 'candy', 'ball', 'bulb', 'sock', 'bow', 'bulb', 'flake', 'ball', 'star'];
  const N = 30, out = [];
  for (let i = 0; i < N; i++) {
    const t = 0.16 + 0.8 * Math.pow((i + 0.5) / N, 0.8);
    out.push({ k: kinds[i % kinds.length], t: +t.toFixed(4), a: +((i * 0.618034) % 1).toFixed(4), c: (i * 5) % 6 });
  }
  return out;
}

/** 저장된 값 정리 (모르는 종류·범위 밖 값은 버림) */
function sanitize(list) {
  if (!Array.isArray(list)) return null;
  const kinds = new Set(ORNAMENTS.map(o => o.k));
  return list.filter(o => o && kinds.has(o.k) && Number.isFinite(o.t) && Number.isFinite(o.a))
    .slice(0, MAX_DECOR)
    .map(o => ({ k: o.k, t: Math.min(1, Math.max(0.05, o.t)), a: o.a - Math.floor(o.a),
                 c: Number.isInteger(o.c) && o.c >= 0 && o.c < DECOR_COLORS.length ? o.c : 0 }));
}

const SIZE = { ball: 11, bulb: 8, star: 12, sock: 14, bell: 12, candy: 14, bow: 12, flake: 12 };
const shade = (hex, f) => {   // f>0 밝게, f<0 어둡게
  const n = parseInt(hex.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return `rgb(${ch.map(v => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))).join(',')})`;
};
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createDecor({ ctx, view, burst, isMobile }) {
  let items = defaultDecorations(), isDefault = true;
  let selected = -1, ghost = null;      // ghost: 트리 밖으로 끌어낸 장식의 화면 위치 (놓으면 떼어짐)
  let giftsOn = true;
  const wiggle = new Map();             // 장식 index → 흔들기 시작 시각
  const boost = isMobile ? 1.35 : 1.2, gboost = 1.1;   // 장식 · 선물 상자 크기 배율
  let born = null, intro = 0;           // 처음 트리 입자가 모이는 동안 장식·선물도 서서히 나타남
  let proj = null;                      // 이번 프레임의 투영 함수
  let scr = [];                         // 장식별 화면 좌표 { X, Y, k, front, size }

  /* ---------- 선물 상자: 트리 아래 바닥 원반 위에 둘러 놓음 ---------- */
  const GIFT_COLORS = [['#c8283c', '#ffd678'], ['#2f6fd6', '#f4f1ea'], ['#2e9e62', '#e8384f'],
                       ['#f2c14e', '#c8283c'], ['#8e5bd6', '#ffd678'], ['#f27ab3', '#f4f1ea'], ['#f4f1ea', '#3fbf7f']];
  const gifts = [0.08, 0.2, 0.36, 0.52, 0.66, 0.8, 0.93].map((u, i) => ({
    ang: u * TAU, r: R * (i % 2 ? 0.5 : 0.72), w: 34 + (i * 7) % 18, h: 24 + (i * 11) % 16,
    box: GIFT_COLORS[i][0], ribbon: GIFT_COLORS[i][1], openAt: -10, X: 0, Y: 0, s: 1, front: true
  }));

  /* ---------- 밤하늘: 별 · 달 ---------- */
  const skyStars = Array.from({ length: isMobile ? 60 : 110 }, () => ({
    x: Math.random(), y: Math.pow(Math.random(), 1.4) * 0.72, r: rnd(.35, 1.3), ph: rnd(0, TAU), sp: rnd(.6, 2.2)
  }));

  const worldOf = o => {
    const ang = o.a * TAU, r = o.t * R * 1.04;
    return [Math.cos(ang) * r, TOP + o.t * TH, Math.sin(ang) * r];
  };

  /** 이번 프레임의 화면 좌표 계산. axisZ(y): 그 높이의 트리 중심축 깊이 (그보다 앞이면 앞면) */
  function prepare(project, axisZ, now) {
    proj = { project, axisZ };
    born ??= now;
    intro = REDUCED ? 1 : clamp01((now - born - 0.9) / 1.6);
    scr = items.map(o => {
      const [x, y, z] = worldOf(o);
      const [X, Y, k, z2] = project(x, y, z);
      return { X, Y, k, front: z2 <= axisZ(y) + 2, size: SIZE[o.k] * k * view.scale * boost };
    });
    for (const g of gifts) {
      const y = TOP + TH + 10;
      const [X, Y, k, z2] = project(Math.cos(g.ang) * g.r, y, Math.sin(g.ang) * g.r);
      Object.assign(g, { X, Y, s: k * view.scale, front: z2 <= axisZ(y) });
    }
  }

  /* =========================================================
   *  장식 그리기 — 단위 좌표(반지름 약 10), 원점 = 장식 중심
   * ========================================================= */
  function drawOrnament(o, p, now, i, alpha) {
    const col = DECOR_COLORS[o.c]?.[1] || DECOR_COLORS[0][1];
    const w = wiggle.get(i), wt = w == null ? 1 : now - w;
    const swing = (REDUCED ? 0 : Math.sin(now * 1.6 + i * 1.7) * 0.06) + (wt < 1 ? Math.sin(wt * 22) * 0.5 * (1 - wt) : 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.X, p.Y);
    ctx.scale(p.size / 10, p.size / 10);
    if (o.k !== 'bulb' && o.k !== 'flake' && o.k !== 'star') {   // 매달린 장식은 고리에서 살짝 흔들림
      ctx.translate(0, -11); ctx.rotate(swing); ctx.translate(0, 11);
    }
    DRAW[o.k](col, now, i);
    ctx.restore();
  }

  const DRAW = {
    ball(col) {
      ctx.strokeStyle = 'rgba(255,230,170,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, -10); ctx.stroke();
      ctx.fillStyle = '#d9b45a'; ctx.fillRect(-3, -11.5, 6, 3.5);
      const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10);
      g.addColorStop(0, shade(col, .55)); g.addColorStop(.55, col); g.addColorStop(1, shade(col, -.45));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(-3.2, -3.6, 2.2, 1.4, -.6, 0, TAU); ctx.fill();
    },
    bulb(col, now, i) {
      const on = REDUCED ? .85 : .6 + .4 * Math.sin(now * 3 + i * 2.1);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 1, 0, 0, 1, 22);
      g.addColorStop(0, shade(col, .3).replace('rgb', 'rgba').replace(')', `,${.55 * on})`)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 1, 22, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2f4a32'; ctx.fillRect(-2.6, -9, 5.2, 4);
      ctx.fillStyle = shade(col, .25 * on); ctx.beginPath(); ctx.ellipse(0, 1, 4.6, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${.5 + .4 * on})`; ctx.beginPath(); ctx.ellipse(-1.4, -1, 1.2, 2.6, 0, 0, TAU); ctx.fill();
    },
    star(col, now, i) {
      const pulse = REDUCED ? 1 : 1 + .08 * Math.sin(now * 2.4 + i);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      g.addColorStop(0, 'rgba(255,236,170,.45)'); g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = o_starColor(col); ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rad = (k % 2 ? 4.4 : 10.5) * pulse, a = k / 10 * TAU - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = .8; ctx.stroke();
    },
    sock(col) {
      ctx.strokeStyle = 'rgba(255,230,170,.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, -11); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(-5, -7); ctx.lineTo(4, -7); ctx.lineTo(4, 4);
      ctx.quadraticCurveTo(12, 5, 11, 10); ctx.quadraticCurveTo(10, 14, 2, 13);
      ctx.lineTo(-2, 13); ctx.quadraticCurveTo(-6, 12, -5, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fbf7ef'; ctx.fillRect(-6.5, -12, 12, 5.5);                          // 털 단
      ctx.beginPath(); ctx.ellipse(9, 10.5, 2.6, 2.4, 0, 0, TAU); ctx.fill();               // 발끝
      ctx.fillStyle = shade(col, -.3); ctx.fillRect(-5, -1, 9, 1.6);                         // 줄무늬
    },
    bell(col) {
      const gold = col === DECOR_COLORS[5][1] ? '#f2c14e' : col;
      const g = ctx.createLinearGradient(-9, 0, 9, 0);
      g.addColorStop(0, shade(gold, -.35)); g.addColorStop(.4, shade(gold, .45)); g.addColorStop(1, shade(gold, -.4));
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(-2.5, -8); ctx.quadraticCurveTo(-7, -7, -7, 0); ctx.quadraticCurveTo(-7, 5, -10, 7);
      ctx.lineTo(10, 7); ctx.quadraticCurveTo(7, 5, 7, 0); ctx.quadraticCurveTo(7, -7, 2.5, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(gold, -.5); ctx.beginPath(); ctx.arc(0, 8.5, 2.4, 0, TAU); ctx.fill();   // 추
      ctx.fillStyle = '#e8384f';                                                                // 꼭지 리본
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, -13); ctx.lineTo(-5, -7); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, -13); ctx.lineTo(5, -7); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -9, 1.8, 0, TAU); ctx.fill();
    },
    candy(col) {
      const path = () => { ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(3, -5); ctx.arc(-2, -5, 5, 0, Math.PI, true); };
      ctx.lineCap = 'round'; ctx.lineWidth = 4.2;
      ctx.strokeStyle = '#fbf7ef'; path(); ctx.stroke();
      ctx.strokeStyle = col === DECOR_COLORS[5][1] ? '#e8384f' : col; ctx.setLineDash([2.6, 2.6]); path(); ctx.stroke();
      ctx.setLineDash([]);
    },
    bow(col) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(-12, -14, -11, -1); ctx.quadraticCurveTo(-10, 4, 0, -2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(12, -14, 11, -1); ctx.quadraticCurveTo(10, 4, 0, -2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-6, 12); ctx.lineTo(-2.5, 10); ctx.lineTo(0, 13); ctx.lineTo(1, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(6, 11); ctx.lineTo(3, 9.5); ctx.fill();
      ctx.fillStyle = shade(col, -.3); ctx.beginPath(); ctx.arc(0, -1.5, 2.6, 0, TAU); ctx.fill();
    },
    flake(col, now, i) {
      const c = col === DECOR_COLORS[0][1] ? '#cfe8ff' : shade(col, .45);
      ctx.save(); ctx.rotate(REDUCED ? 0 : now * .3 + i);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10);
        ctx.moveTo(0, -5.5); ctx.lineTo(-3, -8); ctx.moveTo(0, -5.5); ctx.lineTo(3, -8);
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  function o_starColor(col) { return col === DECOR_COLORS[0][1] ? '#ffe08a' : shade(col, .3); }

  /* ---------- 선물 상자 그리기: 앞면 + 윗면(살짝 비스듬) + 리본 ---------- */
  function drawGift(g, now, alpha) {
    const s = g.s * gboost, w = g.w * s, hh = g.h * s, d = w * .32;
    const open = clamp01(1 - (now - g.openAt) / 2.4);              // 1 → 0 : 뚜껑이 열렸다가 닫힘
    const lift = Math.sin(Math.min(1, open * 1.6) * Math.PI / 2) * hh * .7;
    const x = g.X - w / 2, y = g.Y - hh;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,.25)';                               // 그림자
    ctx.beginPath(); ctx.ellipse(g.X + d / 3, g.Y + 1, w * .62, hh * .14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(g.box, -.25);                              // 옆면
    ctx.beginPath(); ctx.moveTo(x + w, y); ctx.lineTo(x + w + d * .6, y - d * .45); ctx.lineTo(x + w + d * .6, g.Y - d * .45); ctx.lineTo(x + w, g.Y); ctx.fill();
    ctx.fillStyle = g.box; ctx.fillRect(x, y, w, hh);                // 앞면
    ctx.fillStyle = g.ribbon; ctx.fillRect(g.X - w * .08, y, w * .16, hh);
    if (open > 0) {                                                  // 열리면 안에서 빛이 나옴
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(g.X, y, 0, g.X, y, w * 1.1);
      gl.addColorStop(0, `rgba(255,230,150,${.7 * open})`); gl.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(g.X, y, w * 1.1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.translate(0, -lift);                                         // 뚜껑
    ctx.fillStyle = shade(g.box, .18);
    ctx.beginPath(); ctx.moveTo(x - w * .04, y); ctx.lineTo(x + w * 1.04, y); ctx.lineTo(x + w * 1.04 + d * .6, y - d * .45); ctx.lineTo(x - w * .04 + d * .6, y - d * .45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(g.box, -.05); ctx.fillRect(x - w * .04, y - hh * .02, w * 1.08, hh * .2);
    ctx.fillStyle = g.ribbon; ctx.fillRect(g.X - w * .08, y - hh * .02, w * .16, hh * .2);
    const bx = g.X + d * .3, by = y - d * .25;                       // 매듭 리본
    ctx.beginPath(); ctx.ellipse(bx - w * .14, by - hh * .1, w * .16, hh * .13, -.5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + w * .14, by - hh * .1, w * .16, hh * .13, .5, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(g.ribbon, -.2); ctx.beginPath(); ctx.arc(bx, by - hh * .04, w * .06, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* =========================================================
   *  하늘 · 땅 · 트리 뒤 불빛 (입자보다 먼저)
   * ========================================================= */
  function drawSky(now) {
    const { W, H, scale } = view;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of skyStars) {
      const a = REDUCED ? .55 : .35 + .35 * Math.sin(now * s.sp + s.ph);
      ctx.fillStyle = `rgba(255,248,225,${a})`;
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, TAU); ctx.fill();
    }
    // 달 (오른쪽 위, 제목·목록 버튼과 겹치지 않게)
    const mr = Math.max(16, Math.min(40, Math.min(W, H) * .045)), mx = W - mr * 2.6, my = Math.max(mr * 2.4, H * .13);
    const mg = ctx.createRadialGradient(mx, my, mr * .6, mx, my, mr * 4);
    mg.addColorStop(0, 'rgba(255,240,200,.22)'); mg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#fbf1d2'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(214,196,150,.35)';
    [[-.3, -.2, .22], [.28, .15, .16], [-.05, .38, .12], [.35, -.35, .09]].forEach(([dx, dy, r]) => {
      ctx.beginPath(); ctx.arc(mx + dx * mr, my + dy * mr, r * mr, 0, TAU); ctx.fill();
    });
    ctx.restore();
    if (!proj) return;
    // 트리 뒤 따뜻한 불빛
    const [cx, cy] = proj.project(0, TOP + TH * .55, 0);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 360 * scale);
    glow.addColorStop(0, 'rgba(255,196,120,.10)'); glow.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, 360 * scale, 0, TAU); ctx.fill();
    // 눈 쌓인 언덕
    const [, by] = proj.project(0, TOP + TH + 12, 0);
    const hill = (x, y, rx, ry, a) => {
      const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
      g.addColorStop(0, `rgba(225,236,255,${a})`); g.addColorStop(1, 'rgba(160,180,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    };
    hill(W * .18, by + 60 * scale, W * .5, 70 * scale, .07);
    hill(W * .85, by + 50 * scale, W * .45, 60 * scale, .07);
    hill(W / 2, by + 34 * scale, Math.max(W * .55, 420 * scale), 64 * scale, .13);
  }

  function drawPass(now, front) {
    if (intro <= 0) return;
    const dim = (front ? 1 : .32) * intro;
    if (giftsOn && !front) for (const g of gifts) if (!g.front) drawGift(g, now, .45 * intro);
    items.forEach((o, i) => {
      const p = scr[i];
      if (!p || p.front !== front || (ghost && i === selected)) return;
      drawOrnament(o, p, now, i, dim);
    });
    if (!front) return;
    if (giftsOn) [...gifts].filter(g => g.front).sort((a, b) => a.Y - b.Y).forEach(g => drawGift(g, now, intro));
    // 편집 중 고른 장식 표시
    const p = scr[selected];
    if (p && !ghost) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,233,168,.95)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = -now * 12;
      ctx.beginPath(); ctx.arc(p.X, p.Y, Math.max(14, p.size * 1.6), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    if (ghost && items[selected]) {   // 트리 밖으로 끌어낸 장식: 놓으면 떼어짐
      const o = items[selected];
      drawOrnament(o, { X: ghost.x, Y: ghost.y, size: SIZE[o.k] * view.scale * boost }, now, selected, .55);
      ctx.save();
      ctx.font = `${Math.round(Math.max(12, 13 * boost))}px 'Gowun Batang', serif`;
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,190,190,.95)';
      ctx.fillText(t('decor.dropHint'), ghost.x, ghost.y + SIZE[o.k] * view.scale * boost * 2.4 + 6);
      ctx.restore();
    }
  }

  /* =========================================================
   *  히트 테스트 · 화면 → 트리 표면
   * ========================================================= */
  function hitOrnament(px, py) {
    let best = -1, bd = Infinity;
    scr.forEach((p, i) => {
      if (!p.front) return;
      const d = Math.hypot(px - p.X, py - p.Y);
      if (d < Math.max(16, p.size * 1.6) && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function hitGift(px, py) {
    if (!giftsOn) return null;
    for (const g of [...gifts].filter(x => x.front).sort((a, b) => b.Y - a.Y)) {
      const s = g.s * gboost, w = g.w * s, hh = g.h * s;
      if (px > g.X - w * .6 && px < g.X + w * .75 && py > g.Y - hh * 1.5 && py < g.Y + 4) return g;
    }
    return null;
  }

  /** 화면 좌표에서 가장 가까운 트리 앞면의 점 → { t, a, d(화면 거리 px) } */
  function surfaceAt(px, py) {
    if (!proj) return null;
    const { project, axisZ } = proj;
    let best = null;
    const test = (t, a) => {
      if (t < 0.05 || t > 1) return;
      const [x, y, z] = worldOf({ t, a });
      const [X, Y, , z2] = project(x, y, z);
      if (z2 > axisZ(y) + 2) return;
      const d = Math.hypot(px - X, py - Y);
      if (!best || d < best.d) best = { t, a: a - Math.floor(a), d };
    };
    for (let ti = 0; ti <= 40; ti++) for (let ai = 0; ai < 72; ai++) test(0.05 + ti / 40 * 0.95, ai / 72);
    if (!best) return null;
    const t0 = best.t, a0 = best.a;                   // 주변을 더 촘촘하게
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) test(t0 + i * 0.004, a0 + j * 0.0023);
    return best;
  }

  /** 지금 보이는 앞면 쪽의 빈 자리 하나 (키보드로 "아무 곳에 달기") */
  function freeSpot(rotY) {
    let best = null;
    for (let tries = 0; tries < 40; tries++) {
      const t = rnd(.22, .95), a = ((-Math.PI / 2 - rotY) / TAU + rnd(-.13, .13));
      const cand = { t, a: a - Math.floor(a) };
      const near = Math.min(Infinity, ...items.map(o => Math.hypot((o.t - cand.t) * 3, Math.min(Math.abs(o.a - cand.a), 1 - Math.abs(o.a - cand.a)) * o.t * 4)));
      if (!best || near > best.near) best = { ...cand, near };
      if (near > .35) break;
    }
    return { t: +best.t.toFixed(4), a: +best.a.toFixed(4) };
  }

  return {
    prepare, drawSky, drawBack: now => drawPass(now, false), drawFront: now => drawPass(now, true),
    hitOrnament, hitGift, surfaceAt, freeSpot,
    get items() { return items; },
    get isDefault() { return isDefault; },
    get count() { return items.length; },
    get selected() { return selected; },
    /** 장식 목록 바꾸기. null이면 기본 장식 */
    set(list) {
      const clean = sanitize(list);
      items = clean ?? defaultDecorations(); isDefault = clean == null;
      selected = -1; ghost = null; wiggle.clear();
    },
    add(o) { if (items.length >= MAX_DECOR) return -1; items.push({ ...o }); isDefault = false; return items.length - 1; },
    move(i, t, a) { if (items[i]) { items[i].t = +t.toFixed(4); items[i].a = +a.toFixed(4); isDefault = false; } },
    remove(i) { if (!items[i]) return false; items.splice(i, 1); isDefault = false; if (selected === i) selected = -1; else if (selected > i) selected--; return true; },
    select(i) { selected = items[i] ? i : -1; },
    setGhost(g) { ghost = g; },
    get ghost() { return ghost; },
    jingle(i, now) {
      wiggle.set(i, now);
      const p = scr[i]; if (p) burst(p.X, p.Y, 14, 2.4);
    },
    openGift(g, now) {
      if (now - g.openAt < 1.2) return;
      g.openAt = now;
      burst(g.X, g.Y - g.h * g.s * gboost, 60, 5);
    },
    setGifts(v) { giftsOn = !!v; },
    get giftsOn() { return giftsOn; },
    /** 테스트용: 화면 좌표 */
    info() {
      return {
        items: items.map((o, i) => ({ ...o, x: scr[i]?.X, y: scr[i]?.Y, front: !!scr[i]?.front })),
        gifts: giftsOn ? gifts.map(g => ({ x: g.X, y: g.Y - g.h * g.s * gboost / 2, front: g.front, open: performance.now() / 1000 - g.openAt < 2.4 })) : [],
        selected, isDefault
      };
    }
  };
}
