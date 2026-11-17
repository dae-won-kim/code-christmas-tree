/**
 * 로그인 화면 — 이름 + 생년월일(6자리) + 비밀번호로 "내 트리 열기", 없으면 새로 만들지 확인
 *
 *  - 사용자는 (이름, 생년월일, 비밀번호) 세 가지가 모두 같아야 같은 사람이다.
 *    그래서 동명이인이 같은 비밀번호를 고르면 생년월일까지 같지 않는 한 겹치지 않지만,
 *    셋이 모두 같으면 같은 트리로 열린다 → 화면에 항상 안내하고, 새로 만들 때 한 번 더 알린다.
 *  - 이름 검증은 실시간. 단, 한글 조합 중(compositionstart~end)에는 메시지를 바꾸지 않는다.
 *    ("김" → "김ㅁ" → "김미" 처럼 조합 도중 값이 잠깐 자모가 되기 때문에 그대로 검증하면 메시지가 깜빡인다)
 *  - "너무 짧음"은 입력 중엔 띄우지 않고, 칸을 벗어나거나 제출할 때만 알린다.
 */
import { TreeError, normalizeName, isValidName, isValidBirth, isValidPassword } from '../api.js';
import { $, trackComposition, toast } from './dom.js';
import { pendingSave } from './library.js';

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
function birthProblem(raw, { final }) {
  const v = String(raw || '');
  if (/[^0-9]/.test(v)) return '생년월일은 숫자만 입력해 주세요. (예: 990101)';
  if (!v) return final ? '생년월일 6자리를 입력해 주세요. (예: 990101)' : null;
  if (v.length < 6) return final ? '생년월일은 6자리예요. (예: 990101)' : null;
  if (!isValidBirth(v)) return '없는 날짜예요. 월(01~12)과 일을 확인해 주세요.';
  return null;
}
function passwordProblem(raw, { final }) {
  const v = String(raw ?? '');
  if (!v) return final ? '비밀번호를 입력해 주세요.' : null;
  if ([...v].length > 64) return '비밀번호는 64자까지예요.';
  if ([...v].length < 6) return final ? '비밀번호는 6자 이상이에요.' : null;
  if (!isValidPassword(v)) return '비밀번호에 쓸 수 없는 문자가 있어요.';
  return null;
}
/** 겹치기 쉬운 비밀번호인가 (막지는 않고 새로 만들 때 한 번 더 안내) */
const weakPassword = pw => /^[0-9]+$/.test(pw) || [...pw].length < 8 || /^(.)\1+$/.test(pw)
  || /^(123456|password|qwerty|111111|000000)/i.test(pw);

/**
 * @param {{ api: import('../api.js').TreeApi, onEnter: (result) => void }} deps
 * @returns {{ destroy(): void }}
 */
