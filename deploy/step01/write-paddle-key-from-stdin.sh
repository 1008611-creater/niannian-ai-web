#!/usr/bin/env bash
set -euo pipefail
target=/home/hermes/workspace/niannian-step01/runtime/step01.env
umask 077
IFS= read -r key
case "$key" in
  PADDLEOCR_API_TOKEN=*|PADDLEOCR_AISTUDIO_TOKEN=*) key="${key#*=}" ;;
esac
test -n "$key" || { echo PADDLE_KEY_EMPTY >&2; exit 2; }
test -f "$target" || { echo STEP01_ENV_MISSING >&2; exit 3; }
temporary="${target}.tmp.$$"
grep -v -E '^(PADDLEOCR_API_TOKEN|PADDLEOCR_AISTUDIO_TOKEN)=' "$target" >"$temporary"
{
  printf 'PADDLEOCR_API_TOKEN=%s\n' "$key"
  printf 'PADDLEOCR_AISTUDIO_TOKEN=%s\n' "$key"
} >>"$temporary"
unset key
chown hermes:hermes "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$target"
echo PADDLE_KEY_SAVED
