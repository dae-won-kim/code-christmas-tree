/**
 * 트리 무늬 정의 — 각 생성 함수는 정확히 M개의 목표점을 만든다.
 * 좌표계: y 꼭대기 -300 → 바닥 +300, 반지름 최대 230
 */
import { t } from '../i18n.js';
export const TAU = Math.PI * 2;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp01 = x => Math.max(0, Math.min(1, x));
export const easeInOut = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const easeOutBack = x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

export const TOP = -300, TH = 600, R = 230;
export const C = {
  gold: [255, 214, 120], white: [255, 255, 255], warm: [255, 238, 200],
  red: [255, 95, 105], mint: [120, 255, 170], green: [60, 200, 115], deep: [40, 165, 85],
  ice: [150, 215, 255], lav: [190, 170, 255], blue: [110, 150, 255]
};
const pt = (x, y, z, c, s, d = 1) => ({ x, y, z, c, s, d });

/* 1) 나선 리본: 두 가닥 나선 + 원뿔 채움 */
function genSpiral(out, M) {
  const sN = Math.floor(M * 0.45);
  for (let i = 0; i < sN; i++) {
    const strand = i % 2, t = i / sN, a = t * TAU * 7 + strand * Math.PI, r = t * R;
    out.push(pt(Math.cos(a) * r, TOP + t * TH, Math.sin(a) * r, strand ? C.gold : C.white, rnd(1.2, 2.8)));
  }
  for (let i = sN; i < M; i++) {
    const t = Math.pow(Math.random(), 0.8), a = rnd(0, TAU), r = t * R * rnd(.75, 1.05);
    const c = Math.random() < .08 ? C.red : (Math.random() < .5 ? C.mint : C.green);
    out.push(pt(Math.cos(a) * r, TOP + t * TH, Math.sin(a) * r, c, rnd(.8, 2.2)));
  }
}

/* 2) 층층 전나무: 원뿔 5개를 겹쳐 쌓고, 가장자리에 전구 + 오너먼트 */
function genTiers(out, M) {
  const tiers = 5, w = [...Array(tiers)].map((_, k) => (k + 1) ** 2), sw = w.reduce((a, b) => a + b);
  for (let k = 0; k < tiers; k++) {
    const cnt = Math.round(M * w[k] / sw);
    const tTop = k * 0.16, tBot = Math.min(1, tTop + 0.36), Rk = R * (0.3 + 0.7 * (k + 1) / tiers);
    for (let j = 0; j < cnt; j++) {
      const rim = Math.random() < .24;
      const u = rim ? 1 : Math.sqrt(Math.random());
      const a = rnd(0, TAU), r = u * Rk * (rim ? 1 : rnd(.7, 1));
      let y = TOP + (tTop + u * (tBot - tTop)) * TH + (r / Rk) ** 2 * 12;   // 가지 끝이 살짝 처짐
      if (rim) y += Math.sin(a * 9) * 6;                                    // 물결 모양 가장자리
      let c = Math.random() < .5 ? C.green : C.deep, s = rnd(.8, 2);
      if (rim) { c = C.warm; s = rnd(1.4, 2.8); }
      else if (Math.random() < .07) { c = Math.random() < .5 ? C.red : C.gold; s = rnd(2.4, 3.6); }
      out.push(pt(Math.cos(a) * r, y, Math.sin(a) * r, c, s));
    }
  }
}

/* 3) 빛의 고리: 높이별 수평 고리(전구 줄)를 색을 바꿔가며 쌓음 */
function genRings(out, M) {
  const rings = 16, cols = [C.gold, C.red, C.white, C.ice, C.mint];
  const ts = [...Array(rings)].map((_, k) => 0.06 + 0.94 * k / (rings - 1));
  const sum = ts.reduce((a, b) => a + b);
  ts.forEach((t, k) => {
    const cnt = Math.round(M * t / sum), r = t * R;
    for (let j = 0; j < cnt; j++) {
      const a = j / cnt * TAU + k * 0.37;
      out.push(pt(Math.cos(a) * r, TOP + t * TH + Math.sin(a * 3 + k) * 4, Math.sin(a) * r,
                  cols[k % cols.length], rnd(1.2, 2.4)));
    }
  });
}