export function mountLogin({ api, onEnter }) {
  const form = $('loginCard'), name = $('inName'), birth = $('inBirth'), pw = $('inPassword');
  const nameMsg = $('nameMsg'), birthMsg = $('birthMsg'), pwMsg = $('pwMsg'), errorEl = $('loginError');
  const confirmBox = $('createConfirm'), actions = $('loginActions'), showPw = $('btnShowPw');
  const btnEnter = $('btnEnter'), btnCreate = $('btnCreate'), btnCancel = $('btnCreateCancel');
  const ime = trackComposition(name);
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  let pending = null;   // 확인 대기 중인 { name, birth, password }
  let working = false;

  function show(input, msgEl, problem) {
    msgEl.textContent = problem || '';
    msgEl.className = 'msg' + (problem ? ' bad' : '');
    input.setAttribute('aria-invalid', problem ? 'true' : 'false');
  }
  const checkName = final => { const p = nameProblem(name.value, { final }); show(name, nameMsg, p); return !p; };
  const checkBirth = final => { const p = birthProblem(birth.value, { final }); show(birth, birthMsg, p); return !p; };
  const checkPw = final => { const p = passwordProblem(pw.value, { final }); show(pw, pwMsg, p); return !p; };

  function resetConfirm() {
    pending = null;
    confirmBox.hidden = true; actions.hidden = false;
  }
  const changed = () => { errorEl.textContent = ''; if (pending) resetConfirm(); };

  /* 이름: 조합 중이면 검증을 건너뛰고, 조합이 끝나면(compositionend) 그때 검증 */
  on(name, 'input', e => {
    changed();
    if (ime.composing || e.isComposing) return;
    checkName(false);
  });
  on(name, 'compositionend', () => checkName(false));
  on(name, 'blur', () => { if (name.value) checkName(true); });

  on(birth, 'input', () => { changed(); checkBirth(false); });
  on(birth, 'blur', () => { if (birth.value) checkBirth(true); });
  on(pw, 'input', () => { changed(); checkPw(false); });
  on(pw, 'blur', () => { if (pw.value) checkPw(true); });

  on(showPw, 'click', () => {
    const visible = pw.type === 'password';
    pw.type = visible ? 'text' : 'password';
    showPw.textContent = visible ? '숨기기' : '보기';
    showPw.setAttribute('aria-pressed', String(visible));
    showPw.setAttribute('aria-label', visible ? '비밀번호 숨기기' : '비밀번호 보기');
  });

  async function enter(create) {
    if (working) return;
    working = true;
    const button = create ? btnCreate : btnEnter;
    const label = button.textContent;
    button.disabled = true; button.textContent = create ? '만드는 중…' : '여는 중…';
    errorEl.textContent = '';
    const input = pending ?? { name: name.value, birth: birth.value, password: pw.value };
    try {
      const r = await api.enter(input.name, input.birth, input.password, { create });
      if (r.created) toast('새 트리를 만들었어요! ✎ 꾸미기로 글귀와 사진을 걸어 보세요.', { ms: 4200 });
      onEnter(r);
    } catch (e) {
      const err = e instanceof TreeError ? e : new TreeError('unknown');
      if (err.code === 'not_found' && !create) {
        pending = { name: normalizeName(name.value), birth: birth.value, password: pw.value };
        const tip = weakPassword(pending.password)
          ? ' 숫자로만 되거나 짧은 비밀번호는 동명이인과 겹치기 쉬워요. 더 길고 나만 아는 비밀번호를 권해요.'
          : '';
        $('createText').textContent =
          `‘${pending.name}’(${pending.birth}) 이름과 이 비밀번호로 된 트리가 없어요. 새 트리를 만들까요?${tip}`;
        confirmBox.hidden = false; actions.hidden = true;
        btnCreate.focus();
      } else {
        errorEl.textContent = err.message;
        if (err.code === 'invalid_name') name.focus();
        else if (err.code === 'invalid_birth') birth.focus();
        else if (err.code === 'invalid_password') pw.focus();
      }
    } finally {
      button.disabled = false; button.textContent = label;
      working = false;
    }
  }

  on(form, 'submit', e => {
    e.preventDefault();
    if (ime.composing) return;            // 조합을 확정하는 Enter로는 제출하지 않음
    const okName = checkName(true), okBirth = checkBirth(true), okPw = checkPw(true);
    if (!okName) { name.focus(); return; }
    if (!okBirth) { birth.focus(); return; }
    if (!okPw) { pw.focus(); return; }
    if (!isValidName(name.value)) return;
    enter(false);
  });
  on(btnCreate, 'click', () => enter(true));
  on(btnCancel, 'click', () => { resetConfirm(); pw.focus(); });
  on(form, 'keydown', e => { if (e.key === 'Escape' && pending) { resetConfirm(); pw.focus(); } });

  // 공유 보기에서 로그인 없이 [담기]를 누르고 온 경우 안내
  const note = $('loginNote'), pendingItem = pendingSave.peek();
  note.textContent = pendingItem ? `로그인하면 ‘${pendingItem.name}님의 트리’를 내 목록에 담아 둘게요.` : '';
  note.hidden = !pendingItem;

  // 초기화 후 표시
  pw.value = ''; pw.type = 'password'; showPw.textContent = '보기'; showPw.setAttribute('aria-pressed', 'false');
  errorEl.textContent = '';
  show(name, nameMsg, null); show(birth, birthMsg, null); show(pw, pwMsg, null);
  resetConfirm();
  form.hidden = false;
  // 모바일에서 자동 포커스는 키보드가 트리를 가려서 데스크톱에서만
  if (!matchMedia('(pointer: coarse)').matches) name.focus({ preventScroll: true });

  return {
    destroy() { ac.abort(); form.hidden = true; resetConfirm(); pw.value = ''; }
  };
}
