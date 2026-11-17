/**
 * 글귀 타이핑 루프
 *  - 글귀를 한 글자씩 쓰고(75ms) → 2.6초 보여 주고 → 지운(25ms) 뒤 다음 글귀로
 *  - 사용자 입력이 들어가므로 innerHTML을 쓰지 않고 textContent + 커서 요소로 그린다
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createTyper(msgEl, { onFirstStart, srList } = {}) {
  let messages = [], token = 0;
  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  function render(text) {
    msgEl.textContent = text;
    msgEl.appendChild(cursor);
  }

  async function loop(initialDelay) {
    const my = ++token;
    msgEl.textContent = '';
    await sleep(initialDelay);
    if (my !== token) return;
    onFirstStart?.();
    for (let i = 0; my === token && messages.length; i++) {
      const text = messages[i % messages.length];
      for (let c = 0; c <= text.length; c++) {
        if (my !== token) return;
        render(text.slice(0, c)); await sleep(75);
      }
      await sleep(2600);
      for (let c = text.length; c >= 0; c--) {
        if (my !== token) return;
        render(text.slice(0, c)); await sleep(25);
      }
      await sleep(400);
    }
  }

  return {
    get messages() { return messages.slice(); },
    /** 글귀 목록을 바꾸고 처음부터 다시 타이핑 */
    set(list, delay = 0) {
      messages = list.slice();
      // 화면 낭독기용 전체 목록 (타이핑 요소는 aria-hidden)
      srList?.replaceChildren(...messages.map(m => { const li = document.createElement('li'); li.textContent = m; return li; }));
      loop(delay);
    },
    stop() { token++; msgEl.textContent = ''; }
  };
}

/* 참고: 프로토타입과 같게 String.slice(UTF-16 단위)로 자른다.
   그래서 이모지(서로게이트 쌍)는 타이핑 도중 한 프레임 깨져 보일 수 있다. */
