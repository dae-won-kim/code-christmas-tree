/**
 * E2E 테스트용 window.supabase mock (브라우저에 addInitScript로 주입)
 *
 *  - supabase/migrations/의 RPC 동작을 메모리에서 흉내 낸다.
 *    (계정 v2: (이름, 이메일) + PIN, 이메일로 PIN 복구, 사용자당 트리 3개, 오류 코드, {ok:false} 반환,
 *     티켓 방식 업로드·삭제, 30장/50개 제한, 속도 제한, 본 기록·담기)
 *  - Supabase Auth 이메일 OTP도 흉내 낸다: signInWithOtp → db.mail에 "보낸 메일" 저장 → verifyOtp
 *  - 상태는 localStorage('__mockdb')에 저장 → 새로고침해도 유지
 *  - 실제 보안은 DB 테스트(supabase/tests)가 검증한다. 여기서는 화면 흐름만 검증한다.
 *
 * 테스트에서 쓰는 훅
 *   window.__mock.db()                  현재 상태(JSON)
 *   window.__mock.fail = { fn, error }   다음 fn 호출을 실패시킴 (error: 'network' 또는 오류 코드)
 *   window.__mock.expireSessions()      모든 세션 만료
 *   window.__mock.delays = { fn: ms }   해당 RPC 응답을 늦춤 (느린 네트워크)
 *   window.__mock.lastCode(email)       그 주소로 "보낸" 마지막 복구 PIN
 *   window.__mock.authFail = 'send' | 'rate'   다음 signInWithOtp를 실패시킴 (메일 발송 실패 / 1분 제한)
 */
