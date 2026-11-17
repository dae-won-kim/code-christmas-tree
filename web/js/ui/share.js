/**
 * 공유 보기 (읽기 전용) — ?t=<share_id>
 *  - "OOO님의 트리" 표시, [나도 트리 만들기] / [내 트리로 가기]
 *  - [☆ 담기]: 로그인했으면 바로 내 목록에 담고, 아니면 로그인 화면으로 보낸 뒤 로그인하면 담는다
 *  - 본 기록: 로그인했으면 DB(record_view), 아니면 이 브라우저에 기록
 *  - 무늬 바꾸기는 보는 사람 화면에서만 바뀌고 저장되지 않는다
 */
import { $, toast } from './dom.js';
import { localHistory, pendingSave } from './library.js';

/** 공유 링크에서 ?t=를 뺀 주소 (나도 만들기 → 로그인 화면) */
export function homeUrl() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  return u.toString();
}

/**
 * @param {{ api, tree, data, shareId: string, library, onHome: () => void, onOpenMine: (treeId) => void }} deps
 * @returns {{ destroy(): void }}
 */
export function mountShare({ api, tree, data, shareId, library, onHome, onOpenMine }) {
  const ac = new AbortController(), on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  const owner = $('owner'), make = $('btnMake'), save = $('btnSave');
  let saved = false, own = false, busy = false, destroyed = false;

  owner.textContent = `${data.name}님의 트리`;
  owner.hidden = false;
  document.title = `${data.name}님의 트리 · Code Christmas Tree`;
  make.href = homeUrl();

  function paint() {
    make.textContent = own ? '✎ 이 트리 꾸미기' : api.loggedIn ? '🎄 내 트리로 가기' : '✨ 나도 트리 만들기';
    save.hidden = own;
    save.textContent = saved ? '★ 담김' : '☆ 담기';
    save.setAttribute('aria-pressed', String(saved));
    save.setAttribute('aria-label', saved ? `${data.name}님의 트리 담기 취소` : `${data.name}님의 트리를 내 목록에 담기`);
  }

  // 본 기록 남기기
  const asGuest = () => { localHistory.add({ share_id: shareId, name: data.name, title: data.title }); library.refresh(); };
  if (api.loggedIn) {
    save.hidden = true;                          // 내 트리인지 알기 전에는 숨김
    api.recordView(shareId)
      .then(r => { if (destroyed) return; own = r.own; saved = r.saved; paint(); library.refresh(); })
      .catch(() => { if (destroyed) return; asGuest(); paint(); });   // 세션 만료 등 → 브라우저 기록으로
  } else {
    asGuest();
    paint();
  }

  on(save, 'click', async () => {
    if (busy) return;
    if (!api.loggedIn) {
      // 로그인 화면으로 갔다가, 로그인하면 main.js가 이 트리를 담는다
      pendingSave.set({ share_id: shareId, name: data.name });
      onHome();
      return;
    }
    busy = true; save.disabled = true;
    try {
      saved = await api.setSaved(shareId, !saved);
      toast(saved ? `${data.name}님의 트리를 담았어요. 왼쪽 위 ☰ 목록에서 다시 볼 수 있어요.` : '담기를 취소했어요.');
      library.refresh();
    } catch (e) {
      toast(e.message, { error: true });
      if (e.code === 'unauthorized') saved = false;
    } finally {
      busy = false; save.disabled = false; paint();
    }
  });
  // 목록(서랍)에서 담기를 취소하면 버튼도 맞춰 바꿈
  on(document, 'tree:saved-change', e => { if (e.detail.shareId === shareId) { saved = e.detail.saved; paint(); } });

  on(make, 'click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    own ? onOpenMine(data.id) : onHome();   // 내 트리의 공유 링크면 바로 그 트리 편집으로
  });
  on($('btnPattern'), 'click', () => tree.nextPattern());
  tree.layout();   // 제목 아래 줄이 생겨서 트리 배치를 다시 계산

  return {
    destroy() {
      destroyed = true;
      ac.abort();
      owner.hidden = true;
      save.hidden = true;
      document.title = 'Code Christmas Tree';
    }
  };
}
