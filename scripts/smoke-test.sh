#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"

pass() { printf "OK  %s\n" "$*"; }
fail() { printf "ERR %s\n" "$*"; exit 1; }

json_get() {
  local path="$1"
  curl -fsS "${API_BASE}${path}"
}

status="$(json_get /status || true)"
if [[ -z "${status}" ]]; then
  fail "GET /status"
fi
echo "${status}" | grep -q "\"ok\"" || fail "GET /status (missing ok field)"
pass "GET /status"

resources="$(json_get /status/resources || true)"
echo "${resources}" | grep -q "\"cpu\"" || fail "GET /status/resources"
pass "GET /status/resources"

queues="$(json_get /queues/summary || true)"
echo "${queues}" | grep -q "\"1v1\"" || fail "GET /queues/summary"
pass "GET /queues/summary"

leaderboard="$(json_get /community/leaderboard || true)"
echo "${leaderboard}" | grep -q "\\[" || fail "GET /community/leaderboard"
pass "GET /community/leaderboard"

# Auth required endpoints should reject without a session.
code="$(curl -sS -o /dev/null -w '%{http_code}' "${API_BASE}/community/stats" || true)"
[[ "${code}" == "403" || "${code}" == "401" ]] || fail "GET /community/stats expected 401/403, got ${code}"
pass "GET /community/stats (unauthenticated rejects)"

echo "Smoke tests passed against ${API_BASE}"

