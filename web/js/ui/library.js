/**
 * 트리 목록 (사이드 서랍) — 내 트리(최대 3개) + 담은 트리 + 최근 본 트리
 *
 *  - 내 트리: 로그인했을 때만. 이름(=제목) 바꾸기, 순서 바꾸기(▲▼), 새로 만들기, 지우기(사진이 없는 트리만)
 *
 *  - 로그인했으면 DB(list_trees)에서, 아니면 이 브라우저의 localStorage에서 읽는다.
 *    로그인하면 브라우저 기록을 DB로 합친다(main.js의 afterLogin).
 *  - 기본은 접힌 상태. 왼쪽 위 [☰ 목록] 버튼으로 펼치고, 펼침/접힘은 브라우저에 기억한다.
 *  - 목록은 읽기 전용: 항목을 누르면 그 트리의 공유 보기(?t=...)로 간다.
 */
import { $, h, toast, confirmButton, trackComposition, isImeEnter } from './dom.js';
import { shareUrlFor } from './editor.js';
import { PATTERN_NAMES } from '../tree/patterns.js';

const MAX_TREES = 3;

const LOCAL_KEY = 'code-christmas-tree.history';     // 로그인 전 본 기록
const OPEN_KEY = 'code-christmas-tree.library';      // 서랍 펼침 상태
const PENDING_KEY = 'code-christmas-tree.pendingSave';  // 로그인하면 담을 트리
const MAX_LOCAL = 50;

const store = {
  get(storage, key) { try { return JSON.parse(storage.getItem(key)); } catch { return null; } },
  set(storage, key, v) { try { v == null ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } }
};
const validItem = x => x && typeof x.share_id === 'string' && typeof x.name === 'string';

/** 로그인 전 이 브라우저에서 본 트리 기록 */
export const localHistory = {
  list() { const a = store.get(localStorage, LOCAL_KEY); return Array.isArray(a) ? a.filter(validItem) : []; },
  add({ share_id, name, title }) {
    const list = this.list().filter(x => x.share_id !== share_id);
    list.unshift({ share_id, name, title: title || '', viewed_at: new Date().toISOString() });
    store.set(localStorage, LOCAL_KEY, list.slice(0, MAX_LOCAL));
  },
  remove(shareId) { store.set(localStorage, LOCAL_KEY, this.list().filter(x => x.share_id !== shareId)); },
  clear() { store.set(localStorage, LOCAL_KEY, null); }
};

/** 로그인하지 않은 채 [담기]를 눌렀을 때, 로그인 후 담을 트리 (탭을 닫으면 사라짐) */
export const pendingSave = {
  set(item) { store.set(sessionStorage, PENDING_KEY, item); },
  peek() { const v = store.get(sessionStorage, PENDING_KEY); return validItem(v) ? v : null; },
  take() { const v = this.peek(); store.set(sessionStorage, PENDING_KEY, null); return v; }
};

/* ---------- "3일 전" 같은 상대 시간 ---------- */
const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
function ago(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const sec = (t - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(sec) >= size) return rtf.format(Math.round(sec / size), unit);
  }
  return '방금';
}

/**
 * @param {{ api, onOpen: (shareId: string) => void, onOpenMine: (treeId: string|null) => void, isViewing?: () => boolean }} deps
 */
