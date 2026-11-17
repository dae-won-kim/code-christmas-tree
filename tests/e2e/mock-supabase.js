/**
 * E2E 테스트용 window.supabase mock (브라우저에 addInitScript로 주입)
 *
 *  - supabase/migrations/20261117000000_init.sql의 RPC 동작을 메모리에서 흉내 낸다.
 *    (오류 코드, {ok:false} 반환, 티켓 방식 업로드·삭제, 30장/50개 제한, 속도 제한)
 *  - 상태는 localStorage('__mockdb')에 저장 → 새로고침해도 유지
 *  - 실제 보안은 DB 테스트(supabase/tests)가 검증한다. 여기서는 화면 흐름만 검증한다.
 *
 * 테스트에서 쓰는 훅
 *   window.__mock.db()            현재 상태(JSON)
 *   window.__mock.fail = { fn, error }   다음 fn 호출을 실패시킴 (error: 'network' 또는 오류 코드)
 *   window.__mock.expireSessions()      모든 세션 만료
 */
(() => {
  const KEY = '__mockdb';
  const blank = () => ({ seq: 1, users: [], sessions: {}, attempts: [], tickets: [], messages: [], photos: [], objects: {}, log: [] });
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); } };
  const save = db => localStorage.setItem(KEY, JSON.stringify(db));
  const uuid = () => crypto.randomUUID();
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const shareId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/\+/g, '-').replace(/\//g, '_');
  const now = () => Date.now();
  const norm = s => String(s ?? '').trim().normalize('NFC');

  class Raise extends Error {}
  const raise = code => { throw new Raise(code); };

  function requireUser(db, token) {
    const s = db.sessions[token];
    if (!s || s.exp < now()) raise('unauthorized');
    return s.user;
  }
  function treeJson(db, uid) {
    const u = db.users.find(x => x.id === uid);
    return {
      name: u.name, title: u.title, pattern: u.pattern, settings: u.settings, share_id: u.share_id,
      messages: db.messages.filter(m => m.user_id === uid).map(m => ({ id: m.id, body: m.body })),
      photos: db.photos.filter(p => p.user_id === uid).map(p => ({ id: p.id, path: p.path, caption: p.caption }))
    };
  }
  const assertRate = (db, name) => {
    if (db.attempts.filter(a => a.name === name && a.at > now() - 15 * 60e3).length >= 10) raise('rate_limited');
  };
  const len = s => [...s].length;
  const hasTicket = (db, path, kind, user) =>
    db.tickets.some(t => t.path === path && t.kind === kind && (!user || t.user === user) && t.exp > now());

  const RPC = {
    enter_tree(db, { p_name, p_pin, p_create = false }) {
      const name = norm(p_name);
      if (!/^[가-힣]{2,10}$/.test(name)) raise('invalid_name');
      if (!/^[0-9]{4,6}$/.test(p_pin ?? '')) raise('invalid_pin');
      assertRate(db, name);
      db.attempts.push({ name, at: now() });
      let u = db.users.find(x => x.name === name && x.pin === p_pin);
      let created = false;
      if (!u) {
        if (!p_create) return { ok: false, error: 'not_found' };
        u = { id: uuid(), name, pin: p_pin, share_id: shareId(), title: 'Merry Christmas', pattern: 0, settings: {}, created_at: now() };
        db.users.push(u); created = true;
      }
      const token = hex(32);
      db.sessions[token] = { user: u.id, exp: now() + 30 * 864e5 };
      return { ok: true, token, name, share_id: u.share_id, created };
    },
    get_my_tree(db, { p_token }) { return treeJson(db, requireUser(db, p_token)); },
    get_tree(db, { p_share_id }) {
      const u = db.users.find(x => x.share_id === p_share_id);
      if (!u) raise('not_found');
      return treeJson(db, u.id);
    },
    update_tree(db, { p_token, p_title = null, p_pattern = null, p_settings = null }) {
      const uid = requireUser(db, p_token);
      if (p_title != null && (len(p_title.trim()) < 1 || len(p_title.trim()) > 30)) raise('invalid_title');
      if (p_pattern != null && !(p_pattern >= 0 && p_pattern <= 3)) raise('invalid_pattern');
      if (p_settings != null && (typeof p_settings !== 'object' || Array.isArray(p_settings) || JSON.stringify(p_settings).length > 2048)) raise('invalid_settings');
      const u = db.users.find(x => x.id === uid);
      if (p_title != null) u.title = p_title.trim();
      if (p_pattern != null) u.pattern = p_pattern;
      if (p_settings != null) u.settings = p_settings;
      return treeJson(db, uid);
    },
    add_message(db, { p_token, p_body }) {
      const uid = requireUser(db, p_token);
      const body = String(p_body ?? '').trim();
      if (len(body) < 1 || len(body) > 100) raise('invalid_message');
      if (db.messages.filter(m => m.user_id === uid).length >= 50) raise('limit_reached');
      const m = { id: db.seq++, user_id: uid, body };
      db.messages.push(m);
      return { id: m.id, body };
    },
    delete_message(db, { p_token, p_id }) {
      const uid = requireUser(db, p_token);
      const i = db.messages.findIndex(m => m.id === p_id && m.user_id === uid);
      if (i < 0) return false;
      db.messages.splice(i, 1); return true;
    },
    begin_photo_upload(db, { p_token }) {
      const uid = requireUser(db, p_token);
      const pending = db.tickets.filter(t => t.user === uid && t.kind === 'upload' && t.exp > now()).length;
      if (db.photos.filter(p => p.user_id === uid).length + pending >= 30) raise('limit_reached');
      const path = `${uid}/${uuid()}.jpg`;
      db.tickets.push({ path, kind: 'upload', user: uid, exp: now() + 10 * 60e3 });
      return path;
    },
    finish_photo_upload(db, { p_token, p_path, p_caption = '' }) {
      const uid = requireUser(db, p_token);
      if (!db.tickets.some(t => t.path === p_path && t.kind === 'upload' && t.user === uid)) raise('invalid_ticket');
      if (!(p_path in db.objects)) raise('file_missing');
      const p = { id: db.seq++, user_id: uid, path: p_path, caption: [...String(p_caption ?? '').trim()].slice(0, 30).join('') };
      db.photos.push(p);
      db.tickets = db.tickets.filter(t => !(t.path === p_path && t.kind === 'upload'));
      return { id: p.id, path: p.path, caption: p.caption };
    },
    begin_photo_delete(db, { p_token, p_photo_id }) {
      const uid = requireUser(db, p_token);
      const p = db.photos.find(x => x.id === p_photo_id && x.user_id === uid);
      if (!p) raise('not_found');
      db.tickets = db.tickets.filter(t => !(t.path === p.path && t.kind === 'delete'));
      db.tickets.push({ path: p.path, kind: 'delete', user: uid, exp: now() + 10 * 60e3 });
      return p.path;
    },
    finish_photo_delete(db, { p_token, p_photo_id }) {
      const uid = requireUser(db, p_token);
      const p = db.photos.find(x => x.id === p_photo_id && x.user_id === uid);
      if (!p) return false;
      if (p.path in db.objects) raise('file_still_exists');
      db.photos = db.photos.filter(x => x !== p);
      db.tickets = db.tickets.filter(t => t.path !== p.path);
      return true;
    },
    change_pin(db, { p_token, p_old_pin, p_new_pin }) {
      const uid = requireUser(db, p_token);
      if (!/^[0-9]{4,6}$/.test(p_new_pin ?? '')) raise('invalid_pin');
      const u = db.users.find(x => x.id === uid);
      assertRate(db, u.name);
      db.attempts.push({ name: u.name, at: now() });
      if (u.pin !== p_old_pin) return { ok: false, error: 'wrong_pin' };
      if (db.users.some(x => x.name === u.name && x.pin === p_new_pin)) return { ok: false, error: 'pin_unavailable' };
      u.pin = p_new_pin;
      for (const [t, s] of Object.entries(db.sessions)) if (s.user === uid && t !== p_token) delete db.sessions[t];
      return { ok: true };
    },
    logout(db, { p_token }) {
      const had = p_token in db.sessions;
      delete db.sessions[p_token];
      return had;
    }
  };

  const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const mock = window.__mock = {
    fail: null,
    db: load,
    reset() { save(blank()); },
    expireSessions() { const db = load(); for (const s of Object.values(db.sessions)) s.exp = 0; save(db); }
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

  function createClient(url, key, opts) {
    if (!url || !key) throw new Error('supabaseUrl and supabaseKey are required');
    return {
      async rpc(fn, args = {}) {
        await wait();
        const failed = takeFailure(fn);
        if (failed) return failed;
        const db = load();
        db.log.push(fn);
        if (!RPC[fn]) return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } };
        try {
          // 실제 DB처럼: 예외면 롤백(저장 안 함), 정상 반환이면 커밋
          const data = RPC[fn](db, JSON.parse(JSON.stringify(args)));
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
