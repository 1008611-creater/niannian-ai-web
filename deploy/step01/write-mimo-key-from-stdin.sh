#!/usr/bin/env bash
set -euo pipefail
target=/home/hermes/workspace/niannian-step01/runtime/step01.env
umask 077
IFS= read -r key
test -n "$key" || { echo MIMO_KEY_EMPTY >&2; exit 2; }
temporary="${target}.tmp.$$"
{
  printf 'MIMO_API_KEY=%s\n' "$key"
  printf 'MIMO_API_BASE=https://api.xiaomimimo.com/v1\n'
  printf 'MIMO_ASR_MODEL=mimo-v2.5-asr\n'
  printf 'STEP01_SKILL_ROOT=/home/hermes/workspace/niannian-step01/bundle\n'
  printf 'HF_HOME=/home/hermes/workspace/niannian-step01/runtime/hf-cache\n'
} >"$temporary"
unset key
chown hermes:hermes "$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$target"
echo MIMO_KEY_SAVED
