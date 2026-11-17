/*
 * Supabase 연결 설정 — 이 파일을 config.js로 복사해서 값을 채우세요.
 *   cp web/config.example.js web/config.js
 *
 * - config.js는 .gitignore에 들어 있어 저장소에 올라가지 않습니다.
 * - GitHub Pages 배포 때는 워크플로(.github/workflows/pages.yml)가
 *   저장소 Variables(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)로 config.js를 자동 생성합니다.
 * - 여기에 넣는 키는 공개용(Publishable, sb_publishable_...)입니다.
 *   ⚠ secret key(sb_secret_...)나 service_role key는 절대 넣지 마세요.
 */
window.TREE_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_KEY: 'sb_publishable_XXXXXXXXXXXXXXXX'
};
