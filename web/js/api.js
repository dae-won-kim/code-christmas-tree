/**
 * TreeApi — 브라우저가 DB에 접근하는 유일한 통로
 *
 *  - 모든 DB 접근은 Supabase RPC(public 스키마 함수)로만 한다. 테이블 직접 조회(.from())는 쓰지 않는다.
 *    (테이블은 RLS + 권한 회수로 막혀 있어서 어차피 실패함)
 *  - 로그인 후 받은 세션 토큰을 localStorage에 보관하고 모든 RPC에 p_token으로 넘긴다.
 *  - DB가 던지는 짧은 오류 코드('invalid_name' 등)를 TreeError로 감싸고, 한국어 메시지를 붙인다.
 *
 * 의존: index.html에서 supabase-js UMD(window.supabase)를 먼저 로드해야 한다.
 * 함수 명세: docs/DATABASE.md
 */
import { shrinkImage } from './image.js';

export const BUCKET = 'tree-photos';
const TOKEN_KEY = 'code-christmas-tree.token';

export const ERROR_MESSAGES = {
  invalid_name:      '이름은 한글 2~10자로 입력해 주세요. (공백·영문·숫자 불가)',
  invalid_birth:     '생년월일은 6자리 숫자(예: 990101)로 입력해 주세요.',
  invalid_password:  '비밀번호는 6~64자로 입력해 주세요.',
  not_found:         '이름·생년월일·비밀번호가 맞는 트리가 없어요.',
  rate_limited:      '시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.',
  unauthorized:      '로그인이 만료됐어요. 다시 로그인해 주세요.',
  invalid_title:     '제목은 1~30자로 입력해 주세요.',
  invalid_pattern:   '알 수 없는 트리 무늬예요.',
  invalid_settings:  '설정 값이 올바르지 않아요.',
  invalid_message:   '글귀는 1~100자로 입력해 주세요.',
  limit_reached:     '더 이상 추가할 수 없어요. (글귀 50개, 사진 30장까지)',
  invalid_ticket:    '사진 업로드가 만료됐어요. 다시 시도해 주세요.',
  file_missing:      '사진 파일이 업로드되지 않았어요. 다시 시도해 주세요.',
  file_still_exists: '사진 파일을 지우지 못했어요. 다시 시도해 주세요.',
  wrong_password:    '현재 비밀번호가 맞지 않아요.',
  password_unavailable: '그 비밀번호는 쓸 수 없어요. 다른 비밀번호를 골라 주세요.',
  tree_limit:        '트리는 3개까지 만들 수 있어요.',
  last_tree:         '마지막 남은 트리는 지울 수 없어요.',
  tree_has_photos:   '사진이 있는 트리는 지울 수 없어요. 꾸미기 → 사진에서 먼저 지워 주세요.',
  invalid_order:     '트리 순서가 올바르지 않아요. 새로고침 후 다시 시도해 주세요.',
  own_tree:          '내 트리는 목록에 담을 수 없어요.',
  save_limit:        '담은 트리는 100개까지예요. 안 보는 트리를 빼 주세요.',
  invalid_items:     '기록 형식이 올바르지 않아요.',
  image_decode_failed: '사진을 읽지 못했어요. 다른 사진으로 시도해 주세요.',
  image_too_large:   '사진 용량이 너무 커요.',
  network:           '네트워크 연결을 확인해 주세요.',
  not_configured:    '서버 설정(config.js)이 비어 있어요.',
  unknown:           '알 수 없는 오류가 발생했어요.'
};

export class TreeError extends Error {
  constructor(code, detail) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown);
    this.code = ERROR_MESSAGES[code] ? code : 'unknown';
    this.detail = detail;
  }
}

/** DB/네트워크 오류 객체 → TreeError */
function toTreeError(err) {
  if (err instanceof TreeError) return err;
  const msg = String(err?.message || err || '');
  const code = Object.keys(ERROR_MESSAGES).find(c => msg === c || msg.includes(c));
  if (code) return new TreeError(code, msg);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new TreeError('network', msg);
  return new TreeError('unknown', msg);
}

