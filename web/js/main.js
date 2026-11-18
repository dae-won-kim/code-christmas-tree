/**
 * 진입점 — 모드를 정하고 화면을 연결한다.
 *
 *   config.js가 비어 있음      → demo   (서버 없이 로컬에서만 동작하는 프로토타입)
 *   ?t=<share_id>              → shared (공유 보기, 읽기 전용)
 *   저장된 세션 토큰 있음       → mine   (내 트리 편집)
 *   그 밖                      → login
 *   (서버 모드에서는 왼쪽 위 [☰ 목록]에 내 트리 · 담은 트리 · 최근 본 트리 · 로그아웃이 있다)
 *   오른쪽 위 [English / 한국어] 버튼으로 화면 언어를 바꾼다 (js/i18n.js)
 *
 * DB 접근은 js/api.js의 TreeApi만 사용한다.
 */
import { TreeApi, TreeError } from './api.js';
import { createTree } from './tree/renderer.js';
import { SAMPLE_PHOTOS } from './tree/photos.js';
import { $, screen, toast } from './ui/dom.js';
import { mountLogin } from './ui/login.js';
import { mountEditor, DEFAULT_SETTINGS, shareUrlFor } from './ui/editor.js';
import { mountShare, homeUrl } from './ui/share.js';
import { createLibrary, localHistory, pendingSave } from './ui/library.js';
import { t, applyStatic, setLang, getLang, onLangChange } from './i18n.js';

/* supabase-js (UMD) — 버전 고정 + SRI. 버전을 올릴 때는 integrity도 함께 바꿀 것
   openssl dgst -sha384 -binary supabase.js | openssl base64 -A */
const SUPABASE_JS = {
  src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  integrity: 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK'
};

/* =========================================================
 *  CONFIG — 데모 모드의 글귀·사진을 고정하려면 여기를 수정하세요.
 *  messages: null이면 화면 언어의 기본 글귀(i18n.js의 'demo.messages')
 *  photos: [{ src: 'photos/a.jpg' 또는 'data:image/jpeg;base64,...', caption: '설명' }]
 * ========================================================= */
const CONFIG = {
  title: 'Merry Christmas',
  messages: null,
  photos: [],
  useSamplePhotos: true,   // 사진이 하나도 없을 때 샘플 사진 표시
  patternInterval: 60,     // 무늬 자동 전환 간격(초)
  morphDuration: 2.6,      // 무늬 전환 애니메이션 길이(초)
  photoInterval: 3.2       // 사진 등장 간격(초)
};

/** 자동 테스트용: window.__TREE_DEBUG__가 켜져 있을 때만 트리 API를 노출 (평소에는 아무 일도 안 함) */
const exposeForTests = tree => { if (window.__TREE_DEBUG__) window.__tree = tree; };

/* ---------- 모드 ---------- */
function setMode(mode) {
  document.body.dataset.mode = mode;
  for (const item of $('toolbar').children) {
    item.hidden = !(item.dataset.modes || '').split(' ').includes(mode);
  }
}

/** config.js 값 읽기. 비어 있거나 예시 값 그대로면 null(데모 모드) */
function readConfig() {
  const c = window.TREE_CONFIG || {};
  const url = String(c.SUPABASE_URL || '').trim(), key = String(c.SUPABASE_KEY || '').trim();
  if (!url || !key || url.includes('YOUR-PROJECT-REF') || /X{8,}/.test(key)) return null;
  return { url, key };
}

function loadScript({ src, integrity }) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = resolve; s.onerror = () => reject(new TreeError('network'));
    document.head.append(s);
  });
}

/* =========================================================
 *  데모 모드 — Phase 0 프로토타입과 같은 동작
 * ========================================================= */
function startDemo() {
  setMode('demo');
  const demoMessages = CONFIG.messages || t('demo.messages');
  const tree = createTree($('c'), {
    title: CONFIG.title,
    messages: demoMessages,
    patternInterval: CONFIG.patternInterval,
    morphDuration: CONFIG.morphDuration,
    photoInterval: CONFIG.photoInterval,
    elements: { srMessages: $('srMessages') }
  });
  exposeForTests(tree);

  $('btnPattern').onclick = () => tree.nextPattern();

  const panel = $('textPanel');
  let messages = [...demoMessages];
  $('btnText').onclick = () => {
    $('inTitle').value = $('title').textContent;
    $('inMsgs').value = messages.join('\n');
    panel.classList.toggle('open');
  };
  $('btnCancel').onclick = () => panel.classList.remove('open');
  $('btnApply').onclick = () => {
    messages = $('inMsgs').value.split('\n').map(s => s.trim()).filter(Boolean);
    panel.classList.remove('open');
    tree.setMessages(messages);
    tree.setTitle($('inTitle').value.trim());
  };
  addEventListener('keydown', e => { if (e.key === 'Escape' && !tree.viewing) panel.classList.remove('open'); });

  const fileInput = $('fileInput');
  $('btnPhoto').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const f of files) {   // 추가하자마자 반짝 등장
      await tree.addPhoto(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, ''), { show: 'sparkle' }).catch(() => {});
    }
  };

  // 사진 (내 사진을 넣으면 샘플은 자동으로 빠짐)
  (async () => {
    for (const p of CONFIG.photos) await tree.addPhoto(p.src, p.caption).catch(() => {});
    if (!tree.photoCount && CONFIG.useSamplePhotos) {
      for (const s of SAMPLE_PHOTOS()) await tree.addPhoto(s.src, s.caption, { sample: true });
    }
  })();
}