export function createLibrary({ api, onOpen, onOpenMine, isViewing = () => false }) {
  const toggle = $('btnLibrary'), panel = $('library'), closeBtn = $('libClose');
  const savedList = $('libSaved'), historyList = $('libHistory');
  const savedEmpty = $('libSavedEmpty'), historyEmpty = $('libHistoryEmpty');
  const errorEl = $('libError'), clearBtn = $('libClear');
  const mineSection = $('libMine'), mineList = $('libMineList'), newTreeBtn = $('libNewTree');
  let items = [], mine = [], current = null, currentMine = null, open = false, loading = null, editingId = null;

  /* ---------- 데이터 ---------- */
  // 동작(이름 바꾸기·지우기 등)에서 난 오류는 바로 뒤따르는 refresh()에서 지워지지 않게 한 번 남긴다
  let keepError = false;
  const setError = msg => { errorEl.textContent = msg; keepError = true; };

  async function load() {
    if (!keepError) errorEl.textContent = '';
    keepError = false;
    if (!api.loggedIn) {
      items = localHistory.list().map(x => ({ ...x, saved: false }));
      mine = [];
      return;
    }
    try { [items, mine] = await Promise.all([api.listTrees(), api.listMyTrees()]); }
    catch (e) {
      if (e.code === 'unauthorized') { items = localHistory.list().map(x => ({ ...x, saved: false })); mine = []; return; }
      errorEl.textContent = `목록을 불러오지 못했어요. ${e.message}`;
    }
  }
  function refresh() {
    loading = load().then(render);
    return loading;
  }

  /* ---------- 그리기 (사용자 입력은 textContent로만) ---------- */
  function row(item, kind) {
    const link = h('a', { href: shareUrlFor(item.share_id), className: 'item' },
      h('span', { className: 'who', text: `${item.saved && kind === 'history' ? '★ ' : ''}${item.name}님의 트리` }),
      h('span', { className: 'meta', text: [item.title, ago(kind === 'saved' ? item.saved_at : item.viewed_at)].filter(Boolean).join(' · ') }));
    if (item.share_id === current) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;   // 새 탭으로 열기는 그대로
      e.preventDefault();
      if (matchMedia('(max-width: 700px)').matches) setOpen(false, { focusToggle: false });
      onOpen(item.share_id);
    });
    const remove = kind === 'saved'
      ? h('button', { type: 'button', className: 'icon', text: '☆', 'aria-label': `담기 취소: ${item.name}님의 트리`, title: '담기 취소' })
      : h('button', { type: 'button', className: 'icon', text: '✕', 'aria-label': `기록에서 지우기: ${item.name}님의 트리`, title: '기록에서 지우기' });
    remove.addEventListener('click', () => (kind === 'saved' ? unsave(item) : forget(item)));
    return h('li', {}, link, remove);
  }

  /* ---------- 내 트리 ---------- */
  function mineRow(t, i) {
    if (t.id === editingId) return renameRow(t);
    const link = h('a', { href: '#', className: 'item' },
      h('span', { className: 'who', text: t.title }),
      h('span', { className: 'meta', text: `${PATTERN_NAMES[t.pattern] ?? ''} · 글귀 ${t.messages} · 사진 ${t.photos}` }));
    if (t.id === currentMine) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', e => {
      e.preventDefault();
      if (matchMedia('(max-width: 700px)').matches) setOpen(false, { focusToggle: false });
      onOpenMine(t.id);
    });
    const btn = (text, label, onclick, disabled = false) =>
      h('button', { type: 'button', className: 'icon', text, 'aria-label': `${label}: ${t.title}`, title: label, disabled, onclick });
    const del = btn('🗑', '트리 지우기', null, mine.length <= 1);
    confirmButton(del, '?', () => removeTree(t));
    return h('li', { dataset: { id: t.id } }, link,
      h('span', { className: 'actions' },
        btn('✎', '이름 바꾸기', () => { editingId = t.id; render(); }),
        btn('▲', '위로', () => move(i, -1), i === 0),
        btn('▼', '아래로', () => move(i, 1), i === mine.length - 1),
        del));
  }
  function renameRow(t) {
    const input = h('input', { value: t.title, maxlength: '30', 'aria-label': `‘${t.title}’ 새 이름 (1~30자)` });
    const ime = trackComposition(input);
    let done = false;
    const finish = async save => {
      if (done) return; done = true;
      const title = input.value.trim();
      editingId = null;
      if (save && title && title !== t.title) {
        try {
          await api.updateTree({ title }, t.id);
          document.dispatchEvent(new CustomEvent('tree:renamed', { detail: { id: t.id, title } }));
          toast('트리 이름을 바꿨어요.');
        } catch (e) { setError(e.message); }
      } else if (save && !title) setError('트리 이름은 1~30자로 입력해 주세요.');
      await refresh();
      mineList.querySelector(`li[data-id="${t.id}"] button`)?.focus();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !isImeEnter(e) && !ime.composing) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => { input.focus(); input.select(); });
    return h('li', { className: 'editing', dataset: { id: t.id } }, input,
      h('button', { type: 'button', className: 'icon', text: '✓', 'aria-label': '이름 저장', onmousedown: e => e.preventDefault(), onclick: () => finish(true) }));
  }
  // 순서는 화면에 바로 반영하고 저장 요청은 차례대로 보낸다.
  // (응답을 기다렸다 다시 그리면, 빠르게 두 번 누를 때 두 번째가 옛 순서 기준이 되어 한 칸만 움직임)
  let moving = Promise.resolve();
  async function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= mine.length) return;
    const next = mine.slice();
    [next[i], next[j]] = [next[j], next[i]];
    mine = next;
    const ids = next.map(t => t.id), movedId = ids[j];
    // 옮긴 트리의 같은 방향 버튼에 포커스를 남겨 연속으로 옮길 수 있게
    const refocus = () => {
      const li = mineList.querySelector(`li[data-id="${movedId}"]`);
      (li?.querySelector(`button[title="${d < 0 ? '위로' : '아래로'}"]:not(:disabled)`) || li?.querySelector('a'))?.focus();
    };
    render(); refocus();
    const mine_ = moving = moving.then(() => api.reorderTrees(ids)).catch(e => setError(e.message));
    await mine_;
    if (mine_ !== moving) return;            // 뒤이은 이동이 있으면 마지막 것만 서버 목록으로 맞춤
    await refresh(); refocus();
  }
  async function removeTree(t) {
    try {
      await api.deleteTree(t.id);
      toast(`‘${t.title}’ 트리를 지웠어요.`);
      if (t.id === currentMine) onOpenMine(null);
    } catch (e) { setError(e.message); toast(e.message, { error: true }); }
    await refresh();
  }
  newTreeBtn.addEventListener('click', async () => {
    newTreeBtn.disabled = true;
    try {
      const t = await api.createTree();
      toast('새 트리를 만들었어요! ✎ 꾸미기로 이름과 무늬를 정해 보세요.');
      if (matchMedia('(max-width: 700px)').matches) setOpen(false, { focusToggle: false });
      onOpenMine(t.id);
    } catch (e) { setError(e.message); }
    await refresh();
  });
  // 꾸미기에서 제목·무늬를 바꾸면 목록도 다시 읽음 (잠깐 모아서 한 번)
  let mineTimer;
  document.addEventListener('tree:updated', () => { clearTimeout(mineTimer); mineTimer = setTimeout(refresh, 300); });

  function render() {
    mineSection.hidden = !api.loggedIn;
    if (api.loggedIn) {
      mineList.replaceChildren(...mine.map(mineRow));
      $('libMineCount').textContent = `${mine.length}/${MAX_TREES}`;
      newTreeBtn.disabled = mine.length >= MAX_TREES;
      $('libMineNote').textContent = mine.length >= MAX_TREES
        ? '트리는 3개까지예요. 새로 만들려면 하나를 지워 주세요. (사진이 없는 트리만 지울 수 있어요)'
        : '트리마다 공유 링크가 따로 있어요. 이름은 트리 위에 보이는 제목이에요.';
    }
    const saved = items.filter(x => x.saved).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
    const history = items.filter(x => x.viewed_at).sort((a, b) => String(b.viewed_at).localeCompare(String(a.viewed_at)));
    savedList.replaceChildren(...saved.map(x => row(x, 'saved')));
    historyList.replaceChildren(...history.map(x => row(x, 'history')));
    $('libSavedCount').textContent = api.loggedIn ? String(saved.length) : '';
    $('libHistoryCount').textContent = String(history.length);
    savedEmpty.textContent = api.loggedIn
      ? '공유 링크로 연 트리에서 ☆ 담기를 누르면 여기에 모여요.'
      : '로그인하면 마음에 드는 트리를 담아 두고, 다른 기기에서도 같은 목록을 볼 수 있어요.';
    savedEmpty.hidden = saved.length > 0;
    historyEmpty.hidden = history.length > 0;
    clearBtn.hidden = history.length === 0;
  }

  /* ---------- 항목 지우기 ---------- */
  async function unsave(item) {
    try {
      await api.setSaved(item.share_id, false);
      toast(`${item.name}님의 트리를 목록에서 뺐어요.`);
      document.dispatchEvent(new CustomEvent('tree:saved-change', { detail: { shareId: item.share_id, saved: false } }));
    } catch (e) { setError(e.message); }
    await refresh();
  }
  async function forget(item) {
    try { api.loggedIn ? await api.forgetViews(item.share_id) : localHistory.remove(item.share_id); }
    catch (e) { setError(e.message); }
    await refresh();
  }
  confirmButton(clearBtn, '정말 다 지울까요?', async () => {
    try { api.loggedIn ? await api.forgetViews(null) : localHistory.clear(); toast('본 기록을 지웠어요. 담은 트리는 그대로예요.'); }
    catch (e) { setError(e.message); }
    await refresh();
  });

  /* ---------- 펼치기 / 접기 ---------- */
  function setOpen(next, { focusToggle = true, remember = true, focus = true } = {}) {
    open = next;
    panel.classList.toggle('open', open);
    panel.inert = !open;                       // 접혀 있을 땐 Tab으로도 못 들어감
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('lib-open', open);
    if (remember) store.set(localStorage, OPEN_KEY, open ? 'open' : 'closed');
    if (open) {
      refresh();
      if (focus) closeBtn.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent('library:open'));   // 좁은 화면이면 꾸미기 패널이 닫힘
    }
    else if (focusToggle && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => setOpen(!open));
  // 꾸미기 패널이 열릴 때 화면이 좁으면 서랍을 접는다 (둘이 겹쳐서 누를 수 없게 되는 것 방지)
  document.addEventListener('editpanel:open', () => { if (open && innerWidth < 1100) setOpen(false, { focusToggle: false }); });
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !open || e.defaultPrevented || isViewing()) return;
    const inPanel = panel.contains(document.activeElement);
    const editOpen = !$('editPanel').hidden;
    if (inPanel || !editOpen) { e.preventDefault(); setOpen(false); }   // 꾸미기 패널이 열려 있으면 그쪽이 먼저 닫힘
  });

  return {
    refresh,
    get items() { return items; },
    get isOpen() { return open; },
    /** 지금 보고 있는 트리 표시 (없으면 null) */
    setCurrent(shareId) { current = shareId; render(); },
    /** 지금 편집 중인 내 트리 표시 (없으면 null) */
    setCurrentMine(treeId) { currentMine = treeId; render(); },
    /** 서버 모드에서만 보이게 */
    show() {
      toggle.hidden = false; panel.hidden = false;
      const remembered = store.get(localStorage, OPEN_KEY) === 'open';
      setOpen(remembered, { remember: false, focusToggle: false, focus: false });
      if (!remembered) refresh();
    }
  };
}
