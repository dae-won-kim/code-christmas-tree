/**
 * 로그인 화면 — 한글 이름 + PIN으로 "내 트리 열기", 없으면 새로 만들지 확인
 *
 *  - 이름 검증은 실시간. 단, 한글 조합 중(compositionstart~end)에는 메시지를 바꾸지 않는다.
 *    ("김" → "김ㅁ" → "김미" 처럼 조합 도중 값이 잠깐 자모가 되기 때문에 그대로 검증하면 메시지가 깜빡인다)
 *  - "너무 짧음"은 입력 중엔 띄우지 않고, 칸을 벗어나거나 제출할 때만 알린다.
 */
import { ERROR_MESSAGES, TreeError, normalizeName, isValidName, isValidPin } from '../api.js';
import { $, trackComposition, toast } from './dom.js';

/** 이름 검사 결과: null(문제 없음/아직 판단 안 함) 또는 오류 문구 */
function nameProblem(raw, { final }) {
  const v = normalizeName(raw);
  if (!v) return final ? '이름을 입력해 주세요.' : null;
  if (/[^가-힣]/.test(v)) {
    if (/\s/.test(v)) return '이름에는 공백을 넣을 수 없어요.';
    if (/[ㄱ-ㅎㅏ-ㅣ]/.test(v)) return '자음·모음만 따로 쓸 수 없어요. 완성된 글자로 입력해 주세요.';
    return '이름은 한글만 쓸 수 있어요. (영문·숫자·기호 불가)';
  }
  if (v.length > 10) return '이름은 10자까지예요.';
  if (v.length < 2) return final ? '이름은 2자 이상이에요.' : null;
  return null;
}
function pinProblem(raw, { final }) {
  const v = String(raw || '');
  if (/[^0-9]/.test(v)) return 'PIN은 숫자만 쓸 수 있어요.';
  if (!v) return final ? 'PIN을 입력해 주세요.' : null;
  if (v.length < 4) return final ? 'PIN은 4자리 이상이에요.' : null;
  return null;
}

/**
 * @param {{ api: import('../api.js').TreeApi, onEnter: (result) => void }} deps
 * @returns {{ destroy(): void }}
 */
export function mountLogin({ api, onEnter }) {
  const form = $('loginCard'), name = $('inName'), pin = $('inPin');
  const nameMsg = $('nameMsg'), pinMsg = $('pinMsg'), errorEl = $('loginError');
  const confirmBox = $('createConfirm'), actions = $('loginActions');
  const btnEnter = $('btnEnter'), btnCreate = $('btnCreate'), btnCancel = $('btnCreateCancel');
  const ime = trackComposition(name);
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  let pending = null;   // 확인 대기 중인 { name, pin }
  let working = false;

  function show(input, msgEl, problem) {
    msgEl.textContent = problem || '';
    msgEl.className = 'msg' + (problem ? ' bad' : '');
    input.setAttribute('aria-invalid', problem ? 'true' : 'false');
  }
  const checkName = final => { const p = nameProblem(name.value, { final }); show(name, nameMsg, p); return !p; };
  const checkPin = final => { const p = pinProblem(pin.value, { final }); show(pin, pinMsg, p); return !p; };

  function resetConfirm() {
    pending = null;
    confirmBox.hidden = true; actions.hidden = false;
  }

  /* 이름: 조합 중이면 검증을 건너뛰고, 조합이 끝나면(compositionend) 그때 검증 */
  on(name, 'input', e => {
    errorEl.textContent = '';
    if (pending) resetConfirm();
    if (ime.composing || e.isComposing) return;
    checkName(false);
  });
  on(name, 'compositionend', () => checkName(false));
  on(name, 'blur', () => { if (name.value) checkName(true); });

  on(pin, 'input', () => {
    errorEl.textContent = '';
    if (pending) resetConfirm();
    checkPin(false);
  });
  on(pin, 'blur', () => { if (pin.value) checkPin(true); });

  async function enter(create) {
    if (working) return;
    working = true;
    const button = create ? btnCreate : btnEnter;
    const label = button.textContent;
    button.disabled = true; button.textContent = create ? '만드는 중…' : '여는 중…';
    errorEl.textContent = '';
    try {
      const r = await api.enter(pending?.name ?? name.value, pending?.pin ?? pin.value, { create });
      if (r.created) toast('새 트리를 만들었어요! ✎ 꾸미기로 글귀와 사진을 걸어 보세요.', { ms: 4200 });
      onEnter(r);
    } catch (e) {
      const err = e instanceof TreeError ? e : new TreeError('unknown');
      if (err.code === 'not_found' && !create) {
        pending = { name: normalizeName(name.value), pin: pin.value };
        $('createText').textContent =
          `‘${pending.name}’ 이름과 이 PIN으로 된 트리가 없어요. 이 이름+PIN으로 새 트리를 만들까요?`;
        confirmBox.hidden = false; actions.hidden = true;
        btnCreate.focus();
      } else {
        errorEl.textContent = err.message;
        if (err.code === 'invalid_name') name.focus();
        else if (err.code === 'invalid_pin') pin.focus();
      }
    } finally {
      button.disabled = false; button.textContent = label;
      working = false;
    }
  }

  on(form, 'submit', e => {
    e.preventDefault();
    if (ime.composing) return;            // 조합을 확정하는 Enter로는 제출하지 않음
    const okName = checkName(true), okPin = checkPin(true);
    if (!okName) { name.focus(); return; }
    if (!okPin) { pin.focus(); return; }
    if (!isValidName(name.value)) { errorEl.textContent = ERROR_MESSAGES.invalid_name; return; }
    if (!isValidPin(pin.value)) { errorEl.textContent = ERROR_MESSAGES.invalid_pin; return; }
    enter(false);
  });
  on(btnCreate, 'click', () => enter(true));
  on(btnCancel, 'click', () => { resetConfirm(); pin.focus(); });
  on(form, 'keydown', e => { if (e.key === 'Escape' && pending) { resetConfirm(); pin.focus(); } });

  // 초기화 후 표시
  pin.value = ''; errorEl.textContent = '';
  show(name, nameMsg, null); show(pin, pinMsg, null);
  resetConfirm();
  form.hidden = false;
  // 모바일에서 자동 포커스는 키보드가 트리를 가려서 데스크톱에서만
  if (!matchMedia('(pointer: coarse)').matches) name.focus({ preventScroll: true });

  return {
    destroy() { ac.abort(); form.hidden = true; resetConfirm(); pin.value = ''; }
  };
}
