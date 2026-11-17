/**
 * 확대 보기: 캔버스 속 사진 위치에서 화면 중앙으로 날아오는 FLIP 애니메이션
 *  - 열기: 카드를 "캔버스 속 사진 자리"로 되돌린 transform에서 시작 → transform 없음(중앙)으로 전환
 *  - 닫기: 반대로
 */
export function createViewer({ viewer, card, cardImg, cardCap }, view) {
  let viewing = null, animating = false;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

  function sizeCard(item) {
    const { W, H } = view;
    const pad = Math.round(Math.max(8, Math.min(16, W * .025))), bot = Math.round(pad * 3.4);
    const maxW = Math.min(W * .9, 960) - pad * 2, maxH = H * .8 - pad - bot;
    const nw = item.img.naturalWidth, nh = item.img.naturalHeight;
    const k = Math.min(maxW / nw, maxH / nh, 2);
    cardImg.style.width = Math.round(nw * k) + 'px'; cardImg.style.height = Math.round(nh * k) + 'px';
    card.style.padding = `${pad}px ${pad}px ${bot}px`;
    cardCap.style.bottom = Math.round(bot * .28) + 'px';
    cardCap.style.fontSize = Math.max(13, Math.round(bot * .36)) + 'px';
  }
  function flipTransform(s) {   // 카드(확대 상태)를 캔버스 속 사진 자리로 되돌리는 transform
    const r = card.getBoundingClientRect();
    const k = (s.w * s.sc) / r.width;
    return `translate(${s.x - (r.left + r.width / 2)}px, ${s.y - (r.top + r.height / 2)}px) rotate(${s.rot}rad) scale(${k})`;
  }

  function open(s) {
    if (animating) return;
    animating = true; viewing = s;
    s.paused = true; s.pauseStart = performance.now() / 1000;
    cardImg.src = s.item.img.src; cardCap.textContent = s.item.caption;
    cardImg.alt = s.item.caption || '트리 사진';
    sizeCard(s.item);
    viewer.classList.add('open');
    card.style.transition = 'none'; card.style.transform = 'none';
    card.style.transform = flipTransform(s);
    s.hidden = true;
    card.getBoundingClientRect();               // 강제 리플로우 → 시작 위치 확정
    card.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)';
    card.style.transform = 'none';
    viewer.classList.add('show');
    later(() => animating = false, 620);
  }

  function close() {
    if (!viewing || animating) return;
    animating = true;
    const s = viewing;
    card.style.transition = 'none'; card.style.transform = 'none';
    const back = flipTransform(s);
    card.getBoundingClientRect();
    card.style.transition = 'transform .55s cubic-bezier(.4,0,.2,1)';
    card.style.transform = back;
    viewer.classList.remove('show');
    later(() => {
      viewer.classList.remove('open');
      s.hidden = false; s.paused = false;
      s.pausedTotal += performance.now() / 1000 - s.pauseStart;
      viewing = null; animating = false;
    }, 560);
  }

  /** 애니메이션 없이 바로 닫기 (보고 있던 사진이 삭제됐을 때 등) */
  function closeNow() {
    timers.forEach(clearTimeout); timers.clear();
    viewer.classList.remove('show', 'open');
    if (viewing) { viewing.hidden = false; viewing.paused = false; }
    viewing = null; animating = false;
  }

  const onKey = e => { if (e.key === 'Escape') close(); };
  viewer.addEventListener('click', close);
  addEventListener('keydown', onKey);

  return {
    open, close, closeNow,
    get viewing() { return viewing; },
    destroy() {
      closeNow();
      viewer.removeEventListener('click', close);
      removeEventListener('keydown', onKey);
    }
  };
}
