#!/usr/bin/env bash
# Read-only smoke test for the public demo. Sends GET requests only: no login, no form posts, no writes.
#
# Usage:    bash scripts/demo-smoke.sh https://demo.example.com
# Options:  SMOKE_ACCOUNTS=1 also checks the sign-in page and /api/v1/openapi.json (use once HIRELANE_ACCOUNTS is on).
# Exit:     0 every check passed, 1 at least one check failed, 2 usage error.
# Bash 3.2 compatible (the macOS default), so the owner can run it from a laptop.
set -u

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "usage: bash scripts/demo-smoke.sh <origin>   e.g. https://demo.example.com" >&2
  exit 2
fi
case "$BASE" in
  https://*|http://*) ;;
  *) echo "usage: the origin must start with https:// (http:// is accepted only for a local run)" >&2; exit 2 ;;
esac
BASE="${BASE%/}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/demo-smoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); echo "PASS $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; }

# get <path>: body to $TMP/body, headers to $TMP/headers, prints the HTTP status ("000" when unreachable).
get() {
  : > "$TMP/body"
  : > "$TMP/headers"
  curl -sS --max-time 30 -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' "$BASE$1" 2>/dev/null || true
}

# expect_status <path> <status>
expect_status() {
  local got
  got="$(get "$1")"
  if [ "$got" = "$2" ]; then pass "$1 $got"; else fail "$1 got $got, want $2"; fi
}

echo "demo smoke against $BASE"

# Health: the route answers and reports ok.
got="$(get /api/health)"
if [ "$got" = "200" ] && grep -q '"ok"[[:space:]]*:[[:space:]]*true' "$TMP/body"; then
  pass "/api/health 200 ok"
else
  fail "/api/health got $got, or the body does not report ok:true"
fi

# Home page: 200, clickjacking header, and HSTS on the https origin.
got="$(get /)"
if [ "$got" = "200" ]; then pass "/ 200"; else fail "/ got $got, want 200"; fi
if grep -qi 'x-frame-options: deny' "$TMP/headers"; then pass "/ x-frame-options DENY"; else fail "/ missing x-frame-options: DENY"; fi
case "$BASE" in
  https://*)
    if grep -qi 'strict-transport-security:' "$TMP/headers"; then pass "/ strict-transport-security set"; else fail "/ missing strict-transport-security"; fi
    ;;
esac

# Public pages and feeds.
for p in /jobs /colleges /students /companies /about /how-it-works /privacy /terms /status /robots.txt /openapi.json /api/public/stats/autopilot; do
  expect_status "$p" 200
done

# Sitemap: 200, and it must not point at localhost (APP_ORIGIN unset in production shows up here).
got="$(get /sitemap.xml)"
if [ "$got" = "200" ] && grep -q localhost "$TMP/body"; then
  fail "/sitemap.xml links to localhost: set APP_ORIGIN to the public https origin"
elif [ "$got" = "200" ]; then
  pass "/sitemap.xml 200"
else
  fail "/sitemap.xml got $got, want 200"
fi

# Public job feed, then one job page when the feed has a job (skipped, not failed, while the feed is empty).
got="$(get /api/public/jobs)"
if [ "$got" = "200" ]; then pass "/api/public/jobs 200"; else fail "/api/public/jobs got $got, want 200"; fi
cp "$TMP/body" "$TMP/jobs.json"
slug="$(grep -o '"slug"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMP/jobs.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
case "$slug" in
  "") echo "SKIP /job/<slug> the public feed has no job yet" ;;
  *[!A-Za-z0-9._-]*) fail "/api/public/jobs returned a slug with unexpected characters" ;;
  *) expect_status "/job/$slug" 200 ;;
esac

# Production gates: the dev gallery and the sample pages must not be reachable.
expect_status /dev/ui 404
expect_status /dev/campus 404

# Sign-in checks, only once accounts are on.
if [ "${SMOKE_ACCOUNTS:-}" = "1" ]; then
  expect_status /signin 200
  expect_status /api/v1/openapi.json 200
fi

echo "demo smoke: $PASSED passed, $FAILED failed"
if [ "$FAILED" -eq 0 ]; then exit 0; fi
exit 1