/* =========================================================
 *  서버 모드 — login / mine / shared
 * ========================================================= */
let api, tree, library, current = null, modeAc = null;

/** 화면 전환: 이전 화면 정리 + 트리 내용 비우기 */
function switchTo(mode) {
  current?.destroy(); current = null;
  modeAc?.abort(); modeAc = new AbortController();
  screen(null);
  setMode(mode);
  $('notice').hidden = true; $('notice').textContent = '';
  tree.clearPhotos();
  return modeAc.signal;
}

function setNotice(text) {
  const n = $('notice');
  if (n.textContent === text && n.hidden === !text) return;
  n.textContent = text; n.hidden = !text;
  tree.layout();
}

/** DB에서 받은 Tree를 렌더러에 반영 */
function applyTree(data) {
  tree.setTitle(data.title);
  tree.setPattern(data.pattern);
  tree.setSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
  tree.setDecorations(data.decorations ?? null);   // null = 기본 장식
  tree.setMessages(data.messages.map(m => m.body));
  for (const p of data.photos) tree.addPhoto(api.photoUrl(p.path), p.caption, { id: p.id }).catch(() => {});
}

/* ---------- 주소 이동 (새로고침 없이) ---------- */
const CURRENT_TREE_KEY = 'code-christmas-tree.currentTree';   // 마지막으로 편집한 내 트리 (사용자당 최대 3개)
const rememberTree = id => { try { id ? localStorage.setItem(CURRENT_TREE_KEY, id) : localStorage.removeItem(CURRENT_TREE_KEY); } catch { /* 저장 불가 */ } };
const rememberedTree = () => { try { return localStorage.getItem(CURRENT_TREE_KEY); } catch { return null; } };
let navSeq = 0;   // 빠르게 다른 트리로 옮겨 갈 때, 늦게 도착한 이전 응답을 버리기 위한 번호

/** 주소에 맞는 화면으로 */
function route() {
  const shareId = new URLSearchParams(location.search).get('t');
  if (shareId) return showShared(shareId);
  if (api.loggedIn) return showMine();
  return showLogin();
}
/** 목록에서 고른 트리 열기 → ?t=share_id */
function openShared(shareId) {
  const url = shareUrlFor(shareId);
  if (location.href !== url) history.pushState(null, '', url);
  showShared(shareId);
}
/** 내 트리 열기 (treeId가 null이면 맨 앞 트리) */
function openMine(treeId) {
  const url = homeUrl();
  if (location.href !== url) history.pushState(null, '', url);
  showMine(treeId);
}
/** ?t=를 빼고 처음 화면(로그인 또는 내 트리)으로 */
function goHome() {
  const url = homeUrl();
  if (location.href !== url) history.pushState(null, '', url);
  route();
}

/** 로그인 직후: 브라우저에 쌓인 본 기록을 DB로 합치고, 로그인 전에 누른 [담기]를 처리 */
async function afterLogin() {
  const local = localHistory.list();
  if (local.length) {
    try { await api.mergeViews(local); localHistory.clear(); } catch { /* 다음 로그인 때 다시 시도 */ }
  }
  const pending = pendingSave.take();
  if (pending) {
    try {
      await api.setSaved(pending.share_id, true);
      toast(t('share.afterLogin', { name: pending.name }), { ms: 4200 });
    } catch (e) {
      if (e.code !== 'own_tree') toast(e.message, { error: true });
    }
  }
  library.refresh();
}

function showLogin() {
  navSeq++;
  const signal = switchTo('login');
  library.setCurrent(null); library.setCurrentMine(null);
  tree.setTitle('Merry Christmas');
  tree.setSettings(DEFAULT_SETTINGS);
  tree.setDecorations(null);
  tree.setMessages(t('login.messages'));
  $('btnPattern').addEventListener('click', () => tree.nextPattern(), { signal });
  current = mountLogin({ api, onEnter: r => { library.setUser(r?.name); afterLogin(); rememberTree(null); showMine(null); } });
  library.refresh();
  tree.layout();
}

