#!/usr/bin/env bash
# =====================================================================
#  작업 브랜치(dev)를 main에 합치기 — 인수인계 문서는 main에 넣지 않는다
#
#  사용법 (저장소 루트, 변경 사항이 없는 상태에서)
#    ./scripts/release-main.sh            # dev → main 합치기 커밋까지 (push는 안 함)
#    ./scripts/release-main.sh --push     # 합친 뒤 origin/main에 push (= 운영 배포)
#
#  - dev에만 두는 파일(DEV_ONLY)은 합치는 커밋에서 빼서 main에 들어가지 않게 한다.
#  - main을 dev에 merge하지 말 것: main의 "인수인계 문서 삭제"가 dev로 넘어가 문서가 지워진다.
#    main에서 직접 고친 것이 있으면 dev에 cherry-pick 한다.
#  - main push = 사이트 배포(web/ 변경 시) + Supabase 마이그레이션 자동 적용
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DEV_BRANCH="${DEV_BRANCH:-dev}"
DEV_ONLY=(docs/HANDOFF.md docs/KICKOFF_PROMPT.md)

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "⛔ 커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 정리하세요." >&2; exit 1
fi

start=$(git branch --show-current)
git fetch -q origin
git switch -q main
git merge -q --ff-only origin/main

echo "▶ $DEV_BRANCH → main 합치는 중"
if ! git merge --no-ff --no-commit "$DEV_BRANCH" >/dev/null 2>&1; then
  # 인수인계 문서는 main에서 지워져 있어 수정/삭제 충돌이 나는 것이 정상. 그 밖의 충돌이면 멈춘다
  others=$(git diff --name-only --diff-filter=U | grep -vxF -f <(printf '%s\n' "${DEV_ONLY[@]}") || true)
  if [ -n "$others" ]; then
    echo "⛔ 인수인계 문서 말고도 충돌이 있습니다. 직접 해결한 뒤 커밋하세요:" >&2; echo "$others" >&2; exit 1
  fi
fi
for f in "${DEV_ONLY[@]}"; do
  git rm -q --cached --ignore-unmatch -- "$f"
  rm -f -- "$f"
done

if git diff --cached --quiet; then
  echo "합칠 변경이 없습니다."; git merge --abort 2>/dev/null || true; git switch -q "$start"; exit 0
fi
git commit -q -m "merge: $DEV_BRANCH → main (인수인계 문서 제외)"
echo "✅ main에 합쳤습니다: $(git log --oneline -1)"

if [ "${1:-}" = "--push" ]; then
  git push -q origin main
  echo "✅ origin/main push 완료 (배포됨)"
else
  echo "   확인 후 배포하려면: git push origin main"
fi
git switch -q "$start"