/** 이름 정규화 (DB의 private.normalize_name과 동일 규칙) */
export const normalizeName = name => String(name || '').trim().normalize('NFC');
export const isValidName = name => /^[가-힣]{2,10}$/.test(normalizeName(name));
/** 생년월일 YYMMDD (DB의 private.valid_birth와 같은 규칙: 실제로 있는 월·일, 2월 29일 허용) */
export function isValidBirth(birth) {
  const v = String(birth || '');
  if (!/^[0-9]{6}$/.test(v)) return false;
  const m = +v.slice(2, 4), d = +v.slice(4, 6);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(2000, m, 0).getDate();   // 2000년은 윤년
}
/** 비밀번호: 6~64자, 제어 문자 없음 (영문·숫자·기호·한글·공백 가능) */
export const isValidPassword = pw => { const n = [...String(pw ?? '')].length; return n >= 6 && n <= 64 && !/[\u0000-\u001f\u007f]/.test(pw); };

export class TreeApi {
  /** @param {{url: string, key: string}} config  SUPABASE_URL, Publishable key */
  constructor({ url, key }) {
    if (!url || !key || !window.supabase?.createClient) throw new TreeError('not_configured');
    // Supabase Auth는 쓰지 않으므로 세션 저장 끔
    this.sb = window.supabase.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    try { this.token = localStorage.getItem(TOKEN_KEY); } catch { this.token = null; }
  }

  get loggedIn() { return !!this.token; }

