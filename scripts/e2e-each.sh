#!/usr/bin/env bash
# Every e2e suite, one at a time, carrying on past a failure, with a one-line result each.
# `npm run e2e` stops at the first failing suite; this is for "how does the whole branch stand?".
# Usage (repo root): bash scripts/e2e-each.sh [--no-build]
cd "$(dirname "$0")/.." || exit 1
[ "$1" = "--no-build" ] || npm run build > /dev/null 2>&1 || { echo "BUILD FAILED"; exit 1; }
failed=0
for s in e2e e2e-v2 e2e-payee e2e-held-for e2e-recovery-codes e2e-lie-keeper e2e-shrink-queue e2e-where-is-it e2e-sticker-capture e2e-id e2e-air-wall e2e-opener e2e-carryover e2e-sync; do
  out=$(node "scripts/$s.cjs" 2>&1); code=$?
  echo "== $s exit=$code :: $(echo "$out" | grep -iE 'passed|failed' | tail -1)"
  if [ $code -ne 0 ]; then failed=1; echo "$out" | grep -iE 'fail|error' | head -8; fi
done
exit $failed