/* 4) 얼음 크리스탈: 비틀린 갈비뼈 8줄 + V자 잔가지 + 내부 반짝이 */
function genCrystal(out, M) {
  const ribs = 8;
  for (let i = 0; i < M; i++) {
    const roll = Math.random(), rib = i % ribs, base = rib / ribs * TAU;
    let t, a, r, c, s;
    if (roll < .5) {
      t = Math.pow(Math.random(), .9); a = base + t * 1.4; r = t * R;
      c = Math.random() < .5 ? C.white : C.ice; s = rnd(1, 2.4);
    } else if (roll < .85) {
      const t0 = rnd(.12, .95), u = Math.random(), side = Math.random() < .5 ? -1 : 1;
      t = Math.min(1, t0 + u * 0.07); a = base + t0 * 1.4 + side * u * 0.32; r = t * R;
      c = Math.random() < .6 ? C.ice : C.lav; s = rnd(.8, 1.8);
    } else {
      t = Math.random(); a = rnd(0, TAU); r = t * R * Math.random() * .8;
      c = C.blue; s = rnd(.6, 1.6);
    }
    out.push(pt(Math.cos(a) * r, TOP + t * TH, Math.sin(a) * r, c, s));
  }
}

/* 5) 은하수 소용돌이: 다섯 갈래 팔이 감기며 올라가는 별빛 소용돌이 */
function genGalaxy(out, M) {
  const arms = 5;
  for (let i = 0; i < M; i++) {
    const t = Math.pow(Math.random(), 0.85), arm = i % arms;
    const spread = (Math.random() - .5) * 0.55 * (1 - t * .5);           // 팔 두께: 위쪽일수록 넓게
    const a = arm / arms * TAU + t * TAU * 1.6 + spread;
    const r = t * R * (0.35 + 0.65 * Math.pow(Math.random(), .35));
    const c = Math.random() < .15 ? C.white : (t < .4 ? C.lav : (Math.random() < .5 ? C.blue : C.ice));
    out.push(pt(Math.cos(a) * r, TOP + t * TH + rnd(-6, 6), Math.sin(a) * r, c, rnd(.7, 2.2)));
  }
}

/* 6) 캔디 스트라이프: 원뿔 표면에 빨강·하양 물결 띠 (사탕처럼)
      ※ 사선 띠는 투명한 원뿔에서 앞·뒷면 줄이 엇갈려 격자처럼 보여서, 앞뒤가 겹쳐도 맞물리는 가로 물결로 함 */
function genCandy(out, M) {
  for (let i = 0; i < M; i++) {
    const t = Math.pow(Math.random(), .75), a = rnd(0, TAU), r = t * R * rnd(.97, 1.02);   // 표면에 붙여야 줄이 또렷함
    const band = Math.floor(t * 9 + Math.sin(a * 3) * .3) % 2;              // 높이 + 물결 → 굵은 띠
    const c = Math.random() < .05 ? C.mint : (band ? C.red : C.white);
    out.push(pt(Math.cos(a) * r, TOP + t * TH, Math.sin(a) * r, c, rnd(1, 2.4)));
  }
}

/* 7) 눈꽃 결정층: 여섯 갈래 눈꽃 7장을 크기를 줄여 가며 층층이 띄움 */
function genSnowflakes(out, M) {
  const layers = 7, w = [...Array(layers)].map((_, k) => k + 1), sw = w.reduce((a, b) => a + b);
  for (let k = 0; k < layers; k++) {
    const t = (k + 1) / layers, y = TOP + t * TH * .97, Rk = t * R, rot = k * .45;
    const cnt = Math.round(M * w[k] / sw);
    for (let j = 0; j < cnt; j++) {
      const base = (j % 6) / 6 * TAU + rot;
      if (Math.random() < .35) {                                             // 잔가지: 팔 중간에서 ±60°로 뻗음
        const at = rnd(.35, .8) * Rk, len = rnd(0, .28) * Rk, side = Math.random() < .5 ? -1 : 1;
        const bx = Math.cos(base) * at + Math.cos(base + side * Math.PI / 3) * len;
        const bz = Math.sin(base) * at + Math.sin(base + side * Math.PI / 3) * len;
        out.push(pt(bx, y + rnd(-3, 3), bz, Math.random() < .5 ? C.white : C.ice, rnd(.8, 1.8)));
        continue;
      }
      const u = Math.random(), tip = Math.random() > .95;                   // 팔 끝은 조금 더 밝게
      const r = tip ? Rk * rnd(.95, 1.05) : u * Rk;
      out.push(pt(Math.cos(base) * r, y + rnd(-3, 3), Math.sin(base) * r, tip || u > .9 ? C.white : C.ice, tip ? rnd(2, 3.2) : rnd(.9, 2)));
    }
  }
}

