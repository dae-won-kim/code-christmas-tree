/**
 * 트리 무늬 정의 — 각 생성 함수는 정확히 M개의 목표점을 만든다.
 * 좌표계: y 꼭대기 -300 → 바닥 +300, 반지름 최대 230
 */
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

/** 무늬 목록. 순서(인덱스)는 DB의 tree_users.pattern(0~3)과 같다. */
export const PATTERNS = [
  { name: '나선 리본',     gen: genSpiral,  base: C.gold, bg: [11, 18, 48] },
  { name: '층층 전나무',   gen: genTiers,   base: C.warm, bg: [5, 22, 22] },
  { name: '빛의 고리',     gen: genRings,   base: C.red,  bg: [26, 10, 32] },
  { name: '얼음 크리스탈', gen: genCrystal, base: C.ice,  bg: [6, 20, 54] }
];

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
