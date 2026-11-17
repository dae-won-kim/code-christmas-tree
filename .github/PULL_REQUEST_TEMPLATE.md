## 무엇을 바꿨나요?
<!-- 한두 줄 요약. 관련 이슈가 있으면: Closes #번호 -->

## 왜?

## 확인
- [ ] DB를 바꿨다면: `./scripts/test-db.sh` 통과, 기존 마이그레이션은 수정하지 않고 새 파일로 추가
- [ ] RPC를 추가·변경했다면: `docs/DATABASE.md` 새 RPC 체크리스트 + `tests/e2e/mock-supabase.js` 반영
- [ ] 화면을 바꿨다면: `npm run test:e2e` 통과, 데스크톱·모바일·가로 스크린샷 확인
- [ ] 사용자 입력은 `textContent`로만 출력, `sb.from()` 직접 조회 없음
- [ ] 비밀값(`config.js`, 키, 비밀번호)이 커밋에 없음

## 스크린샷 (화면 변경 시)
