/**
 * 로그인 화면 — 이름 + PIN(숫자 4~10자리) + 이메일로 "내 트리 열기", 없으면 새로 만들지 확인
 *               + PIN을 잊었을 때 이메일로 복구 PIN을 받아 새 PIN 정하기
 *
 *  - 사용자 = (이름, 이메일). 이메일은 사람마다 달라서 동명이인과 겹치지 않는다.
 *    PIN은 "본인 확인용"이라 틀리면 새 트리를 만들지 않고 wrong_pin → [PIN을 잊었어요]로 안내한다.
 *  - 이메일은 PIN 복구 메일을 받는 주소다. 오타가 나면 복구할 수 없으니 새로 만들 때 주소를 한 번 더 보여 준다.
 *  - 이름 검증은 실시간. 단, 한글 조합 중(compositionstart~end)에는 메시지를 바꾸지 않는다.
 *    ("김" → "김ㅁ" → "김미" 처럼 조합 도중 값이 잠깐 자모가 되기 때문에 그대로 검증하면 메시지가 깜빡인다)
 *  - "너무 짧음"은 입력 중엔 띄우지 않고, 칸을 벗어나거나 제출할 때만 알린다.
 */
import { TreeError, normalizeName, normalizeEmail, isValidName, isValidEmail, isValidPin } from '../api.js';
import { $, trackComposition, toast } from './dom.js';
import { pendingSave } from './library.js';

const RESEND_SECONDS = 60;

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
function pinProblem(raw, { final, label = 'PIN' }) {
  const v = String(raw ?? '');
  if (/[^0-9]/.test(v)) return `${label}은 숫자만 입력해 주세요.`;
  if (!v) return final ? `${label}을 입력해 주세요. (숫자 4~10자리)` : null;
  if (v.length < 4) return final ? `${label}은 4자리 이상이에요.` : null;
  if (v.length > 10) return `${label}은 10자리까지예요.`;
  return null;
}
function emailProblem(raw, { final }) {
  const v = normalizeEmail(raw);
  if (!v) return final ? '이메일을 입력해 주세요. PIN을 잊었을 때 복구 메일을 받는 주소예요.' : null;
  if (/\s/.test(String(raw).trim())) return '이메일에는 공백을 넣을 수 없어요.';
  if (!final && !v.includes('@')) return null;
  if (!isValidEmail(v)) return final ? '이메일 주소를 확인해 주세요. (예: name@example.com)' : null;
  return null;
}
/** 남이 맞히기 쉬운 PIN인가 (막지는 않고 새로 만들 때 한 번 더 안내) */
export const easyPin = pin => /^(\d)\1+$/.test(pin)
  || '01234567890'.includes(pin) || '09876543210'.includes(pin)
  || /^(19|20)\d{2}$/.test(pin) || /^(19|20)?\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(pin);

/**
 * @param {{ api: import('../api.js').TreeApi, onEnter: (result) => void }} deps
 * @returns {{ destroy(): void }}
 */
