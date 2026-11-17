/**
 * 화면 공통 도우미
 *  - 사용자 입력(이름·제목·글귀·캡션)은 반드시 textContent로 넣는다. innerHTML 금지
 *    (세션 토큰이 localStorage에 있어서 XSS가 생기면 토큰이 탈취된다)
 */
export const $ = id => document.getElementById(id);

/** 요소 만들기: h('li', { className: 'x', text: '사용자 입력' }, child1, child2) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

/* ---------- 알림(토스트) ---------- */
let toastTimer;
export function toast(message, { error = false, ms = 2600 } = {}) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- 로딩 · 오류 화면 ---------- */
/**
 * @param {'loading'|'error'|null} kind  null이면 닫기
 * @param {string} [text]
 * @param {{label: string, onClick?: () => void, href?: string, primary?: boolean}[]} [actions]
 */
export function screen(kind, text = '', actions = []) {
  const el = $('screen');
  if (!kind) { el.hidden = true; return; }
  el.className = kind;
  $('screenText').textContent = text;
  const box = $('screenActions');
  box.replaceChildren(...actions.map(a => a.href
    ? h('a', { className: 'button', href: a.href, text: a.label })
    : h('button', { type: 'button', className: a.primary ? 'primary' : null, text: a.label, onclick: a.onClick })));
  el.hidden = false;
  box.querySelector('button, a')?.focus();
}

/** 버튼을 잠시 "작업 중" 상태로 */
export async function busy(button, label, task) {
  const old = button.textContent;
  button.disabled = true; button.textContent = label;
  try { return await task(); }
  finally { button.disabled = false; button.textContent = old; }
}

/** IME(한글 조합) 상태 추적: 조합 중에는 검증 메시지·Enter 처리를 미룬다 */
export function trackComposition(input) {
  const state = { composing: false };
  input.addEventListener('compositionstart', () => { state.composing = true; });
  input.addEventListener('compositionend', () => { state.composing = false; });
  return state;
}
/** keydown 이벤트가 IME 조합을 확정하는 Enter인지 (그 Enter로는 제출하지 않음) */
export const isImeEnter = e => e.isComposing || e.keyCode === 229;

/** 두 번 눌러야 실행되는 버튼(삭제 등). 첫 클릭 후 3초 안에 다시 눌러야 함 */
export function confirmButton(button, confirmLabel, action) {
  const label = button.textContent, ariaLabel = button.getAttribute('aria-label');
  let timer = null;
  const reset = () => {
    clearTimeout(timer); timer = null;
    button.classList.remove('confirming'); button.textContent = label;
    if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  };
  button.addEventListener('click', async () => {
    if (!timer) {
      button.classList.add('confirming'); button.textContent = confirmLabel;
      if (ariaLabel) button.setAttribute('aria-label', `${ariaLabel} — 한 번 더 누르면 실행`);
      timer = setTimeout(reset, 3000);
      return;
    }
    reset();
    await action();
  });
}