  #setToken(token) {
    this.token = token;
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* 저장 불가 환경 */ }
  }

  async #rpc(fn, args = {}) {
    let res;
    try { res = await this.sb.rpc(fn, args); }
    catch (e) { throw toTreeError(e); }
    if (res.error) {
      const err = toTreeError(res.error);
      if (err.code === 'unauthorized') this.#setToken(null);   // 만료된 토큰은 버림
      throw err;
    }
    return res.data;
  }

  async #auth(fn, args = {}) {
    if (!this.token) throw new TreeError('unauthorized');
    return this.#rpc(fn, { p_token: this.token, ...args });
  }

  /* ── 로그인 / 계정 ─────────────────────────────────── */

  /**
   * 트리 열기. create=false면 로그인만, true면 없을 때 새로 만듦(첫 트리 포함).
   * 사용자 = (이름, 생년월일 6자리, 비밀번호)
   * @returns {Promise<{token, name, share_id, created}>}
   */
  async enter(name, birth, password, { create = false } = {}) {
    const r = await this.#rpc('enter_tree', {
      p_name: normalizeName(name), p_birth: String(birth), p_password: String(password), p_create: create
    });
    if (!r.ok) throw new TreeError(r.error);
    this.#setToken(r.token);
    return r;
  }

  async changePassword(oldPassword, newPassword) {
    const r = await this.#auth('change_password', { p_old_password: String(oldPassword), p_new_password: String(newPassword) });
    if (!r.ok) throw new TreeError(r.error);
    return true;
  }

  async logout() {
    try { if (this.token) await this.#rpc('logout', { p_token: this.token }); }
    finally { this.#setToken(null); }
  }

  /* ── 트리 ──────────────────────────────────────────── */

  /** @returns {Promise<Tree>} 내 트리 전체 (제목·무늬·설정·글귀·사진). treeId가 없으면 맨 앞 트리 */
  getMyTree(treeId = null) { return this.#auth('get_my_tree', { p_tree_id: treeId }); }

  /** @returns {Promise<{id, share_id, title, pattern, position, messages, photos}[]>} 내 트리 목록(순서대로, 최대 3개) */
  listMyTrees() { return this.#auth('list_my_trees'); }
  /** 새 트리 (3개까지) → Tree */
  createTree(title = null) { return this.#auth('create_tree', { p_title: title }); }
  /** 트리 지우기 (사진이 없는 트리만, 마지막 1개는 불가) */
  deleteTree(treeId) { return this.#auth('delete_tree', { p_tree_id: treeId }); }
  /** 순서 바꾸기: 내 트리 id 전체를 원하는 순서로 */
  reorderTrees(treeIds) { return this.#auth('reorder_trees', { p_tree_ids: treeIds }); }

  /** 공유 링크(?t=share_id)로 남의 트리 보기 — 로그인 불필요 */
  getTree(shareId) { return this.#rpc('get_tree', { p_share_id: shareId }); }

  /** null/undefined인 값은 그대로 둠. 트리 이름 바꾸기 = title */
  updateTree({ title = null, pattern = null, settings = null } = {}, treeId = null) {
    return this.#auth('update_tree', { p_title: title, p_pattern: pattern, p_settings: settings, p_tree_id: treeId });
  }

  /* ── 글귀 ──────────────────────────────────────────── */

  addMessage(body, treeId = null) { return this.#auth('add_message', { p_body: body, p_tree_id: treeId }); }
  deleteMessage(id) { return this.#auth('delete_message', { p_id: id }); }

  /* ── 본 기록 · 담은 트리 (읽기 전용 목록) ─────────────── */

  /** 공유 보기를 열 때: 본 기록 남기기 → { own: 내 트리인가, saved: 담아 둔 트리인가 } */
  recordView(shareId) { return this.#auth('record_view', { p_share_id: shareId }); }

  /** @returns {Promise<{share_id, name, title, saved, saved_at, viewed_at}[]>} 최근 순 */
  listTrees() { return this.#auth('list_trees'); }

  /** [담기] / [담기 취소] */
  setSaved(shareId, saved) { return this.#auth('set_saved', { p_share_id: shareId, p_saved: !!saved }); }

  /** 본 기록 지우기. shareId가 없으면 전부 (담은 트리는 남음) */
  forgetViews(shareId = null) { return this.#auth('forget_views', { p_share_id: shareId }); }

  /** 로그인 전에 이 브라우저에서 본 기록을 내 목록에 합치기 */
  mergeViews(items) {
    return this.#auth('merge_views', { p_items: items.map(i => ({ share_id: i.share_id, viewed_at: i.viewed_at })) });
  }

  /* ── 사진 ──────────────────────────────────────────── */

  /** 공개 URL (버킷이 public이라 그대로 <img>/캔버스에 사용 가능) */
  photoUrl(path) { return this.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

  /**
   * 사진 업로드: ① 줄이기 → ② 경로 발급(티켓) → ③ Storage 업로드 → ④ 확정
   * @param {File} file
   * @param {string} caption 30자 이내
   * @param {(step: 'resize'|'upload'|'save') => void} [onStep] 진행 표시용
   * @returns {Promise<{id, path, caption}>}
   */
  async uploadPhoto(file, caption = '', onStep = () => {}, treeId = null) {
    onStep('resize');
    let blob;
    try { blob = await shrinkImage(file); } catch (e) { throw toTreeError(e); }
    const path = await this.#auth('begin_photo_upload', { p_tree_id: treeId });
    onStep('upload');
    const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw toTreeError(error);
    onStep('save');
    return this.#auth('finish_photo_upload', { p_path: path, p_caption: caption });
  }

  /** 사진 삭제: ① 삭제 티켓 → ② Storage에서 파일 삭제 → ③ DB 행 삭제 확정 */
  async deletePhoto(photoId) {
    const path = await this.#auth('begin_photo_delete', { p_photo_id: photoId });
    const { error } = await this.sb.storage.from(BUCKET).remove([path]);
    if (error) throw toTreeError(error);
    return this.#auth('finish_photo_delete', { p_photo_id: photoId });
  }
}

/**
 * @typedef {Object} Tree
 * @property {string} name
 * @property {string} title
 * @property {string} id        트리 id (사용자당 최대 3개)
 * @property {number} pattern   0~7 (js/tree/patterns.js의 PATTERNS 순서)
 * @property {Object} settings  자유 형식(2KB 이내) — 예: { autoRotate: true, patternCycle: false }
 * @property {string} share_id
 * @property {{id:number, body:string}[]} messages
 * @property {{id:number, path:string, caption:string}[]} photos
 */