export function mountLogin({ api, onEnter }) {
  const form = $('loginCard'), name = $('inName'), email = $('inEmail'), pin = $('inPin');
  const nameMsg = $('nameMsg'), emailMsg = $('emailMsg'), pinMsg = $('pinMsg'), errorEl = $('loginError');
  const confirmBox = $('createConfirm'), actions = $('loginActions');
  const btnEnter = $('btnEnter'), btnCreate = $('btnCreate'), btnCancel = $('btnCreateCancel'), btnForgot = $('btnForgot');
  const ime = trackComposition(name);
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  let pending = null;   // 확인 대기 중인 { name, email, pin }
  let working = false;

  function show(input, msgEl, problem) {
    msgEl.textContent = problem || '';
    msgEl.className = 'msg' + (problem ? ' bad' : '');
    input.setAttribute('aria-invalid', problem ? 'true' : 'false');
  }
  const checkName = final => { const p = nameProblem(name.value, { final }); show(name, nameMsg, p); return !p; };
  const checkEmail = final => { const p = emailProblem(email.value, { final }); show(email, emailMsg, p); return !p; };
  const checkPin = final => { const p = pinProblem(pin.value, { final }); show(pin, pinMsg, p); return !p; };

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

  on(pin, 'input', () => { changed(); checkPin(false); });
  on(pin, 'blur', () => { if (pin.value) checkPin(true); });
  on(email, 'input', () => { changed(); checkEmail(false); });
  on(email, 'blur', () => { if (email.value) checkEmail(true); });

  async function enter(create) {
    if (working) return;
    working = true;
    const button = create ? btnCreate : btnEnter;
    const label = button.textContent;
    button.disabled = true; button.textContent = create ? '만드는 중…' : '여는 중…';
    errorEl.textContent = '';
    const input = pending ?? { name: name.value, email: email.value, pin: pin.value };
    try {
      const r = await api.enter(input.name, input.email, input.pin, { create });
      if (r.created) toast('새 트리를 만들었어요! ✎ 꾸미기로 글귀와 사진을 걸어 보세요.', { ms: 4200 });
      onEnter(r);
    } catch (e) {
      const err = e instanceof TreeError ? e : new TreeError('unknown');
      if (err.code === 'not_found' && !create) {
        pending = { name: normalizeName(name.value), email: normalizeEmail(email.value), pin: pin.value };
        const tip = easyPin(pending.pin) ? ' 1234·생일처럼 쉬운 PIN은 남이 맞히기 쉬우니 다른 숫자를 권해요.' : '';
        $('createText').textContent =
          `‘${pending.name}’ · ${pending.email} 로 된 트리가 없어요. 새 트리를 만들까요? `
          + `이 이메일로 PIN 복구 메일이 가니 주소가 맞는지 한 번 더 확인해 주세요.${tip}`;
        confirmBox.hidden = false; actions.hidden = true;
        btnCreate.focus();
      } else if (err.code === 'wrong_pin') {
        errorEl.textContent = 'PIN이 맞지 않아요. 기억나지 않으면 [PIN을 잊었어요]로 이메일 복구를 할 수 있어요.';
        resetConfirm();
        pin.select(); pin.focus();
      } else {
        errorEl.textContent = err.message;
        if (err.code === 'invalid_name') name.focus();
        else if (err.code === 'invalid_email') email.focus();
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
    const okName = checkName(true), okPin = checkPin(true), okEmail = checkEmail(true);
    if (!okName) { name.focus(); return; }
    if (!okPin) { pin.focus(); return; }
    if (!okEmail) { email.focus(); return; }
    if (!isValidName(name.value)) return;
    enter(false);
  });
  on(btnCreate, 'click', () => enter(true));
  on(btnCancel, 'click', () => { resetConfirm(); email.focus(); });
  on(form, 'keydown', e => { if (e.key === 'Escape' && pending) { resetConfirm(); email.focus(); } });

  /* ── PIN 복구 ─────────────────────────────────────── */
  const recovery = mountRecovery({
    api, on,
    onDone: r => { toast('새 PIN으로 바꿨어요. 다른 기기는 로그아웃됐어요.', { ms: 4200 }); onEnter(r); },
    onBack: () => { form.hidden = false; pin.value = ''; pin.focus({ preventScroll: true }); }
  });
  on(btnForgot, 'click', () => {
    form.hidden = true;
    recovery.open({ name: name.value, email: email.value });
  });

  // 공유 보기에서 로그인 없이 [담기]를 누르고 온 경우 안내
  const note = $('loginNote'), pendingItem = pendingSave.peek();
  note.textContent = pendingItem ? `로그인하면 ‘${pendingItem.name}님의 트리’를 내 목록에 담아 둘게요.` : '';
  note.hidden = !pendingItem;

  // 초기화 후 표시
  pin.value = '';
  errorEl.textContent = '';
  show(name, nameMsg, null); show(email, emailMsg, null); show(pin, pinMsg, null);
  resetConfirm();
  form.hidden = false;
  // 모바일에서 자동 포커스는 키보드가 트리를 가려서 데스크톱에서만
  if (!matchMedia('(pointer: coarse)').matches) name.focus({ preventScroll: true });

  return {
    destroy() { ac.abort(); recovery.close(); form.hidden = true; resetConfirm(); pin.value = ''; }
  };
}

/**
 * PIN 복구 카드 — ① 이름·이메일 → [복구 PIN 보내기] ② 메일의 복구 PIN + 새 PIN → [PIN 바꾸고 트리 열기]
 * 메일을 보낸 뒤에는 이메일 칸을 잠근다(다른 주소로 보내려면 [← 로그인으로] 후 다시).
 */
function mountRecovery({ api, on, onDone, onBack }) {
  const card = $('recoverCard'), rcName = $('rcName'), rcEmail = $('rcEmail'), step2 = $('rcStep2');
  const rcCode = $('rcCode'), rcPin = $('rcPin'), rcPin2 = $('rcPin2'), rcSent = $('rcSent'), rcError = $('rcError');
  const btnMain = $('btnRecover'), btnResend = $('btnResend'), btnBack = $('btnRecoverBack');
  let sentTo = null, timer = 0, working = false;

  const fail = (msg, input) => { rcError.textContent = msg; input?.focus(); return false; };

  function setStep(sent) {
    sentTo = sent;
    step2.hidden = !sent;
    rcEmail.readOnly = !!sent;
    btnResend.hidden = !sent;
    rcCode.disabled = false; rcCode.placeholder = '12345678';
    btnMain.textContent = sent ? 'PIN 바꾸고 트리 열기' : '복구 PIN 보내기';
  }
  function cooldown() {
    clearInterval(timer);
    let left = RESEND_SECONDS;
    const tick = () => {
      btnResend.disabled = left > 0;
      btnResend.textContent = left > 0 ? `다시 보내기 (${left}초)` : '메일 다시 보내기';
      if (left-- <= 0) { clearInterval(timer); timer = 0; }
    };
    tick(); timer = setInterval(tick, 1000);
  }

  async function run(button, busyLabel, fn) {
    if (working) return;
    working = true;
    const label = button.textContent;
    button.disabled = true; button.textContent = busyLabel;
    rcError.textContent = '';
    try { await fn(); }
    catch (e) { rcError.textContent = (e instanceof TreeError ? e : new TreeError('unknown')).message; }
    finally {
      working = false;
      if (button.textContent === busyLabel) button.textContent = label;
      button.disabled = button === btnResend && !!timer;   // 다시 보내기는 60초 동안 잠금
      if (!card.hidden && (document.activeElement === document.body || !document.activeElement)) {
        (button.disabled ? btnMain : button).focus({ preventScroll: true });   // 포커스를 잃지 않게
      }
    }
  }

  const finalNameProblem = () => nameProblem(rcName.value, { final: true });

  async function send() {
    const e = normalizeEmail(rcEmail.value);
    if (finalNameProblem()) return fail(finalNameProblem(), rcName);
    if (!isValidEmail(e)) return fail('이메일 주소를 확인해 주세요. (예: name@example.com)', rcEmail);
    await api.sendRecovery(e);
    setStep(e);
    rcSent.textContent = `${e} 로 복구 PIN을 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요.`;
    cooldown();
    rcCode.focus();
  }

  async function reset() {
    if (finalNameProblem()) return fail(finalNameProblem(), rcName);
    if (!api.recoveryVerified && !/^[0-9]{6,10}$/.test(rcCode.value.replace(/\s/g, ''))) {
      return fail('메일로 받은 숫자(6~10자리)를 입력해 주세요.', rcCode);
    }
    const p = pinProblem(rcPin.value, { final: true, label: '새 PIN' });
    if (p) return fail(p, rcPin);
    if (rcPin.value !== rcPin2.value) return fail('새 PIN 확인이 일치하지 않아요.', rcPin2);
    try {
      const r = await api.resetPin(rcName.value, sentTo, rcCode.value, rcPin.value);
      close();
      onDone(r);
    } catch (e) {
      if (e?.code === 'not_found' && api.recoveryVerified) {
        // 메일 확인은 끝났고 이름만 다름 → 복구 PIN은 다시 받지 않아도 된다
        rcCode.value = ''; rcCode.disabled = true; rcCode.placeholder = '메일 확인 완료';
        return fail('이 이메일로 그 이름의 트리가 없어요. 트리를 만들 때 쓴 이름으로 고쳐서 다시 눌러 주세요.', rcName);
      }
      if (e?.code === 'email_unverified') { setStep(null); rcSent.textContent = ''; }
      if (e?.code === 'otp_invalid') { rcCode.select(); rcCode.focus(); }
      throw e;
    }
  }

  on(card, 'submit', e => {
    e.preventDefault();
    if (sentTo) run(btnMain, '바꾸는 중…', reset);
    else run(btnMain, '보내는 중…', send);
  });
  on(btnResend, 'click', () => run(btnResend, '보내는 중…', send));
  on(btnBack, 'click', () => { close(); onBack(); });
  // 버튼이 잠깐 disabled되면 포커스가 body로 빠지므로 카드가 아니라 문서 전체에서 Esc를 받는다
  on(document, 'keydown', e => { if (e.key === 'Escape' && !card.hidden) { close(); onBack(); } });
  on(rcCode, 'input', () => { rcError.textContent = ''; });

  function open({ name = '', email = '' } = {}) {
    rcName.value = name; rcEmail.value = email.trim();
    rcCode.value = ''; rcPin.value = ''; rcPin2.value = ''; rcError.textContent = ''; rcSent.textContent = '';
    setStep(null);
    card.hidden = false;
    (rcName.value ? (rcEmail.value ? btnMain : rcEmail) : rcName).focus({ preventScroll: true });
  }
  function close() {
    clearInterval(timer); timer = 0;
    card.hidden = true;
    rcCode.value = ''; rcPin.value = ''; rcPin2.value = '';
    setStep(null);
  }
  return { open, close };
}
