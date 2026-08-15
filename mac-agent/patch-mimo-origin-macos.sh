#!/bin/zsh
# Applies the configured Mimo public origin to an already installed worker.
set -euo pipefail

RUN_LOOP="$HOME/Library/Application Support/NiannianMacWorker/bin/run-loop.zsh"
NEW_ORIGIN="${MIMO_BASE_URL:-https://fd.aancn.cn}"

[[ -f "$RUN_LOOP" ]] || { print -u2 "RUN_LOOP_MISSING"; exit 1; }

if grep -Fq "export MIMO_BASE_URL=\"$NEW_ORIGIN\"" "$RUN_LOOP"; then
  print "MIMO_ORIGIN_ALREADY_CURRENT"
  exit 0
fi

grep -Eq '^export MIMO_BASE_URL=' "$RUN_LOOP" || { print -u2 "MIMO_ORIGIN_CONFIGURATION_MISSING"; exit 1; }

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="${RUN_LOOP}.before-mimo-origin-${TIMESTAMP}"
cp -p "$RUN_LOOP" "$BACKUP"

awk -v origin="$NEW_ORIGIN" '{ if ($0 ~ /^export MIMO_BASE_URL=/) print "export MIMO_BASE_URL=\"" origin "\""; else print; }' "$RUN_LOOP" > "$RUN_LOOP.tmp"
chmod 700 "$RUN_LOOP.tmp"
mv "$RUN_LOOP.tmp" "$RUN_LOOP"
grep -Fq "export MIMO_BASE_URL=\"$NEW_ORIGIN\"" "$RUN_LOOP" || { cp -p "$BACKUP" "$RUN_LOOP"; print -u2 "MIMO_ORIGIN_VERIFY_FAILED"; exit 1; }

print "MIMO_ORIGIN_PATCHED"
print "BACKUP=$BACKUP"