/* 8) 금빛 가랜드: 은은한 초록 원뿔 위에 금빛 줄을 늘어뜨리고 이음매마다 빨간 방울 */
function genGarland(out, M) {
  const tiers = 6, anchors = 7;
  const tierT = k => .18 + .8 * k / (tiers - 1);
  for (let i = 0; i < M; i++) {
    const roll = Math.random();
    if (roll < .55) {                                                        // 늘어진 금빛 줄
      const k = i % tiers, t0 = tierT(k), seg = (Math.random() * anchors) | 0, u = Math.random();
      const a = (seg + u) / anchors * TAU + k * .5, sag = Math.sin(u * Math.PI) * 26;
      const r = Math.min(1, t0 + sag / TH) * R * 1.02;
      out.push(pt(Math.cos(a) * r, TOP + t0 * TH + sag, Math.sin(a) * r, Math.random() < .7 ? C.gold : C.warm, rnd(1.1, 2.4)));
    } else if (roll < .88) {                                                 // 몸통
      const t = Math.pow(Math.random(), .8), a = rnd(0, TAU), r = t * R * rnd(.55, .98);
      out.push(pt(Math.cos(a) * r, TOP + t * TH, Math.sin(a) * r, Math.random() < .5 ? C.deep : C.green, rnd(.6, 1.5)));
    } else {                                                                 // 이음매 방울
      const k = (Math.random() * tiers) | 0, t0 = tierT(k), seg = (Math.random() * anchors) | 0;
      const a = seg / anchors * TAU + k * .5, r = t0 * R * 1.03;
      out.push(pt(Math.cos(a) * r + rnd(-3, 3), TOP + t0 * TH + rnd(-3, 3), Math.sin(a) * r + rnd(-3, 3), C.red, rnd(2.2, 3.6)));
    }
  }
}

/** 무늬 목록. 순서(인덱스)는 DB의 trees.pattern(0~7)과 같다. 새 무늬는 항상 맨 뒤에 추가할 것
 *  (이름은 i18n.js의 'pattern.<번호>' — 한국어: 나선 리본 · 층층 전나무 · 빛의 고리 · 얼음 크리스탈 ·
 *   은하수 소용돌이 · 캔디 스트라이프 · 눈꽃 결정층 · 금빛 가랜드) */
export const PATTERNS = [
  { gen: genSpiral,     base: C.gold,  bg: [11, 18, 48] },
  { gen: genTiers,      base: C.warm,  bg: [5, 22, 22] },
  { gen: genRings,      base: C.red,   bg: [26, 10, 32] },
  { gen: genCrystal,    base: C.ice,   bg: [6, 20, 54] },
  { gen: genGalaxy,     base: C.lav,   bg: [16, 8, 40] },
  { gen: genCandy,      base: C.white, bg: [36, 10, 18] },
  { gen: genSnowflakes, base: C.ice,   bg: [8, 24, 48] },
  { gen: genGarland,    base: C.gold,  bg: [20, 18, 8] }
];
/** 무늬 이름 (지금 화면 언어) */
export const patternName = i => (PATTERNS[i] ? t(`pattern.${i}`) : '');

/**
 * 무늬마다 N개의 목표점 배열을 만든다. 무늬 하나 = 몸통 + 바닥 원반.
 * 항상 N개로 맞춰야 무늬 전환 때 입자를 1:1로 대응시킬 수 있다.
 */
export function buildTargets(N) {
  const B = Math.floor(N * 0.07);
  return PATTERNS.map(p => {
    const arr = [];
    p.gen(arr, N - B);
    while (arr.length > N - B) arr.pop();
    while (arr.length < N - B) arr.push({ ...arr[(Math.random() * arr.length) | 0] });
    for (let i = 0; i < B; i++) {
      const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R * 1.2;
      arr.push(pt(Math.cos(a) * r, TOP + TH + 12, Math.sin(a) * r, p.base, rnd(.6, 1.6), .35));
    }
    return arr;
  });
}