(() => {
  const KEY = '__mockdb';
  const blank = () => ({ seq: 1, users: [], trees: [], sessions: {}, attempts: [], tickets: [], messages: [], photos: [], objects: {}, views: [], mail: [], log: [] });
  const load = () => {
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { db = blank(); }
    for (const k of ['users', 'trees', 'attempts', 'tickets', 'messages', 'photos', 'views', 'mail', 'log']) db[k] ||= [];
    db.sessions ||= {}; db.objects ||= {};
    return db;
  };
  const save = db => localStorage.setItem(KEY, JSON.stringify(db));
  const uuid = () => crypto.randomUUID();
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const shareId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/\+/g, '-').replace(/\//g, '_');
  const now = () => Date.now();
  const norm = s => String(s ?? '').trim().normalize('NFC');
  const len = s => [...s].length;

  class Raise extends Error {}
  const raise = code => { throw new Raise(code); };

  /* ---------- 내부 함수 (SQL의 private.*와 같은 규칙) ---------- */
  function requireUser(db, token) {
    const s = db.sessions[token];
    if (!s || s.exp < now()) raise('unauthorized');
    return s.user;
  }
  const normEmail = e => String(e ?? '').trim().toLowerCase();
  const validEmail = e => e.length <= 254 && /^[^@\s\u0000-\u001f\u007f]+@[^@\s\u0000-\u001f\u007f]+\.[^@\s\u0000-\u001f\u007f.]{2,}$/.test(e);
  const validPin = p => /^[0-9]{4,10}$/.test(p ?? '');
  const assertRate = (db, key) => {
    const mine = db.attempts.filter(a => a.key === key);
    if (mine.filter(a => a.at > now() - 15 * 60e3).length >= 10 || mine.filter(a => a.at > now() - 864e5).length >= 30) raise('rate_limited');
  };
  const clearAttempts = (db, key) => { db.attempts = db.attempts.filter(a => a.key !== key); };
  const newSession = (db, uid) => { const token = hex(32); db.sessions[token] = { user: uid, exp: now() + 30 * 864e5 }; return token; };
  const myTrees = (db, uid) => db.trees.filter(t => t.owner === uid).sort((a, b) => a.position - b.position || a.created_at - b.created_at);
  function ownedTree(db, uid, treeId) {
    const t = treeId == null ? myTrees(db, uid)[0] : db.trees.find(x => x.id === treeId && x.owner === uid);
    if (!t) raise('not_found');
    return t;
  }
  function treeJson(db, t) {
    const u = db.users.find(x => x.id === t.owner);
    return {
      id: t.id, name: u.name, title: t.title, pattern: t.pattern, settings: t.settings, share_id: t.share_id, position: t.position,
      messages: db.messages.filter(m => m.tree_id === t.id).map(m => ({ id: m.id, body: m.body })),
      photos: db.photos.filter(p => p.tree_id === t.id).map(p => ({ id: p.id, path: p.path, caption: p.caption }))
    };
  }
  const newTree = (owner, title = 'Merry Christmas', position = 0) =>
    ({ id: uuid(), owner, share_id: shareId(), title, pattern: 0, settings: {}, position, created_at: now() });
  const hasTicket = (db, path, kind, user) =>
    db.tickets.some(t => t.path === path && t.kind === kind && (!user || t.user === user) && t.exp > now());
  function treeByShare(db, shareIdValue) {
    const t = db.trees.find(x => x.share_id === shareIdValue);
    if (!t) raise('not_found');
    return t;
  }
  const findView = (db, v, t) => db.views.find(r => r.viewer === v && r.tree === t);
  function trimViews(db, v) {   // 본 기록은 최근 50개. 오래된 것 중 담은 트리는 기록만 지움
    const old = db.views.filter(r => r.viewer === v && r.viewed_at != null).sort((a, b) => b.viewed_at - a.viewed_at).slice(50);
    for (const r of old) r.saved ? (r.viewed_at = null) : (db.views = db.views.filter(x => x !== r));
  }
  const repack = (db, uid) => myTrees(db, uid).forEach((t, i) => { t.position = i; });

  const RPC = {
    /* ── 로그인 · 계정 ── */
    enter_tree(db, { p_name, p_email, p_pin, p_create = false }) {
      const name = norm(p_name), email = normEmail(p_email);
      if (!/^[가-힣]{2,10}$/.test(name)) raise('invalid_name');
      if (!validEmail(email)) raise('invalid_email');
      if (!validPin(p_pin)) raise('invalid_pin');
      const key = `${name}:${email}`;
      assertRate(db, key);
      db.attempts.push({ key, at: now() });
      let u = db.users.find(x => x.name === name && x.email === email);
      let created = false;
      if (!u) {
        if (!p_create) return { ok: false, error: 'not_found' };
        u = { id: uuid(), name, email, pin: p_pin, created_at: now() };
        db.users.push(u);
        db.trees.push(newTree(u.id));
        created = true;
      } else if (u.pin !== p_pin) {
        return { ok: false, error: 'wrong_pin' };
      }
      clearAttempts(db, key);
      return { ok: true, token: newSession(db, u.id), name, share_id: myTrees(db, u.id)[0].share_id, created };
    },
    change_pin(db, { p_token, p_old_pin, p_new_pin }) {
      const v = requireUser(db, p_token);
      if (!validPin(p_new_pin)) raise('invalid_pin');
      const u = db.users.find(x => x.id === v), key = `${u.name}:${u.email}`;
      assertRate(db, key);
      db.attempts.push({ key, at: now() });
      if (u.pin !== p_old_pin) return { ok: false, error: 'wrong_pin' };
      u.pin = p_new_pin;
      for (const [t, s] of Object.entries(db.sessions)) if (s.user === v && t !== p_token) delete db.sessions[t];
      return { ok: true };
    },
    // 실제로는 JWT(email, amr=otp 15분 이내)를 확인한다 → mock은 verifyOtp가 만든 auth 상태(ctx.auth)를 본다
    reset_pin(db, { p_name, p_new_pin }, ctx) {
      const name = norm(p_name);
      if (!/^[가-힣]{2,10}$/.test(name)) raise('invalid_name');
      if (!validPin(p_new_pin)) raise('invalid_pin');
      const a = ctx.auth;
      if (!a || a.at < now() - 15 * 60e3) raise('email_unverified');
      const u = db.users.find(x => x.name === name && x.email === a.email);
      if (!u) raise('not_found');
      u.pin = p_new_pin;
      for (const [t, s] of Object.entries(db.sessions)) if (s.user === u.id) delete db.sessions[t];
      clearAttempts(db, `${name}:${a.email}`);
      return { ok: true, token: newSession(db, u.id), name, share_id: myTrees(db, u.id)[0].share_id, created: false };
    },
    logout(db, { p_token }) {
      const had = p_token in db.sessions;
      delete db.sessions[p_token];
      return had;
    },

    /* ── 트리 ── */
    get_my_tree(db, { p_token, p_tree_id = null }) { return treeJson(db, ownedTree(db, requireUser(db, p_token), p_tree_id)); },
    get_tree(db, { p_share_id }) { return treeJson(db, treeByShare(db, p_share_id)); },
    update_tree(db, { p_token, p_title = null, p_pattern = null, p_settings = null, p_tree_id = null }) {
      const t = ownedTree(db, requireUser(db, p_token), p_tree_id);
      if (p_title != null && (len(p_title.trim()) < 1 || len(p_title.trim()) > 30)) raise('invalid_title');
      if (p_pattern != null && !(p_pattern >= 0 && p_pattern <= 7)) raise('invalid_pattern');
      if (p_settings != null && (typeof p_settings !== 'object' || Array.isArray(p_settings) || JSON.stringify(p_settings).length > 2048)) raise('invalid_settings');
      if (p_title != null) t.title = p_title.trim();
      if (p_pattern != null) t.pattern = p_pattern;
      if (p_settings != null) t.settings = p_settings;
      return treeJson(db, t);
    },
    list_my_trees(db, { p_token }) {
      const v = requireUser(db, p_token);
      return myTrees(db, v).map(t => ({
        id: t.id, share_id: t.share_id, title: t.title, pattern: t.pattern, position: t.position,
        messages: db.messages.filter(m => m.tree_id === t.id).length, photos: db.photos.filter(p => p.tree_id === t.id).length
      }));
    },
    create_tree(db, { p_token, p_title = null }) {
      const v = requireUser(db, p_token);
      const title = (p_title ?? '').trim() || 'Merry Christmas';
      if (len(title) > 30) raise('invalid_title');
      const mine = myTrees(db, v);
      if (mine.length >= 3) raise('tree_limit');
      const t = newTree(v, title, mine.length ? Math.max(...mine.map(x => x.position)) + 1 : 0);
      db.trees.push(t);
      return treeJson(db, t);
    },
    delete_tree(db, { p_token, p_tree_id }) {
      const v = requireUser(db, p_token);
      if (p_tree_id == null) raise('not_found');
      const t = ownedTree(db, v, p_tree_id);
      if (myTrees(db, v).length <= 1) raise('last_tree');
      if (db.photos.some(p => p.tree_id === t.id) || db.tickets.some(k => k.tree === t.id && k.kind === 'upload' && k.exp > now())) raise('tree_has_photos');
      db.trees = db.trees.filter(x => x !== t);
      db.messages = db.messages.filter(m => m.tree_id !== t.id);
      db.views = db.views.filter(r => r.tree !== t.id);
      repack(db, v);
      return true;
    },
    reorder_trees(db, { p_token, p_tree_ids }) {
      const v = requireUser(db, p_token), mine = myTrees(db, v);
      if (!Array.isArray(p_tree_ids) || p_tree_ids.length !== mine.length || new Set(p_tree_ids).size !== p_tree_ids.length
          || p_tree_ids.some(id => !mine.some(t => t.id === id))) raise('invalid_order');
      p_tree_ids.forEach((id, i) => { db.trees.find(t => t.id === id).position = i; });
      return true;
    },

    /* ── 글귀 ── */
    add_message(db, { p_token, p_body, p_tree_id = null }) {
      const t = ownedTree(db, requireUser(db, p_token), p_tree_id);
      const body = String(p_body ?? '').trim();
      if (len(body) < 1 || len(body) > 100) raise('invalid_message');
      if (db.messages.filter(m => m.tree_id === t.id).length >= 50) raise('limit_reached');
      const m = { id: db.seq++, tree_id: t.id, body };
      db.messages.push(m);
      return { id: m.id, body };
    },
    delete_message(db, { p_token, p_id }) {
      const v = requireUser(db, p_token);
      const i = db.messages.findIndex(m => m.id === p_id && db.trees.some(t => t.id === m.tree_id && t.owner === v));
      if (i < 0) return false;
      db.messages.splice(i, 1); return true;
    },

    /* ── 사진 ── */
    begin_photo_upload(db, { p_token, p_tree_id = null }) {
      const v = requireUser(db, p_token), t = ownedTree(db, v, p_tree_id);
      const pending = db.tickets.filter(k => k.tree === t.id && k.kind === 'upload' && k.exp > now()).length;
      if (db.photos.filter(p => p.tree_id === t.id).length + pending >= 30) raise('limit_reached');
      const path = `${t.id}/${uuid()}.jpg`;
      db.tickets.push({ path, kind: 'upload', user: v, tree: t.id, exp: now() + 10 * 60e3 });
      return path;
    },
    finish_photo_upload(db, { p_token, p_path, p_caption = '' }) {
      const v = requireUser(db, p_token);
      const k = db.tickets.find(x => x.path === p_path && x.kind === 'upload' && x.user === v);
      if (!k) raise('invalid_ticket');
      if (!(p_path in db.objects)) raise('file_missing');
      const p = { id: db.seq++, tree_id: k.tree, path: p_path, caption: [...String(p_caption ?? '').trim()].slice(0, 30).join('') };
      db.photos.push(p);
      db.tickets = db.tickets.filter(x => !(x.path === p_path && x.kind === 'upload'));
      return { id: p.id, path: p.path, caption: p.caption };
    },
    begin_photo_delete(db, { p_token, p_photo_id }) {
      const v = requireUser(db, p_token);
      const p = db.photos.find(x => x.id === p_photo_id && db.trees.some(t => t.id === x.tree_id && t.owner === v));
      if (!p) raise('not_found');
      db.tickets = db.tickets.filter(k => !(k.path === p.path && k.kind === 'delete'));
      db.tickets.push({ path: p.path, kind: 'delete', user: v, tree: p.tree_id, exp: now() + 10 * 60e3 });
      return p.path;
    },
    finish_photo_delete(db, { p_token, p_photo_id }) {
      const v = requireUser(db, p_token);
      const p = db.photos.find(x => x.id === p_photo_id && db.trees.some(t => t.id === x.tree_id && t.owner === v));
      if (!p) return false;
      if (p.path in db.objects) raise('file_still_exists');
      db.photos = db.photos.filter(x => x !== p);
      db.tickets = db.tickets.filter(k => k.path !== p.path);
      return true;
    },

    /* ── 본 기록 · 담은 트리 ── */
    record_view(db, { p_token, p_share_id }) {
      const v = requireUser(db, p_token), t = treeByShare(db, p_share_id);
      if (t.owner === v) return { own: true, saved: false };
      let r = findView(db, v, t.id);
      if (!r) { r = { viewer: v, tree: t.id, saved: false, saved_at: null, viewed_at: null }; db.views.push(r); }
      r.viewed_at = now();
      trimViews(db, v);
      return { own: false, saved: r.saved };
    },
    list_trees(db, { p_token }) {
      const v = requireUser(db, p_token);
      const iso = ms => (ms == null ? null : new Date(ms).toISOString());
      return db.views.filter(r => r.viewer === v)
        .sort((a, b) => (b.viewed_at ?? b.saved_at) - (a.viewed_at ?? a.saved_at))
        .map(r => {
          const t = db.trees.find(x => x.id === r.tree), u = db.users.find(x => x.id === t.owner);
          return { share_id: t.share_id, name: u.name, title: t.title, saved: r.saved, saved_at: iso(r.saved_at), viewed_at: iso(r.viewed_at) };
        });
    },
    set_saved(db, { p_token, p_share_id, p_saved }) {
      const v = requireUser(db, p_token), t = treeByShare(db, p_share_id);
      if (t.owner === v) raise('own_tree');
      let r = findView(db, v, t.id);
      if (p_saved) {
        if (!(r && r.saved) && db.views.filter(x => x.viewer === v && x.saved).length >= 100) raise('save_limit');
        if (!r) { r = { viewer: v, tree: t.id, saved: false, saved_at: null, viewed_at: null }; db.views.push(r); }
        if (!r.saved) { r.saved = true; r.saved_at = now(); }
        return true;
      }
      if (r && r.viewed_at == null) db.views = db.views.filter(x => x !== r);
      else if (r) { r.saved = false; r.saved_at = null; }
      return false;
    },
    forget_views(db, { p_token, p_share_id = null }) {
      const v = requireUser(db, p_token);
      let tid = null;
      if (p_share_id != null) { const t = db.trees.find(x => x.share_id === p_share_id); if (!t) return 0; tid = t.id; }
      let n = 0;
      db.views = db.views.filter(r => {
        if (r.viewer !== v || (tid && r.tree !== tid)) return true;
        if (!r.saved) { n++; return false; }
        if (r.viewed_at != null) { r.viewed_at = null; n++; }
        return true;
      });
      return n;
    },
    merge_views(db, { p_token, p_items }) {
      const v = requireUser(db, p_token);
      if (!Array.isArray(p_items)) raise('invalid_items');
      const best = new Map();
      for (const e of p_items.slice(0, 50)) {
        if (!e || typeof e !== 'object') continue;
        const t = db.trees.find(x => x.share_id === e.share_id);
        if (!t || t.owner === v) continue;
        const at = Math.min(Number.isFinite(Date.parse(e.viewed_at)) ? Date.parse(e.viewed_at) : now(), now());
        best.set(t.id, Math.max(best.get(t.id) ?? 0, at));
      }
      for (const [tid, at] of best) {
        let r = findView(db, v, tid);
        if (!r) { r = { viewer: v, tree: tid, saved: false, saved_at: null, viewed_at: null }; db.views.push(r); }
        r.viewed_at = Math.max(r.viewed_at ?? at, at);
      }
      trimViews(db, v);
      return best.size;
    }
  };

  const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const mock = window.__mock = {
    fail: null,
    delays: {},        // { get_my_tree: 1500 } 처럼 느린 네트워크 흉내 (ms)
    db: load,
    reset() { save(blank()); },
    expireSessions() { const db = load(); for (const s of Object.values(db.sessions)) s.exp = 0; save(db); },
    lastCode(email) { return load().mail.filter(m => m.email === normEmail(email)).at(-1)?.code ?? null; },
    authFail: null
  };
  function takeFailure(fn) {
    if (mock.fail && mock.fail.fn === fn) {
      const f = mock.fail; if (!f.sticky) mock.fail = null;
      return { data: null, error: f.error === 'network'
        ? { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }
        : { message: f.error, code: 'P0001', details: null, hint: null } };
    }
    return null;
  }

  const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

  function createClient(url, key) {
    if (!url || !key) throw new Error('supabaseUrl and supabaseKey are required');
    const ctx = { auth: null };   // 이 클라이언트의 Supabase Auth 로그인 상태 (메모리, persistSession:false와 같음)
    return {
      auth: {
        async signInWithOtp({ email, options = {} } = {}) {
          await wait();
          const f = mock.authFail; mock.authFail = null;
          if (f === 'send') return { data: {}, error: { status: 500, code: 'unexpected_failure', message: 'Error sending magic link email' } };
          const db = load(), e = normEmail(email);
          const last = db.mail.filter(m => m.email === e).at(-1);
          if (f === 'rate' || (last && last.at > now() - 60e3))
            return { data: {}, error: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 59 seconds.' } };
          if (options.shouldCreateUser === false) return { data: {}, error: { status: 422, code: 'otp_disabled', message: 'Signups not allowed for otp' } };
          db.mail.push({ email: e, code: String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000), at: now(), used: false });
          db.log.push('auth.signInWithOtp');
          save(db);
          return { data: { user: null, session: null }, error: null };
        },
        async verifyOtp({ email, token, type } = {}) {
          await wait();
          const db = load(), e = normEmail(email);
          const m = db.mail.filter(x => x.email === e).at(-1);
          if (type !== 'email' || !m || m.used || m.code !== token || m.at < now() - 3600e3)
            return { data: { user: null, session: null }, error: { status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' } };
          m.used = true;
          db.log.push('auth.verifyOtp');
          save(db);
          ctx.auth = { email: e, at: now() };
          return { data: { user: { email: e }, session: { access_token: 'mock-jwt' } }, error: null };
        },
        async signOut() { ctx.auth = null; return { error: null }; }
      },
      async rpc(fn, args = {}) {
        await wait(mock.delays[fn] ?? 40);
        const failed = takeFailure(fn);
        if (failed) return failed;
        const db = load();
        db.log.push(fn);
        if (!RPC[fn]) return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
        try {
          // 실제 DB처럼: 예외면 롤백(저장 안 함), 정상 반환이면 커밋
          const data = RPC[fn](db, JSON.parse(JSON.stringify(args)), ctx);
          save(db);
          return { data, error: null };
        } catch (e) {
          if (e instanceof Raise) { const d = load(); d.log.push(fn); save(d); return { data: null, error: { message: e.message, code: 'P0001', details: null, hint: null } }; }
          throw e;
        }
      },
      storage: {
        from(bucket) {
          return {
            async upload(path, blob, o = {}) {
              await wait();
              const failed = takeFailure('storage.upload');
              if (failed) return failed;
              const db = load();
              if (bucket !== 'tree-photos' || !hasTicket(db, path, 'upload') || path in db.objects)
                return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
              if (blob.size > 2 * 1024 * 1024 || (o.contentType || blob.type) !== 'image/jpeg')
                return { data: null, error: { message: 'invalid_mime_type_or_size', statusCode: '415' } };
              db.objects[path] = await blobToDataUrl(blob);
              save(db);
              return { data: { path, id: uuid(), fullPath: `${bucket}/${path}` }, error: null };
            },
            async remove(paths) {
              await wait();
              const failed = takeFailure('storage.remove');
              if (failed) return failed;
              const db = load();
              // RLS처럼: 삭제 티켓이 없는 파일은 조용히 건너뜀 (오류 없이 빈 배열)
              const removed = paths.filter(p => hasTicket(db, p, 'delete') && p in db.objects);
              removed.forEach(p => delete db.objects[p]);
              save(db);
              return { data: removed.map(name => ({ name })), error: null };
            },
            getPublicUrl(path) {
              return { data: { publicUrl: load().objects[path] || TRANSPARENT } };
            }
          };
        }
      }
    };
  }

  // 실제 UMD가 나중에 로드되더라도 mock이 덮어써지지 않도록 고정
  Object.defineProperty(window, 'supabase', { value: { createClient }, writable: false, configurable: false });
})();
