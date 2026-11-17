#!/usr/bin/env bash
# =====================================================================
#  DB 마이그레이션 + RPC 보안 테스트
#
#  사용법
#    ./scripts/test-db.sh
#        → Docker가 있으면 postgres:16 컨테이너를 잠깐 띄워서 테스트 후 삭제
#    DATABASE_URL=postgresql://user:pass@localhost:5432/testdb ./scripts/test-db.sh
#        → 이미 있는 "빈 테스트용" PostgreSQL 사용
#
#  ⚠ 실제 Supabase DB에는 절대 실행하지 말 것 (mock 스키마를 만들고 테스트 데이터를 넣음)
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=""
cleanup() { [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  if ! command -v docker >/dev/null; then
    echo "DATABASE_URL이 없고 Docker도 없습니다. 둘 중 하나가 필요합니다." >&2; exit 1
  fi
  CONTAINER="tree-test-db-$$"
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:16 >/dev/null
  DATABASE_URL="postgresql://postgres:postgres@localhost:54329/postgres"
  echo "▶ 테스트용 PostgreSQL 컨테이너 시작 중..."
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1
  done
  sleep 1
fi

case "$DATABASE_URL" in
  *supabase.co*|*supabase.com*) echo "⛔ 실제 Supabase 주소에는 실행할 수 없습니다." >&2; exit 1 ;;
esac

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)

echo "▶ Supabase mock 준비"
"${PSQL[@]}" -f supabase/tests/00_mock_supabase.sql

echo "▶ 마이그레이션 적용 (2회: 재실행 안전성 확인)"
for round in 1 2; do
  for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
done

echo "▶ RPC·보안 테스트"
TOTAL=0
for f in supabase/tests/[1-9]*_test.sql; do   # 00_mock_supabase.sql을 뺀 테스트 파일을 이름 순서대로
  echo "  ── $(basename "$f")"
  OUT=$(PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f "$f" 2>&1) || { echo "$OUT" | sed 's/^psql:[^ ]* //' | grep -E "PASS|FAIL|ERROR"; exit 1; }
  echo "$OUT" | grep -oE "(PASS|FAIL) .*" | sed 's/^/  /'
  TOTAL=$((TOTAL + $(echo "$OUT" | grep -c 'PASS')))
done
echo "✅ 통과: ${TOTAL}개"
