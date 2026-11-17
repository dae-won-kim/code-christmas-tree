/**
 * 내 트리 (편집 모드)
 *  - 트리 배경 위에 편집 패널: 기본(제목·무늬·설정) / 장식 / 글귀 / 사진 / 공유·계정
 *  - 제목·무늬·설정 변경은 800ms debounce 후 updateTree 한 번으로 저장
 *  - 장식은 트리를 직접 눌러 달고 끌어 옮김 → 800ms debounce 후 setDecorations로 목록 전체 저장
 *  - 사진 캡션은 사진마다 바로 고침 (입력을 멈추거나 칸을 벗어나면 저장)
 *  - DB 접근은 TreeApi만 사용. unauthorized가 나면 onUnauthorized()로 로그인 화면에 보냄
 */
import { TreeError, isValidPin } from '../api.js';
import { $, h, toast, busy, trackComposition, isImeEnter, confirmButton } from './dom.js';
import { ORNAMENTS, DECOR_COLORS, MAX_DECOR } from '../tree/decor.js';

const SAVE_DELAY = 800;
const MAX_MESSAGES = 50, MAX_PHOTOS = 30;
export const DEFAULT_SETTINGS = { autoRotate: true, patternCycle: true, characters: true, gifts: true };

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
    photos: data.photos.map(p => ({ ...p })),
    decorations: data.decorations ?? null    // null = 기본 장식
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
    syncDecorMode();
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
    syncDecorMode();
    document.dispatchEvent(new CustomEvent('editpanel:open'));   // 좁은 화면이면 사이드 목록이 접힘
    const pane = panel.querySelector('.pane:not([hidden])');
    (pane.querySelector('input:not([readonly]), button') || panel.querySelector('[aria-selected="true"]'))
      .focus({ preventScroll: true });
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    btnEdit.setAttribute('aria-expanded', 'false');
    syncDecorMode();
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
    flushCaptions();
    const decorDone = flushDecor();
    clearTimeout(saveTimer); saveTimer = null;
    const patch = pendingSave; pendingSave = {};
    if (!Object.keys(patch).length) return Promise.all([saving, decorDone]);
    setSaveState('저장 중…');
    saving = saving.then(() => call(() => api.updateTree(patch, treeId)))
      .then(() => {
        if (!Object.keys(pendingSave).length) setSaveState('저장됨');
        // 사이드 목록(내 트리)의 이름·무늬 표시를 맞춤
        document.dispatchEvent(new CustomEvent('tree:updated', { detail: { id: treeId, ...patch } }));
      })
      .catch(e => { if (!e.handled) setSaveState(errMsg(e), true); });
    return Promise.all([saving, decorDone]);
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
  const edAuto = $('edAutoRotate'), edCycle = $('edPatternCycle'), edChars = $('edCharacters'), edGifts = $('edGifts');
  edAuto.checked = state.settings.autoRotate; edCycle.checked = state.settings.patternCycle;
  edChars.checked = state.settings.characters !== false;
  edGifts.checked = state.settings.gifts !== false;
  function onSettings() {
    state.settings = { ...state.settings, autoRotate: edAuto.checked, patternCycle: edCycle.checked,
                       characters: edChars.checked, gifts: edGifts.checked };
    tree.setSettings(state.settings);
    queueSave({ settings: state.settings });
  }
  on(edAuto, 'change', onSettings);
  on(edCycle, 'change', onSettings);
  on(edChars, 'change', onSettings);
  on(edGifts, 'change', onSettings);

  // 사이드 목록에서 이 트리의 이름을 바꾸면 제목 칸·트리 제목도 맞춤
  on(document, 'tree:renamed', e => {
    if (e.detail.id !== treeId) return;
    state.title = e.detail.title; edTitle.value = e.detail.title; updateTitleCount(); tree.setTitle(e.detail.title);
  });

  // 도구 막대의 [무늬 바꾸기]는 내 트리에서는 "다음 무늬로 바꾸고 저장"
  on($('btnPattern'), 'click', () => choosePattern((tree.pattern + 1) % tree.patterns.length));

  /* =========================================================
   *  장식: 종류·색을 고르고 트리를 눌러 달기, 끌어서 옮기기, 밖으로 끌어내 떼기
   * ========================================================= */
  const decorTotal = $('decorTotal'), decorState = $('decorState');
  const btnDecorAdd = $('btnDecorAdd'), btnDecorRemove = $('btnDecorRemove');
  const brush = { kind: ORNAMENTS[0].k, color: 0 };
  let decorPending, decorTimer = null, decorSaving = Promise.resolve();   // decorPending: undefined = 저장할 것 없음

  const kindButtons = ORNAMENTS.map(o => h('button', {
    type: 'button', 'aria-pressed': String(o.k === brush.kind), 'aria-label': `${o.name} 달기`, dataset: { k: o.k },
    onclick: () => { brush.kind = o.k; markBrush(); tree.setDecorEditing(decorMode ? { kind: brush.kind } : null); }
  }, h('span', { className: 'ico', 'aria-hidden': 'true', text: o.icon }), h('span', { text: o.name })));
  $('decorKinds').replaceChildren(...kindButtons);
  const colorButtons = DECOR_COLORS.map(([name, hex], i) => {
    const b = h('button', {
      type: 'button', 'aria-pressed': String(i === brush.color), 'aria-label': `${name}색`, title: name,
      onclick: () => {
        brush.color = i; markBrush();
        if (decorMode) { tree.setDecorEditing({ color: i }); tree.recolorSelectedDecor(i); }
      }
    });
    b.style.setProperty('--swatch', hex);   // style 속성 문자열은 CSP(style-src)에 막히므로 CSSOM으로
    return b;
  });
  $('decorColors').replaceChildren(...colorButtons);
  function markBrush() {
    kindButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === brush.kind)));
    colorButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === brush.color)));
  }

  function renderDecorCount() {
    const n = tree.decorations.length;
    decorTotal.textContent = `${n}/${MAX_DECOR}` + (tree.decorationsAreDefault ? ' · 기본 장식' : '');
    btnDecorAdd.disabled = n >= MAX_DECOR;
  }
  function queueDecorSave(list) {
    state.decorations = list;
    decorPending = list;
    decorState.textContent = ''; decorState.className = 'msg';
    renderDecorCount();
    setSaveState('저장 대기…');
    clearTimeout(decorTimer);
    decorTimer = setTimeout(flushDecor, SAVE_DELAY);
  }
  function flushDecor() {
    clearTimeout(decorTimer); decorTimer = null;
    if (decorPending === undefined) return decorSaving;
    const items = decorPending; decorPending = undefined;
    setSaveState('저장 중…');
    decorSaving = decorSaving.then(() => call(() => api.setDecorations(items, treeId)))
      .then(() => { if (decorPending === undefined && !Object.keys(pendingSave).length) setSaveState('저장됨'); })
      .catch(e => {
        if (e.handled) return;
        setSaveState(errMsg(e), true);
        decorState.textContent = `장식을 저장하지 못했어요. ${errMsg(e)}`; decorState.className = 'msg error';
      });
    return decorSaving;
  }

  const decorHandlers = {
    onChange: list => queueDecorSave(list),
    onSelect: i => {
      btnDecorRemove.disabled = i < 0;
      const o = tree.selectedDecor;
      if (o) { brush.color = o.c; markBrush(); tree.setDecorEditing({ color: o.c }); }
    },
    onLimit: () => { decorState.textContent = `장식은 ${MAX_DECOR}개까지 달 수 있어요.`; decorState.className = 'msg bad'; }
  };

  /* 장식 탭이 열려 있을 때만 편집 모드: 자동 회전 멈춤, 패널은 트리를 덜 가리는 자리로 */
  let decorMode = false;
  function syncDecorMode() {
    const active = isOpen() && !$('pane-decor').hidden;
    if (active !== decorMode) {
      decorMode = active;
      panel.classList.toggle('decor-mode', active);
      tree.setDecorEditing(active ? { kind: brush.kind, color: brush.color, ...decorHandlers } : null);
      btnDecorRemove.disabled = true;
    }
    fitTree();
  }
  /** 패널이 트리 가운데를 가리면(좁은 화면) 패널 위 공간에 트리를 맞춤 */
  function fitTree() {
    if (!decorMode) { tree.setInsetBottom(null); return; }
    requestAnimationFrame(() => {
      if (!decorMode || destroyed) return;
      const r = panel.getBoundingClientRect(), mid = innerWidth / 2;
      tree.setInsetBottom(r.left < mid && r.right > mid ? r.top : null);
    });
  }
  on(window, 'resize', fitTree);

  on(btnDecorAdd, 'click', () => {
    if (!tree.addDecorAnywhere(brush.kind, brush.color)) decorHandlers.onLimit();
  });
  on(btnDecorRemove, 'click', () => { tree.removeSelectedDecor(); btnDecorAdd.focus(); });
  confirmButton($('btnDecorClear'), '정말 모두 뗄까요?', () => {
    tree.setDecorations([]); btnDecorRemove.disabled = true;
    queueDecorSave([]);
    decorState.textContent = '장식을 모두 뗐어요.'; decorState.className = 'msg good';
  });
  on($('btnDecorReset'), 'click', () => {
    tree.setDecorations(null); btnDecorRemove.disabled = true;
    queueDecorSave(null);
    decorState.textContent = '기본 장식으로 바꿨어요.'; decorState.className = 'msg good';
  });

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
   *  사진 — 올리기, 사진마다 캡션 고치기, 하나씩 또는 여러 장 골라 삭제
   * ========================================================= */
  const photoGrid = $('photoGrid'), photoEmpty = $('photoEmpty'), photoTotal = $('photoTotal');
  const photoInput = $('photoInput'), btnUpload = $('btnUpload'), uploadState = $('uploadState'), edCaption = $('edCaption');
  const photoTools = $('photoTools'), photoGridHint = $('photoGridHint');
  const photoSelectAll = $('photoSelectAll'), btnPhotoDeleteSel = $('btnPhotoDeleteSel');
  const selectedPhotos = new Set();
  const captionJobs = new Map();   // 사진 id → { timer, run } 저장 대기 중인 캡션
  let uploading = false, deleting = false;
  const setUploadState = (text, cls = '') => { uploadState.textContent = text; uploadState.className = 'msg' + (cls ? ' ' + cls : ''); };

  function photoCard(p) {
    const pick = h('input', { type: 'checkbox', className: 'pick', 'aria-label': `사진 선택${p.caption ? ': ' + p.caption : ''}` });
    const cap = h('input', { className: 'cap-input', maxlength: '30', autocomplete: 'off', enterkeyhint: 'done',
                             placeholder: '캡션 적기', 'aria-label': '사진 캡션 (30자, 입력을 마치면 저장)' });
    cap.value = p.caption || '';
    const ime = trackComposition(cap);
    const del = h('button', { type: 'button', text: '삭제', 'aria-label': `사진 삭제${p.caption ? ': ' + p.caption : ''}` });
    confirmButton(del, '정말 삭제?', () => removePhoto(p, del));
    const li = h('li', { dataset: { id: String(p.id) } },
      pick,
      h('img', { src: api.photoUrl(p.path), alt: p.caption || '트리 사진', loading: 'lazy', decoding: 'async' }),
      cap, del);

    on(pick, 'change', () => {
      pick.checked ? selectedPhotos.add(p.id) : selectedPhotos.delete(p.id);
      li.classList.toggle('selected', pick.checked);
      updatePhotoTools();
    });
    on(cap, 'input', () => { cap.classList.remove('saved', 'bad'); if (!ime.composing) queueCaption(p, cap, 1200); });
    on(cap, 'compositionend', () => queueCaption(p, cap, 1200));
    on(cap, 'blur', () => queueCaption(p, cap, 0));
    on(cap, 'keydown', e => { if (e.key === 'Enter' && !isImeEnter(e)) { e.preventDefault(); cap.blur(); } });
    return li;
  }

  function queueCaption(p, cap, ms) {
    const job = captionJobs.get(p.id);
    if (job) clearTimeout(job.timer);
    const run = () => { captionJobs.delete(p.id); saveCaption(p, cap); };
    captionJobs.set(p.id, { run, timer: setTimeout(run, ms) });
  }
  function flushCaptions() { for (const job of [...captionJobs.values()]) { clearTimeout(job.timer); job.run(); } }

  async function saveCaption(p, cap) {
    const v = cap.value.trim();
    if (v === (p.caption || '') || destroyed) return;
    if ([...v].length > 30) { cap.classList.add('bad'); setUploadState('캡션은 30자까지 적을 수 있어요.', 'error'); return; }
    try {
      const r = await call(() => api.updatePhotoCaption(p.id, v));
      p.caption = r.caption;
      tree.setPhotoCaption(p.id, r.caption);
      if (document.activeElement !== cap) cap.value = r.caption;
      cap.classList.add('saved');
      const li = cap.closest('li');
      li?.querySelector('img')?.setAttribute('alt', r.caption || '트리 사진');
      setUploadState(r.caption ? `캡션을 "${r.caption}"(으)로 저장했어요.` : '캡션을 지웠어요.', 'good');
    } catch (e) {
      if (e.handled) return;
      cap.classList.add('bad');
      setUploadState(`캡션을 저장하지 못했어요. ${errMsg(e)}`, 'error');
    }
  }

  /** 목록 다시 그리기: 이미 있는 카드는 그대로 두어 입력 중인 캡션 칸이 흔들리지 않게 */
  function renderPhotos() {
    const ids = new Set(state.photos.map(p => String(p.id)));
    for (const li of [...photoGrid.children]) if (!ids.has(li.dataset.id)) li.remove();
    const have = new Set([...photoGrid.children].map(li => li.dataset.id));
    for (const p of state.photos) if (!have.has(String(p.id))) photoGrid.append(photoCard(p));
    for (const id of [...selectedPhotos]) if (!ids.has(String(id))) selectedPhotos.delete(id);
    photoEmpty.hidden = state.photos.length > 0;
    photoTools.hidden = photoGridHint.hidden = state.photos.length === 0;
    btnUpload.disabled = uploading || deleting || state.photos.length >= MAX_PHOTOS;
    updatePhotoTools();
    refreshNotice(state);
  }
  function updatePhotoTools() {
    const n = selectedPhotos.size, total = state.photos.length;
    photoTotal.textContent = `${total}/${MAX_PHOTOS}` + (n ? ` · ${n}장 선택` : '');
    photoSelectAll.checked = total > 0 && n === total;
    photoSelectAll.indeterminate = n > 0 && n < total;
    btnPhotoDeleteSel.disabled = !n || deleting || uploading;
  }
  on(photoSelectAll, 'change', () => {
    const all = photoSelectAll.checked;
    for (const li of photoGrid.children) {
      const id = Number(li.dataset.id), pick = li.querySelector('input.pick');
      pick.checked = all; li.classList.toggle('selected', all);
      all ? selectedPhotos.add(id) : selectedPhotos.delete(id);
    }
    updatePhotoTools();
  });

  const STEP = { resize: '줄이는 중…', upload: '올리는 중…', save: '저장 중…' };
  async function upload(files) {
    if (!files.length) return;
    uploading = true; btnUpload.disabled = true; updatePhotoTools();
    const caption = edCaption.value.trim().slice(0, 30);
    let ok = 0, failed = 0, lastError = '';
    for (let i = 0; i < files.length && !destroyed; i++) {
      const prefix = files.length > 1 ? `${i + 1}/${files.length} · ` : '';
      uploadState.className = 'msg';
      try {
        const p = await call(() => api.uploadPhoto(files[i], caption, step => { uploadState.textContent = prefix + STEP[step]; }, treeId));
        state.photos.push({ ...p }); ok++;
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
    if (failed) setUploadState(`${ok}장 올림, ${failed}장 실패 — ${lastError}`, 'error');
    else {
      setUploadState(`${ok}장을 올렸어요.` + (ok > 1 ? ' 아래 목록에서 사진마다 캡션을 고칠 수 있어요.' : ''), 'good');
      edCaption.value = '';
    }
  }
  async function removePhoto(p, button) {
    setUploadState('');
    try {
      await busy(button, '삭제 중…', () => call(() => api.deletePhoto(p.id)));
      dropPhoto(p);
      renderPhotos();
      setUploadState('사진을 삭제했어요.', 'good');
      (photoGrid.querySelector('button') || btnUpload).focus();
    } catch (e) { if (!e.handled) setUploadState(errMsg(e), 'error'); }
  }
  function dropPhoto(p) {
    const job = captionJobs.get(p.id);
    if (job) { clearTimeout(job.timer); captionJobs.delete(p.id); }
    state.photos = state.photos.filter(x => x.id !== p.id);
    selectedPhotos.delete(p.id);
    tree.removePhoto(p.id);
  }
  /** 고른 사진 여러 장 삭제 (한 장씩 차례로: 삭제 티켓 → 파일 → DB) */
  async function removeSelected() {
    const targets = state.photos.filter(p => selectedPhotos.has(p.id));
    if (!targets.length) return;
    deleting = true; btnUpload.disabled = true; updatePhotoTools();
    let ok = 0, failed = 0, lastError = '';
    for (let i = 0; i < targets.length && !destroyed; i++) {
      setUploadState(`삭제 중… ${i + 1}/${targets.length}`);
      try {
        await call(() => api.deletePhoto(targets[i].id));
        dropPhoto(targets[i]); ok++;
        renderPhotos();
      } catch (e) {
        if (e.handled) return;
        failed++; lastError = errMsg(e);
      }
    }
    deleting = false;
    renderPhotos();
    if (failed) setUploadState(`${ok}장 삭제, ${failed}장 실패 — ${lastError}`, 'error');
    else setUploadState(`사진 ${ok}장을 삭제했어요.`, 'good');
    (photoGrid.querySelector('input') || btnUpload).focus();
  }
  confirmButton(btnPhotoDeleteSel, '정말 삭제할까요?', removeSelected);
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

  const pinForm = $('pinForm'), pinState = $('pinState');
  on(pinForm, 'submit', async e => {
    e.preventDefault();
    const oldPin = $('pinOld').value, newPin = $('pinNew').value, newPin2 = $('pinNew2').value;
    pinState.className = 'msg bad';
    if (!oldPin) { pinState.textContent = '지금 PIN을 입력해 주세요.'; $('pinOld').focus(); return; }
    if (!isValidPin(newPin)) { pinState.textContent = '새 PIN은 숫자 4~10자리로 입력해 주세요.'; $('pinNew').focus(); return; }
    if (newPin !== newPin2) { pinState.textContent = '새 PIN 확인이 일치하지 않아요.'; $('pinNew2').focus(); return; }
    if (newPin === oldPin) { pinState.textContent = '지금 PIN과 다른 숫자로 정해 주세요.'; $('pinNew').focus(); return; }
    try {
      await busy($('btnPin'), '바꾸는 중…', () => call(() => api.changePin(oldPin, newPin)));
      pinForm.reset();
      pinState.textContent = 'PIN을 바꿨어요. 다른 기기는 로그아웃됐어요.'; pinState.className = 'msg good';
    } catch (e2) {
      if (e2.handled) return;
      pinState.textContent = e2.code === 'wrong_pin' ? '지금 PIN이 맞지 않아요.' : errMsg(e2);
      if (e2.code === 'wrong_pin') $('pinOld').select();
    }
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
  renderDecorCount();
  setSaveState('');
  uploadState.textContent = ''; copyState.textContent = ''; pinState.textContent = ''; msgError.textContent = '';
  updateMsgCount();

  return {
    get state() { return state; },
    flush: flushSave,
    destroy() {
      destroyed = true;
      ac.abort();
      clearTimeout(saveTimer); clearTimeout(decorTimer);
      for (const job of captionJobs.values()) clearTimeout(job.timer);
      tree.setDecorEditing(null); tree.setInsetBottom(null);
      decorMode = false; panel.classList.remove('decor-mode');
      photoGrid.replaceChildren(); selectedPhotos.clear();
      panel.hidden = true;
      btnEdit.setAttribute('aria-expanded', 'false');
    }
  };
}