/* 불러오는 동안은 'boot'(도구 막대 숨김)로 두고, 화면이 연결된 뒤에 모드를 바꾼다.
   그래야 로딩 중에 아직 동작하지 않는 버튼을 누르는 일이 없다. */
async function showMine(treeId = rememberedTree()) {
  const nav = ++navSeq;
  switchTo('boot');
  library.setCurrent(null);
  tree.setMessages([]);
  screen('loading', t('common.loadingTree'));
  let data;
  try { data = await api.getMyTree(treeId); }
  catch (e) {
    if (nav !== navSeq) return;
    if (e.code === 'not_found' && treeId) { rememberTree(null); return showMine(null); }   // 지운 트리 → 맨 앞 트리로
    if (e.code === 'unauthorized') { toast(e.message, { error: true }); return showLogin(); }
    return screen('error', t('main.mineFail', { msg: e.message }), [
      { label: t('common.retry'), primary: true, onClick: () => showMine() },
      { label: t('common.logout'), onClick: () => logout() }
    ]);
  }
  if (nav !== navSeq) return;
  screen(null);
  rememberTree(data.id);
  library.setCurrentMine(data.id);
  library.setUser(data.name);
  applyTree(data);
  setMode('mine');
  current = mountEditor({
    api, tree, data,
    onLogout: () => { rememberTree(null); library.setUser(null); showLogin(); },
    onUnauthorized: () => showLogin(),
    refreshNotice: s => setNotice(
      !s.messages.length && !s.photos.length ? t('main.emptyMine')
      : !s.photos.length ? t('main.noPhotos')
      : !s.messages.length ? t('main.noMessages')
      : '')
  });
}

async function showShared(shareId) {
  const nav = ++navSeq;
  switchTo('boot');
  library.setCurrent(shareId); library.setCurrentMine(null);
  tree.setMessages([]);
  screen('loading', t('common.loadingTree'));
  let data;
  try { data = await api.getTree(shareId); }
  catch (e) {
    if (nav !== navSeq) return;
    if (e.code === 'not_found') {
      return screen('error', t('main.notFound'), [
        { label: t('tb.make'), primary: true, onClick: () => goHome() }
      ]);
    }
    return screen('error', t('main.treeFail', { msg: e.message }), [
      { label: t('common.retry'), primary: true, onClick: () => showShared(shareId) }
    ]);
  }
  if (nav !== navSeq) return;
  screen(null);
  applyTree(data);
  setMode('shared');
  current = mountShare({ api, tree, data, shareId, library, onHome: goHome, onOpenMine: openMine });
  if (!data.messages.length && !data.photos.length) setNotice(t('main.emptyShared'));
}

/** 로그아웃 (사이드 목록 · 오류 화면): 남은 저장을 보내고 → 토큰 지우기 → 공유 보기면 그대로, 아니면 로그인 화면 */
async function logout() {
  await current?.flush?.();
  try { await api.logout(); } catch { /* 서버 응답과 상관없이 이 브라우저의 토큰은 지워짐 */ }
  rememberTree(null);
  library.setUser(null);
  toast(t('acc.loggedOut'));
  route();
}

/** 화면 언어를 바꾸면: 남은 저장을 보낸 뒤 지금 화면을 새 언어로 다시 그림 (데이터는 다시 읽음) */
onLangChange(async () => {
  if (!api) { location.reload(); return; }   // 데모 · 서버 준비 실패 화면은 새로 불러오기
  await current?.flush?.();
  route();
  library.refresh();
});

async function startServer(cfg) {
  setMode('boot');
  tree = createTree($('c'), { title: 'Merry Christmas', messages: [], elements: { srMessages: $('srMessages') } });
  exposeForTests(tree);
  if (cfg.key.startsWith('sb_secret_')) {   // 관리자 키가 웹에 들어오면 즉시 중단
    return screen('error', t('main.secretKey'));
  }
  try {
    if (!window.supabase?.createClient) await loadScript(SUPABASE_JS);
    api = new TreeApi(cfg);
  } catch (e) {
    return screen('error', t('main.serverFail'), [
      { label: t('common.retry'), primary: true, onClick: () => location.reload() }
    ]);
  }
  library = createLibrary({ api, onOpen: openShared, onOpenMine: openMine, onLogout: logout, isViewing: () => tree.viewing });
  library.show();
  if (api.loggedIn && localHistory.list().length) afterLogin();   // 예전에 로그인 전 본 기록이 남아 있으면 합치기
  addEventListener('popstate', () => route());                     // 뒤로·앞으로 가기
  route();
}

/* ---------- 시작 ---------- */
applyStatic();
$('btnLang').addEventListener('click', () => setLang(getLang() === 'ko' ? 'en' : 'ko'));

const cfg = readConfig();
cfg ? startServer(cfg) : startDemo();
