/**
 * 공유 보기 (읽기 전용) — ?t=<share_id>
 *  - "OOO님의 트리" 표시, [나도 트리 만들기] 버튼
 *  - 무늬 바꾸기는 보는 사람 화면에서만 바뀌고 저장되지 않는다
 */
import { $ } from './dom.js';

/** 공유 링크에서 ?t=를 뺀 주소 (나도 만들기 → 로그인 화면) */
export function homeUrl() {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  return u.toString();
}

/**
 * @param {{ api, tree, data }} deps
 * @returns {{ destroy(): void }}
 */
export function mountShare({ api, tree, data }) {
  const ac = new AbortController();
  const owner = $('owner'), make = $('btnMake');
  owner.textContent = `${data.name}님의 트리`;
  owner.hidden = false;
  document.title = `${data.name}님의 트리 · Code Christmas Tree`;

  make.href = homeUrl();
  make.textContent = api.loggedIn ? '🎄 내 트리로 가기' : '✨ 나도 트리 만들기';

  $('btnPattern').addEventListener('click', () => tree.nextPattern(), { signal: ac.signal });
  tree.layout();   // 제목 아래 줄이 생겨서 트리 배치를 다시 계산

  return {
    destroy() {
      ac.abort();
      owner.hidden = true;
      document.title = 'Code Christmas Tree';
    }
  };
}
