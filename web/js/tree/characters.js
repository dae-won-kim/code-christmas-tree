/**
 * 배경 캐릭터 — 썰매 탄 산타와 사슴이 하늘을 천천히 날아다닌다 (트리 뒤에 그림)
 *  - 그림 파일 없이 캔버스 도형으로 직접 그린다
 *  - 화면 안의 임의 지점을 차례로 목표로 삼아 부드럽게 방향을 틀며 이동
 *  - 누르면(클릭·터치) 반응: 산타는 "호호호!" 하며 폴짝 + 선물 반짝이, 사슴은 목의 방울이 반짝 + 폴짝
 *  - 사슴은 특정 캐릭터(상표)를 흉내 내지 않도록 이름·빨간 코 같은 고유한 특징을 쓰지 않는다
 */
import { TAU, rnd, clamp01 } from './patterns.js';
import { t } from '../i18n.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createCharacters({ ctx, view, burst, isMobile }) {
  const base = () => Math.max(34, Math.min(60, Math.min(view.W, view.H) * 0.07));
  const speedOf = kind => (isMobile ? 20 : 28) * (kind === 'deer' ? 1.25 : 1) * (REDUCED ? 0.4 : 1);

  function make(kind) {
    const c = {
      kind, x: rnd(.1, .9) * (view.W || innerWidth), y: rnd(.15, .6) * (view.H || innerHeight),
      vx: 0, vy: 0, tx: 0, ty: 0, face: 1, flip: 1, phase: rnd(0, TAU),
      jumpY: 0, jumpV: 0, reactAt: -10, bubble: null, bubbleUntil: 0
    };
    pickTarget(c);
    return c;
  }
  function pickTarget(c) {
    // 위아래 UI(제목·글귀·버튼)를 피해 하늘 영역 안에서
    c.tx = rnd(.06, .94) * view.W;
    c.ty = rnd(.14, .66) * view.H;
  }
  const list = [make('santa'), make('deer')];
  let enabled = true, last = null;

  /* ---------- 그리기: 좌표는 캐릭터 크기 50 기준, 오른쪽을 바라보는 모습 ---------- */
  function drawSanta(t, react) {
    // 썰매
    ctx.fillStyle = '#9b1b2c';
    ctx.beginPath();
    ctx.moveTo(-30, 4); ctx.lineTo(18, 4); ctx.quadraticCurveTo(30, 4, 30, -8);   // 앞쪽이 말려 올라감
    ctx.lineTo(34, -8); ctx.quadraticCurveTo(34, 20, 14, 20); ctx.lineTo(-26, 20);
    ctx.quadraticCurveTo(-32, 20, -32, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd678'; ctx.fillRect(-28, 8, 50, 2.5);                       // 금빛 장식선
    ctx.strokeStyle = '#ffd678'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';        // 썰매 발
    ctx.beginPath(); ctx.moveTo(-28, 26); ctx.lineTo(24, 26); ctx.quadraticCurveTo(34, 26, 33, 17); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, 20); ctx.lineTo(-18, 26); ctx.moveTo(12, 20); ctx.lineTo(12, 26); ctx.stroke();
    // 선물 자루
    ctx.fillStyle = '#7a5434'; ctx.beginPath(); ctx.ellipse(-20, -4, 11, 12, -.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e94a5a'; ctx.fillRect(-25, -18, 8, 6);
    ctx.fillStyle = '#5fd18c'; ctx.fillRect(-18, -20, 7, 7);
    // 몸통
    ctx.fillStyle = '#d7263d'; ctx.beginPath(); ctx.ellipse(2, -4, 13, 12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(-1, -16, 6, 20);                            // 앞단 흰 털
    ctx.fillStyle = '#2b1d1a'; ctx.fillRect(-10, 0, 25, 4);                          // 벨트
    ctx.fillStyle = '#ffd678'; ctx.fillRect(0, -0.5, 5, 5);
    // 팔 (고삐 잡은 손)
    ctx.strokeStyle = '#d7263d'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(17 + Math.sin(t * 3) * 1.5, -3); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(19, -3, 3.2, 0, TAU); ctx.fill();
    // 얼굴
    ctx.fillStyle = '#f6d3b3'; ctx.beginPath(); ctx.arc(4, -21, 8.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';                                                         // 수염
    ctx.beginPath(); ctx.moveTo(-4.5, -20); ctx.quadraticCurveTo(4, -2, 12.5, -20);
    ctx.quadraticCurveTo(4, -14, -4.5, -20); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -12, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2b1d1a';
    const blink = (t + 1.3) % 4 < .12;                                              // 가끔 눈 깜빡
    if (blink) { ctx.fillRect(2, -23, 3, 1); ctx.fillRect(7, -23, 3, 1); }
    else { ctx.beginPath(); ctx.arc(3.5, -22.5, 1.2, 0, TAU); ctx.arc(8.5, -22.5, 1.2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#f08a8a'; ctx.beginPath(); ctx.arc(6, -19.5, 2, 0, TAU); ctx.fill();   // 코
    if (react) { ctx.fillStyle = '#7a2b2b'; ctx.beginPath(); ctx.ellipse(6, -15, 2.6, 2, 0, 0, TAU); ctx.fill(); }   // "호호호" 입
    // 모자
    const wob = react ? Math.sin(t * 22) * .25 : Math.sin(t * 2) * .06;
    ctx.save(); ctx.translate(4, -27); ctx.rotate(wob);
    ctx.fillStyle = '#d7263d';
    ctx.beginPath(); ctx.moveTo(-9, 0); ctx.quadraticCurveTo(0, -16, -14, -14); ctx.lineTo(9, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-14, -14, 3.6, 0, TAU); ctx.fill();
    ctx.fillRect(-10, -2, 20, 4.5);
    ctx.restore();
  }

  function drawDeer(t, react) {
    const gallop = t * (react ? 14 : 7);
    // 다리 (달리는 모양)
    ctx.strokeStyle = '#6e4630'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    [[-13, 0], [-7, 1.7], [9, 3.1], [15, 4.5]].forEach(([lx, ph]) => {
      const a = Math.sin(gallop + ph) * .7;
      ctx.beginPath(); ctx.moveTo(lx, 5); ctx.lineTo(lx + Math.sin(a) * 9, 5 + Math.cos(a) * 11); ctx.stroke();
    });
    // 몸통 · 배
    ctx.fillStyle = '#8a5a3c'; ctx.beginPath(); ctx.ellipse(0, 0, 21, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c99c72'; ctx.beginPath(); ctx.ellipse(2, 4, 13, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-21, -4, 4, 3, -.5, 0, TAU); ctx.fill();   // 꼬리
    // 목도리 + 방울 (반응하면 방울이 빛나며 흔들림)
    ctx.fillStyle = '#2e7d4f'; ctx.beginPath(); ctx.ellipse(15, -5, 5, 7, .4, 0, TAU); ctx.fill();
    const ring = react ? 1 : .3 + .2 * Math.sin(t * 2.5);
    const bg = ctx.createRadialGradient(17, 1, 0, 17, 1, react ? 20 : 8);
    bg.addColorStop(0, `rgba(255,220,120,${.7 * ring})`); bg.addColorStop(1, 'rgba(255,210,100,0)');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(17, 1, react ? 20 : 8, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(17, 1); ctx.rotate(react ? Math.sin(t * 24) * .5 : 0);
    ctx.fillStyle = '#ffd678'; ctx.beginPath(); ctx.arc(0, 0, react ? 3.4 : 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = '#b8862e'; ctx.fillRect(-1.6, .4, 3.2, .9);
    ctx.restore();
    // 머리
    ctx.save(); ctx.translate(21, -12); ctx.rotate(react ? Math.sin(t * 18) * .15 : Math.sin(t * 1.7) * .05);
    ctx.strokeStyle = '#e2c290'; ctx.lineWidth = 2.2;                                           // 뿔
    ctx.beginPath();
    ctx.moveTo(-3, -6); ctx.lineTo(-6, -17); ctx.moveTo(-5, -12); ctx.lineTo(-11, -15); ctx.moveTo(-6, -17); ctx.lineTo(-3, -21);
    ctx.moveTo(1, -6); ctx.lineTo(3, -16); ctx.moveTo(2, -11); ctx.lineTo(8, -14);
    ctx.stroke();
    ctx.fillStyle = '#8a5a3c'; ctx.beginPath(); ctx.ellipse(0, 0, 8.5, 7, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-6, -5, 3.5, 2, -.6, 0, TAU); ctx.fill();                     // 귀
    ctx.fillStyle = '#c99c72'; ctx.beginPath(); ctx.ellipse(7, 2, 5.5, 4, 0, 0, TAU); ctx.fill();   // 주둥이
    ctx.fillStyle = '#2b1d1a'; ctx.beginPath(); ctx.arc(2.5, -2.5, 1.3, 0, TAU); ctx.fill();         // 눈
    // 코 (평범한 짙은 갈색)
    ctx.fillStyle = '#3a2418'; ctx.beginPath(); ctx.ellipse(12, 1.2, 2.4, 2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(11.3, .5, .7, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawBubble(c, x, y, text, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${Math.round(Math.max(12, base() * .28))}px 'Gowun Batang', serif`;
    const w = ctx.measureText(text).width + 18, h = Math.max(24, base() * .5);
    const bx = Math.max(6, Math.min(view.W - w - 6, x - w / 2)), by = y - h - 8;
    ctx.fillStyle = 'rgba(253,250,243,.96)'; ctx.strokeStyle = 'rgba(255,210,120,.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 10) : ctx.rect(bx, by, w, h); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5, by + h); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 5, by + h); ctx.fill();
    ctx.fillStyle = '#3a2f24'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  }

  const center = c => {
    const bob = REDUCED ? 0 : Math.sin(performance.now() / 1000 * 2.2 + c.phase) * 4;
    return [c.x, c.y - c.jumpY + bob];
  };

  /** 한 프레임: 이동 + 그리기 */
  function step(now) {
    const dt = last == null ? 0 : Math.min(.05, Math.max(0, now - last));
    last = now;
    if (!enabled) return;
    const size = base(), k = size / 50;
    for (const c of list) {
      // 목표 지점을 향해 부드럽게 방향을 틀며 이동
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < 24) pickTarget(c);
      const sp = speedOf(c.kind), steer = Math.min(1, dt * 1.1);
      c.vx += ((d ? dx / d : 0) * sp - c.vx) * steer;
      c.vy += ((d ? dy / d : 0) * sp * .6 - c.vy) * steer;
      c.x = Math.max(-size, Math.min(view.W + size, c.x + c.vx * dt));
      c.y = Math.max(size, Math.min(view.H - size, c.y + c.vy * dt));
      if (Math.abs(c.vx) > 4) c.face = Math.sign(c.vx);
      c.flip += (c.face - c.flip) * Math.min(1, dt * 5);
      if (c.jumpY > 0 || c.jumpV > 0) { c.jumpV -= 900 * dt; c.jumpY = Math.max(0, c.jumpY + c.jumpV * dt); if (!c.jumpY) c.jumpV = 0; }

      const react = now - c.reactAt < 1.6;
      const [x, y] = center(c);
      ctx.save();
      ctx.translate(x, y);
      // 어두운 밤하늘에서도 보이도록 은은한 후광
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.1);
      halo.addColorStop(0, `rgba(255,236,190,${react ? .28 : .12})`); halo.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, size * 1.1, 0, TAU); ctx.fill();
      ctx.scale(Math.max(.05, Math.abs(c.flip)) * Math.sign(c.flip || 1) * k, k);
      ctx.rotate(Math.atan2(c.vy, Math.abs(c.vx) + 30) * .5);                    // 오르내릴 때 살짝 기울기
      ctx.globalAlpha = .95;
      c.kind === 'santa' ? drawSanta(now + c.phase, react) : drawDeer(now + c.phase, react);
      ctx.restore();
      if (c.bubble && now < c.bubbleUntil) {
        drawBubble(c, x, y - size * .55, c.bubble, clamp01((c.bubbleUntil - now) / .4));
      }
    }
  }

  /** 클릭 좌표에 캐릭터가 있는가 */
  function hit(px, py) {
    if (!enabled) return null;
    const r = base() * .8;
    for (let i = list.length - 1; i >= 0; i--) {
      const [x, y] = center(list[i]);
      if (Math.hypot(px - x, py - y) < r) return list[i];
    }
    return null;
  }

  // 말풍선 문구는 i18n.js의 'lines.santa' · 'lines.deer' (누를 때마다 지금 언어로)
  /** 반응: 폴짝 + 말풍선 + 반짝이 */
  function react(c, now) {
    if (now - c.reactAt < .5) return;
    c.reactAt = now;
    c.jumpV = 320; c.jumpY = Math.max(c.jumpY, .1);
    const lines = t(`lines.${c.kind}`);
    c.bubble = lines[(Math.random() * lines.length) | 0];
    c.bubbleUntil = now + 2.2;
    const [x, y] = center(c);
    burst(x, y, c.kind === 'santa' ? 46 : 30, c.kind === 'santa' ? 4.5 : 3.5);
    pickTarget(c);   // 놀라서 다른 곳으로 날아감
  }

  return {
    step, hit, react,
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; },
    /** 테스트용: 지금 위치와 반응 상태 */
    info() { return list.map(c => { const [x, y] = center(c); return { kind: c.kind, x, y, bubble: c.bubble, reacting: performance.now() / 1000 - c.reactAt < 1.6 }; }); }
  };
}
