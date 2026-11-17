/**
 * 내 트리 (편집 모드)
 *  - 트리 배경 위에 편집 패널: 기본(제목·무늬·설정) / 글귀 / 사진 / 공유·계정
 *  - 제목·무늬·설정 변경은 800ms debounce 후 updateTree 한 번으로 저장
 *  - DB 접근은 TreeApi만 사용. unauthorized가 나면 onUnauthorized()로 로그인 화면에 보냄
 */
import { TreeError, isValidPassword } from '../api.js';
import { $, h, toast, busy, trackComposition, isImeEnter, confirmButton } from './dom.js';

const SAVE_DELAY = 800;
const MAX_MESSAGES = 50, MAX_PHOTOS = 30;
export const DEFAULT_SETTINGS = { autoRotate: true, patternCycle: true, characters: true };

/** 공유 링크: 현재 주소에서 쿼리·해시를 빼고 ?t=share_id */
export function shareUrlFor(shareId) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('t', shareId);
  return u.toString();
}

/**
 * @param {{ api, tree, data, onLogout: () => void, onUnauthorized: () => void, refreshNotice: () => void }} deps
 */
export function mountEditor({ api, tree, data, onLogout, onUnauthorized, refreshNotice }) {
  const ac = new AbortController(), on = (el, ev, fn, o = {}) => el.addEventListener(ev, fn, { signal: ac.signal, ...o });
  const treeId = data.id;   // 지금 편집 중인 트리 (사용자당 최대 3개)
  const state = {
    title: data.title,
    pattern: data.pattern,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    messages: [...data.messages],
    photos: [...data.photos]
  };
  let destroyed = false;

  /** API 호출 공통 처리: unauthorized → 로그인 화면, 그 밖의 오류는 throw */
  async function call(fn) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof TreeError && e.code === 'unauthorized') {
        if (!destroyed) { toast(e.message, { error: true }); onUnauthorized(); }
        throw Object.assign(e, { handled: true });
      }
      throw e;
    }
  }
  const errMsg = e => (e instanceof TreeError ? e : new TreeError('unknown')).message;

  /* =========================================================
   *  패널 열기/닫기 · 탭 · 포커스
   * ========================================================= */
  const panel = $('editPanel'), btnEdit = $('btnEdit');
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  let opener = null;

  function selectTab(tab, focus = false) {
    for (const t of tabs) {
      const sel = t === tab;
      t.setAttribute('aria-selected', String(sel));
      t.tabIndex = sel ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !sel;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((t, i) => {
    on(t, 'click', () => selectTab(t));
    on(t, 'keydown', e => {   // 방향키로 탭 이동 (WAI-ARIA 탭 패턴)
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Home') { e.preventDefault(); selectTab(tabs[0], true); }
      else if (e.key === 'End') { e.preventDefault(); selectTab(tabs[tabs.length - 1], true); }
      else if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  function openPanel(tabId) {
    opener = document.activeElement;
    if (tabId) selectTab($(tabId));
    panel.hidden = false;
    btnEdit.setAttribute('aria-expanded', 'true');
    document.dispatchEvent(new CustomEvent('editpanel:open'));   // 좁은 화면이면 사이드 목록이 접힘
    const pane = panel.querySelector('.pane:not([hidden])');
    (pane.querySelector('input:not([readonly]), button') || panel.querySelector('[aria-selected="true"]'))
      .focus({ preventScroll: true });
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    btnEdit.setAttribute('aria-expanded', 'false');
    flushSave();
    (opener && document.contains(opener) ? opener : btnEdit).focus({ preventScroll: true });
  }
  const isOpen = () => !panel.hidden;

  on(btnEdit, 'click', () => (isOpen() ? closePanel() : openPanel()));
  on(document, 'library:open', () => { if (isOpen() && innerWidth < 1100) closePanel(); });
  on($('btnEditClose'), 'click', closePanel);
  on(document, 'keydown', e => {
    if (e.key === 'Escape' && isOpen() && !tree.viewing && !e.defaultPrevented) { e.preventDefault(); closePanel(); }
  });

  /* =========================================================
   *  기본: 제목 · 무늬 · 설정 (debounce 저장)
   * ========================================================= */
  const saveState = $('saveState');
  let pendingSave = {}, saveTimer = null, saving = Promise.resolve();
  const setSaveState = (text, bad = false) => { saveState.textContent = text; saveState.classList.toggle('bad', bad); };

  function queueSave(patch) {
    Object.assign(pendingSave, patch);
    setSaveState('저장 대기…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY);
  }
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    const patch = pendingSave; pendingSave = {};
    if (!Object.keys(patch).length) return saving;
    setSaveState('저장 중…');
    saving = saving.then(() => call(() => api.updateTree(patch, treeId)))
      .then(() => {
        if (!Object.keys(pendingSave).length) setSaveState('저장됨');
        // 사이드 목록(내 트리)의 이름·무늬 표시를 맞춤
        document.dispatchEvent(new CustomEvent('tree:updated', { detail: { id: treeId, ...patch } }));
      })
      .catch(e => { if (!e.handled) setSaveState(errMsg(e), true); });
    return saving;
  }

  // 제목
  const edTitle = $('edTitle'), titleMsg = $('edTitleMsg'), titleCount = $('edTitleCount');
  const titleIme = trackComposition(edTitle);
  edTitle.value = state.title;
  const updateTitleCount = () => { titleCount.textContent = `${[...edTitle.value].length}/30`; };
  updateTitleCount();
  function onTitle() {
    updateTitleCount();
    const v = edTitle.value.trim();
    tree.setTitle(v || ' ');
    if (titleIme.composing) return;   // 조합 중에는 검증·저장 보류
    if (!v) { titleMsg.textContent = '제목을 비워 둘 수 없어요.'; titleMsg.className = 'msg bad'; edTitle.setAttribute('aria-invalid', 'true'); return; }
    titleMsg.textContent = ''; edTitle.setAttribute('aria-invalid', 'false');
    if (v !== state.title) { state.title = v; queueSave({ title: v }); }
  }
  on(edTitle, 'input', onTitle);
  on(edTitle, 'compositionend', onTitle);
  on(edTitle, 'blur', () => { if (!edTitle.value.trim()) { edTitle.value = state.title; onTitle(); } });

  // 무늬
  const choices = $('patternChoices');
  const patternButtons = tree.patterns.map((name, i) =>
    h('button', { type: 'button', text: name, 'aria-pressed': String(i === state.pattern),
                  onclick: () => choosePattern(i) }));
  choices.replaceChildren(...patternButtons);
  function markPattern(i) { patternButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); }
  function choosePattern(i) {
    tree.setPattern(i);
    markPattern(i);
    if (i !== state.pattern) { state.pattern = i; queueSave({ pattern: i }); }
  }

  // 설정
  const edAuto = $('edAutoRotate'), edCycle = $('edPatternCycle'), edChars = $('edCharacters');
  edAuto.checked = state.settings.autoRotate; edCycle.checked = state.settings.patternCycle;
  edChars.checked = state.settings.characters !== false;
  function onSettings() {
    state.settings = { ...state.settings, autoRotate: edAuto.checked, patternCycle: edCycle.checked, characters: edChars.checked };
    tree.setSettings(state.settings);
    queueSave({ settings: state.settings });
  }
  on(edAuto, 'change', onSettings);
  on(edCycle, 'change', onSettings);
  on(edChars, 'change', onSettings);

  // 사이드 목록에서 이 트리의 이름을 바꾸면 제목 칸·트리 제목도 맞춤
  on(document, 'tree:renamed', e => {
    if (e.detail.id !== treeId) return;
    state.title = e.detail.title; edTitle.value = e.detail.title; updateTitleCount(); tree.setTitle(e.detail.title);
  });

  // 도구 막대의 [무늬 바꾸기]는 내 트리에서는 "다음 무늬로 바꾸고 저장"
  on($('btnPattern'), 'click', () => choosePattern((tree.pattern + 1) % tree.patterns.length));

  /* =========================================================
   *  글귀
   * ========================================================= */
  const edMsg = $('edMsg'), msgCount = $('edMsgCount'), msgError = $('msgError');
  const msgList = $('msgList'), msgEmpty = $('msgEmpty'), msgTotal = $('msgTotal'), btnAddMsg = $('btnAddMsg');
  const updateMsgCount = () => { msgCount.textContent = `${[...edMsg.value].length}/100`; };

  function renderMessages() {
    msgList.replaceChildren(...state.messages.map(m => {
      const del = h('button', { type: 'button', className: 'danger', text: '삭제', 'aria-label': `글귀 삭제: ${m.body}` });
      on(del, 'click', () => removeMessage(m, del));
      return h('li', {}, h('span', { className: 'text', text: m.body }), del);
    }));
    msgEmpty.hidden = state.messages.length > 0;
    msgTotal.textContent = `${state.messages.length}/${MAX_MESSAGES}`;
    btnAddMsg.disabled = state.messages.length >= MAX_MESSAGES;
    tree.setMessages(state.messages.map(m => m.body));
    refreshNotice(state);
  }

  async function addMessage() {
    const body = edMsg.value.trim();
    msgError.textContent = '';
    if (!body) { msgError.textContent = '글귀를 입력해 주세요.'; edMsg.focus(); return; }
    if ([...body].length > 100) { msgError.textContent = '글귀는 100자까지예요.'; return; }
    try {
      const m = await busy(btnAddMsg, '추가 중…', () => call(() => api.addMessage(body, treeId)));
      state.messages.push(m);
      edMsg.value = ''; updateMsgCount();
      renderMessages();
      edMsg.focus();
    } catch (e) { if (!e.handled) msgError.textContent = errMsg(e); }
  }
  async function removeMessage(m, button) {
    msgError.textContent = '';
    try {
      await busy(button, '삭제 중…', () => call(() => api.deleteMessage(m.id)));
      state.messages = state.messages.filter(x => x.id !== m.id);
      renderMessages();
      (msgList.querySelector('button') || edMsg).focus();
    } catch (e) { if (!e.handled) msgError.textContent = errMsg(e); }
  }
  on(edMsg, 'input', () => { updateMsgCount(); msgError.textContent = ''; });
  on(edMsg, 'keydown', e => { if (e.key === 'Enter' && !isImeEnter(e)) { e.preventDefault(); addMessage(); } });
  on(btnAddMsg, 'click', addMessage);

  /* =========================================================
   *  사진
   * ========================================================= */
  const photoGrid = $('photoGrid'), photoEmpty = $('photoEmpty'), photoTotal = $('photoTotal');
  const photoInput = $('photoInput'), btnUpload = $('btnUpload'), uploadState = $('uploadState'), edCaption = $('edCaption');
  let uploading = false;

  function photoCard(p) {
    const del = h('button', { type: 'button', text: '삭제', 'aria-label': `사진 삭제${p.caption ? ': ' + p.caption : ''}` });
    confirmButton(del, '정말 삭제?', () => removePhoto(p, del));
    return h('li', { dataset: { id: String(p.id) } },
      h('img', { src: api.photoUrl(p.path), alt: p.caption || '트리 사진', loading: 'lazy', decoding: 'async' }),
      h('span', { className: 'cap', text: p.caption || ' ' }),
      del);
  }
  function renderPhotos() {
    photoGrid.replaceChildren(...state.photos.map(photoCard));
    photoEmpty.hidden = state.photos.length > 0;
    photoTotal.textContent = `${state.photos.length}/${MAX_PHOTOS}`;
    btnUpload.disabled = uploading || state.photos.length >= MAX_PHOTOS;
    refreshNotice(state);
  }

  const STEP = { resize: '줄이는 중…', upload: '올리는 중…', save: '저장 중…' };
  async function upload(files) {
    if (!files.length) return;
    uploading = true; btnUpload.disabled = true;
    const caption = edCaption.value.trim().slice(0, 30);
    let ok = 0, failed = 0, lastError = '';
    for (let i = 0; i < files.length && !destroyed; i++) {
      const prefix = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
      uploadState.className = 'msg';
      try {
        const p = await call(() => api.uploadPhoto(files[i], caption, step => { uploadState.textContent = prefix + STEP[step]; }, treeId));
        state.photos.push(p); ok++;
        renderPhotos();
        tree.addPhoto(api.photoUrl(p.path), p.caption, { id: p.id, show: 'sparkle' }).catch(() => {});
      } catch (e) {
        if (e.handled) return;
        failed++; lastError = errMsg(e);
        if (e.code === 'limit_reached') break;
      }
    }
    uploading = false;
    renderPhotos();
    if (failed) { uploadState.textContent = `${ok}장 올림, ${failed}장 실패 — ${lastError}`; uploadState.className = 'msg error'; }
    else { uploadState.textContent = `${ok}장을 올렸어요.`; uploadState.className = 'msg good'; edCaption.value = ''; }
  }
  async function removePhoto(p, button) {
    uploadState.textContent = '';
    try {
      await busy(button, '삭제 중…', () => call(() => api.deletePhoto(p.id)));
      state.photos = state.photos.filter(x => x.id !== p.id);
      tree.removePhoto(p.id);
      renderPhotos();
      uploadState.textContent = '사진을 삭제했어요.'; uploadState.className = 'msg good';
      (photoGrid.querySelector('button') || btnUpload).focus();
    } catch (e) { if (!e.handled) { uploadState.textContent = errMsg(e); uploadState.className = 'msg error'; } }
  }
  on(btnUpload, 'click', () => photoInput.click());
  on(photoInput, 'change', () => { const files = [...photoInput.files]; photoInput.value = ''; upload(files); });

  /* =========================================================
   *  공유 · 계정
   * ========================================================= */
  const link = shareUrlFor(data.share_id);
  const shareInput = $('shareUrl'), copyState = $('copyState');
  shareInput.value = link;
  $('shareOpen').href = link;
  $('whoami').textContent = `${data.name}님으로 로그인됨`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      copyState.textContent = '링크를 복사했어요.'; copyState.className = 'msg good';
      return true;
    } catch {
      // 클립보드 권한이 없거나 http 환경: 직접 선택해서 복사하도록
      copyState.textContent = '자동 복사가 안 돼요. 위 링크를 길게 눌러(또는 Ctrl+C) 복사해 주세요.'; copyState.className = 'msg bad';
      shareInput.focus(); shareInput.select();
      return false;
    }
  }
  on($('btnCopy'), 'click', copyLink);
  on(shareInput, 'focus', () => shareInput.select());
  on($('btnShare'), 'click', async () => {
    if (await copyLink()) toast('공유 링크를 복사했어요. 받은 사람은 읽기만 할 수 있어요.');
    else { openPanel('tab-account'); shareInput.select(); }
  });

  const pwForm = $('pwForm'), pwState = $('pwState');
  on(pwForm, 'submit', async e => {
    e.preventDefault();
    const oldPw = $('pwOld').value, newPw = $('pwNew').value, newPw2 = $('pwNew2').value;
    pwState.className = 'msg bad';
    if (!oldPw) { pwState.textContent = '현재 비밀번호를 입력해 주세요.'; $('pwOld').focus(); return; }
    if (!isValidPassword(newPw)) { pwState.textContent = '새 비밀번호는 6~64자로 입력해 주세요.'; $('pwNew').focus(); return; }
    if (newPw !== newPw2) { pwState.textContent = '새 비밀번호 확인이 일치하지 않아요.'; $('pwNew2').focus(); return; }
    if (newPw === oldPw) { pwState.textContent = '지금 비밀번호와 다른 비밀번호를 골라 주세요.'; $('pwNew').focus(); return; }
    try {
      await busy($('btnPw'), '바꾸는 중…', () => call(() => api.changePassword(oldPw, newPw)));
      pwForm.reset();
      pwState.textContent = '비밀번호를 바꿨어요. 다른 기기는 로그아웃됐어요.'; pwState.className = 'msg good';
    } catch (e2) { if (!e2.handled) pwState.textContent = errMsg(e2); }
  });

  on($('btnLogout'), 'click', async () => {
    await flushSave();
    try { await busy($('btnLogout'), '로그아웃 중…', () => api.logout()); } catch { /* 토큰은 지워짐 */ }
    toast('로그아웃했어요.');
    onLogout();
  });

  // 창을 닫을 때 남은 저장 보내기 (응답은 기다리지 못함)
  on(window, 'pagehide', () => flushSave());

  /* ---------- 처음 그리기 ---------- */
  selectTab(tabs[0]);
  renderMessages();
  renderPhotos();
  setSaveState('');
  uploadState.textContent = ''; copyState.textContent = ''; pwState.textContent = ''; msgError.textContent = '';
  updateMsgCount();

  return {
    get state() { return state; },
    flush: flushSave,
    destroy() {
      destroyed = true;
      ac.abort();
      clearTimeout(saveTimer);
      panel.hidden = true;
      btnEdit.setAttribute('aria-expanded', 'false');
    }
  };
}
