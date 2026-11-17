/**
 * 진입점 — 모드를 정하고 화면을 연결한다.
 *
 *   config.js가 비어 있음      → demo   (서버 없이 로컬에서만 동작하는 프로토타입)
 *   ?t=<share_id>              → shared (공유 보기, 읽기 전용)
 *   저장된 세션 토큰 있음       → mine   (내 트리 편집)
 *   그 밖                      → login
 *   (서버 모드에서는 왼쪽 위 [☰ 목록]에 담은 트리 · 최근 본 트리가 있다)
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

/* supabase-js (UMD) — 버전 고정 + SRI. 버전을 올릴 때는 integrity도 함께 바꿀 것
   openssl dgst -sha384 -binary supabase.js | openssl base64 -A */
const SUPABASE_JS = {
  src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js',
  integrity: 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK'
};

/* =========================================================
 *  CONFIG — 데모 모드의 글귀·사진을 고정하려면 여기를 수정하세요.
 *  photos: [{ src: 'photos/a.jpg' 또는 'data:image/jpeg;base64,...', caption: '설명' }]
 * ========================================================= */
const CONFIG = {
  title: 'Merry Christmas',
  messages: [
    '올 한 해도 정말 고생 많았어요.',
    '따뜻하고 반짝이는 연말 보내세요 ✨',
    'Merry Christmas & Happy New Year!'
  ],
  photos: [],
  useSamplePhotos: true,   // 사진이 하나도 없을 때 샘플 사진 표시
  patternInterval: 12,     // 무늬 자동 전환 간격(초)
  morphDuration: 2.6,      // 무늬 전환 애니메이션 길이(초)
  photoInterval: 3.2       // 사진 등장 간격(초)
};

const LOGIN_MESSAGES = [
  '한글 이름과 PIN으로 나만의 트리를 만들어 보세요 ✨',
  '글귀와 사진을 걸고, 링크 하나로 마음을 전해요.'
];

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
  const tree = createTree($('c'), {
    title: CONFIG.title,
    messages: CONFIG.messages,
    patternInterval: CONFIG.patternInterval,
    morphDuration: CONFIG.morphDuration,
    photoInterval: CONFIG.photoInterval,
    elements: { srMessages: $('srMessages') }
  });

  $('btnPattern').onclick = () => tree.nextPattern();

  const panel = $('textPanel');
  let messages = [...CONFIG.messages];
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
  tree.setMessages(data.messages.map(m => m.body));
  for (const p of data.photos) tree.addPhoto(api.photoUrl(p.path), p.caption, { id: p.id }).catch(() => {});
}

/* ---------- 주소 이동 (새로고침 없이) ---------- */
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
      toast(`${pending.name}님의 트리를 담았어요 ⭐ 왼쪽 위 ☰ 목록에서 볼 수 있어요.`, { ms: 4200 });
    } catch (e) {
      if (e.code !== 'own_tree') toast(e.message, { error: true });
    }
  }
  library.refresh();
}

function showLogin() {
  navSeq++;
  const signal = switchTo('login');
  library.setCurrent(null);
  tree.setTitle('Merry Christmas');
  tree.setSettings(DEFAULT_SETTINGS);
  tree.setMessages(LOGIN_MESSAGES);
  $('btnPattern').addEventListener('click', () => tree.nextPattern(), { signal });
  current = mountLogin({ api, onEnter: () => { afterLogin(); showMine(); } });
  library.refresh();
  tree.layout();
}

/* 불러오는 동안은 'boot'(도구 막대 숨김)로 두고, 화면이 연결된 뒤에 모드를 바꾼다.
   그래야 로딩 중에 아직 동작하지 않는 버튼을 누르는 일이 없다. */
async function showMine() {
  const nav = ++navSeq;
  switchTo('boot');
  library.setCurrent(null);
  tree.setMessages([]);
  screen('loading', '트리를 불러오는 중…');
  let data;
  try { data = await api.getMyTree(); }
  catch (e) {
    if (nav !== navSeq) return;
    if (e.code === 'unauthorized') { toast(e.message, { error: true }); return showLogin(); }
    return screen('error', `내 트리를 불러오지 못했어요. ${e.message}`, [
      { label: '다시 시도', primary: true, onClick: () => showMine() },
      { label: '로그아웃', onClick: async () => { await api.logout().catch(() => {}); showLogin(); } }
    ]);
  }
  if (nav !== navSeq) return;
  screen(null);
  applyTree(data);
  setMode('mine');
  current = mountEditor({
    api, tree, data,
    onLogout: () => showLogin(),
    onUnauthorized: () => showLogin(),
    refreshNotice: s => setNotice(
      !s.messages.length && !s.photos.length ? '아직 비어 있는 트리예요 · ✎ 꾸미기에서 글귀와 사진을 걸어 보세요'
      : !s.photos.length ? '사진이 아직 없어요 · ✎ 꾸미기 → 사진에서 올려 보세요'
      : !s.messages.length ? '글귀가 아직 없어요 · ✎ 꾸미기 → 글귀에서 적어 보세요'
      : '')
  });
}

async function showShared(shareId) {
  const nav = ++navSeq;
  switchTo('boot');
  library.setCurrent(shareId);
  tree.setMessages([]);
  screen('loading', '트리를 불러오는 중…');
  let data;
  try { data = await api.getTree(shareId); }
  catch (e) {
    if (nav !== navSeq) return;
    if (e.code === 'not_found') {
      return screen('error', '트리를 찾을 수 없어요. 링크가 정확한지 확인해 주세요.', [
        { label: '✨ 나도 트리 만들기', primary: true, onClick: () => goHome() }
      ]);
    }
    return screen('error', `트리를 불러오지 못했어요. ${e.message}`, [
      { label: '다시 시도', primary: true, onClick: () => showShared(shareId) }
    ]);
  }
  if (nav !== navSeq) return;
  screen(null);
  applyTree(data);
  setMode('shared');
  current = mountShare({ api, tree, data, shareId, library, onHome: goHome });
  if (!data.messages.length && !data.photos.length) setNotice('아직 꾸미는 중인 트리예요. 조금 뒤에 다시 와 주세요 🎄');
}

async function startServer(cfg) {
  setMode('boot');
  tree = createTree($('c'), { title: 'Merry Christmas', messages: [], elements: { srMessages: $('srMessages') } });
  if (cfg.key.startsWith('sb_secret_')) {   // 관리자 키가 웹에 들어오면 즉시 중단
    return screen('error', 'config.js에 secret key가 들어 있어요. 공개용 Publishable key로 바꿔 주세요.');
  }
  try {
    if (!window.supabase?.createClient) await loadScript(SUPABASE_JS);
    api = new TreeApi(cfg);
  } catch (e) {
    return screen('error', '서버 연결 준비에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요.', [
      { label: '다시 시도', primary: true, onClick: () => location.reload() }
    ]);
  }
  library = createLibrary({ api, onOpen: openShared, isViewing: () => tree.viewing });
  library.show();
  if (api.loggedIn && localHistory.list().length) afterLogin();   // 예전에 로그인 전 본 기록이 남아 있으면 합치기
  addEventListener('popstate', () => route());                     // 뒤로·앞으로 가기
  route();
}

const cfg = readConfig();
cfg ? startServer(cfg) : startDemo();
