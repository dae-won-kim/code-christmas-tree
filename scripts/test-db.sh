#!/usr/bin/env bash
# =====================================================================
#  DB 마이그레이션 + RPC 보안 테스트
#
#  사용법
#    ./scripts/test-db.sh
#        → Docker가 있으면 postgres:17.12 컨테이너를 잠깐 띄워서 테스트 후 삭제
#    DATABASE_URL=postgresql://user:pass@localhost:5432/testdb ./scripts/test-db.sh
#        → 이미 있는 "빈 테스트용" PostgreSQL 사용
#
#  ⚠ 실제 Supabase DB에는 절대 실행하지 말 것 (mock 스키마를 만들고 테스트 데이터를 넣음)
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

PG_IMAGE="postgres:17.12"
CONTAINER=""
cleanup() { [ -n "$CONTAINER" ] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  if ! command -v docker >/dev/null; then
    echo "DATABASE_URL이 없고 Docker도 없습니다. 둘 중 하나가 필요합니다." >&2; exit 1
  fi
  CONTAINER="tree-test-db-$$"
  # 마이너 버전까지 고정: 2026-11-17 KISA 공지(PostgreSQL 보안 업데이트, CVE 25건)의 해결 버전 17.12 (운영 Supabase DB와 같은 버전)
  docker run -d --rm --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p 54329:5432 "$PG_IMAGE" >/dev/null
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

# 보안 패치가 빠진 서버인지 확인 (2026-11-17 KISA 공지의 해결 버전 기준).
# DATABASE_URL로 직접 띄운 서버가 오래됐으면 경고만 한다 — 테스트 결과에는 영향 없음
PG_NUM=$("${PSQL[@]}" -tAc "show server_version_num")
case "${PG_NUM:0:2}" in
  18) PG_MIN=180007 ;; 17) PG_MIN=170012 ;; 16) PG_MIN=160016 ;; 15) PG_MIN=150020 ;; 14) PG_MIN=140025 ;; *) PG_MIN=0 ;;
esac
if [ "$PG_NUM" -lt "$PG_MIN" ]; then
  echo "⚠ PostgreSQL $("${PSQL[@]}" -tAc "show server_version")은 보안 패치 전 버전입니다. $((PG_MIN / 10000)).$((PG_MIN % 100)) 이상으로 올리세요." >&2
fi

echo "▶ Supabase mock 준비"
"${PSQL[@]}" -f supabase/tests/00_mock_supabase.sql

# 각 파일을 연속 2번씩: 같은 마이그레이션을 다시 실행해도 안전한지(idempotent) 확인
# (옛 파일을 새 파일 뒤에 다시 실행하는 일은 실제로 없으므로 파일 단위로 반복한다)
echo "▶ 마이그레이션 적용 (파일마다 2회: 재실행 안전성 확인)"
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"; "${PSQL[@]}" -f "$f"
done

run_tests() {   # $1: DB 주소, 나머지: 테스트 파일
  local url=$1; shift
  for f in "$@"; do
    echo "  ── $(basename "$f")"
    OUT=$(PGOPTIONS="-c client_min_messages=notice" psql "$url" -v ON_ERROR_STOP=1 -q -X -f "$f" 2>&1) || { echo "$OUT" | sed 's/^psql:[^ ]* //' | grep -E "PASS|FAIL|ERROR"; exit 1; }
    echo "$OUT" | grep -oE "(PASS|FAIL) .*" | sed 's/^/  /'
    TOTAL=$((TOTAL + $(echo "$OUT" | grep -c 'PASS')))
  done
}

echo "▶ RPC·보안 테스트"
TOTAL=0
run_tests "$DATABASE_URL" supabase/tests/[1-9]*_test.sql   # 00_mock_supabase.sql을 뺀 테스트 파일을 이름 순서대로

# 업그레이드 테스트: 이미 배포된 DB(첫 마이그레이션만 적용 + 데이터 있음)에 나머지를 적용
#  - 처음 적용: v1 데이터는 버려지고(운영자 결정) v2가 정상 동작하는지 (after.sql)
#  - 다시 적용: v2 데이터가 지워지지 않는지 (rerun.sql)
echo "▶ 업그레이드 테스트 (배포된 DB에 새 마이그레이션 적용)"
UPG_DB=tree_upgrade_test
"${PSQL[@]}" -c "drop database if exists $UPG_DB" -c "create database $UPG_DB"
UPG_URL="${DATABASE_URL%/*}/$UPG_DB"
UPG=(psql "$UPG_URL" -v ON_ERROR_STOP=1 -q -X)
MIGS=(supabase/migrations/*.sql)
"${UPG[@]}" -f supabase/tests/00_mock_supabase.sql
"${UPG[@]}" -f "${MIGS[0]}"                                     # 배포된 상태
run_tests "$UPG_URL" supabase/tests/upgrade/before.sql                 # 옛 RPC로 데이터 만들기
for f in "${MIGS[@]:1}"; do "${UPG[@]}" -f "$f"; done
run_tests "$UPG_URL" supabase/tests/upgrade/after.sql
for f in "${MIGS[@]:1}"; do "${UPG[@]}" -f "$f"; done
run_tests "$UPG_URL" supabase/tests/upgrade/rerun.sql
"${PSQL[@]}" -c "drop database if exists $UPG_DB"

echo "✅ 통과: ${TOTAL}개"
