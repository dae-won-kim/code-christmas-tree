# 🎄 Code Christmas Tree

코드로 그리는 파티클 3D 크리스마스 트리. **한글 이름 + PIN**으로 나만의 트리를 만들고,
글귀와 사진을 걸어서 링크 하나로 친구에게 보여주세요.

- ✨ 수천 개의 빛 입자로 된 3D 트리. 드래그해서 돌려 볼 수 있습니다
- 🎨 무늬 4종(나선 리본 · 층층 전나무 · 빛의 고리 · 얼음 크리스탈)이 모핑 애니메이션으로 바뀝니다
- 📷 사진은 위에서 떨어지거나 반짝 나타났다 사라지고, 누르면 확대됩니다
- ✍️ 글귀가 타이핑 효과로 한 줄씩 나옵니다
- 📱 모바일·데스크톱 반응형
- 🔗 공유 링크로 읽기 전용 보기
- 💸 **전부 무료로 운영**: GitHub Pages + Supabase Free

> 진행 상황: 프로토타입과 DB·API 완료, 사용자 화면 개발 중 → [docs/ROADMAP.md](docs/ROADMAP.md)

## 구조

```
브라우저 (GitHub Pages)  ──RPC──▶  Supabase PostgreSQL (보안 검사는 DB 함수 안에서)
                         ──────▶  Supabase Storage (사진, 티켓 방식 업로드)
```

서버 코드가 없습니다. 테이블은 직접 접근할 수 없고, 검증된 DB 함수(RPC)로만 읽고 씁니다.
자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 보세요.

| 폴더 | 내용 |
|---|---|
| `web/` | 정적 사이트 (바닐라 JS, 빌드 없음) |
| `supabase/migrations/` | DB 스키마·RPC·Storage 정책 |
| `supabase/tests/` | 로컬 전용 보안·기능 테스트 (55개) |
| `docs/` | 설계·DB 명세·배포·로드맵 |

## 빠르게 시작하기

```bash
# 1) 데모(서버 없이) 보기
python3 -m http.server 8000 -d web      # → http://localhost:8000

# 2) DB 테스트 (Docker 필요)
./scripts/test-db.sh
```

내 서비스로 배포하는 방법은 [docs/DEPLOY.md](docs/DEPLOY.md)에 있습니다.
Fork한 뒤 Supabase 프로젝트를 만들고, SQL 한 번 실행하고, GitHub 변수 2개를 넣으면 됩니다.

## 보안에 대해

- PIN은 **HMAC-SHA256 해시**로만 저장합니다. 해시 키(pepper)는 배포마다 DB 안에서 랜덤으로 생성되어 저장소에 없습니다.
- 로그인 시도는 이름당 15분에 10회로 제한하고, 업로드는 일회용 티켓으로 경로를 제한합니다.
- 다만 PIN은 4~6자리라 **강한 비밀번호가 아닙니다.** 다른 서비스와 같은 번호를 쓰지 마세요.
- 보안 문제를 발견하면 공개 이슈 대신 저장소 관리자에게 비공개로 알려 주세요.

## 기여

이슈와 PR을 환영합니다. Claude Code로 작업한다면 [CLAUDE.md](CLAUDE.md)와 [docs/KICKOFF_PROMPT.md](docs/KICKOFF_PROMPT.md)를 참고하세요.
DB를 바꾸는 PR은 `./scripts/test-db.sh` 통과가 필수입니다(CI에서 자동 실행).

## 라이선스

[MIT](LICENSE)
