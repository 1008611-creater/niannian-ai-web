#!/bin/zsh
set -euo pipefail

IFS= read -r -d '' MIMO_USER
IFS= read -r -d '' MIMO_PASS
IMAGE_PATH="${1:-}"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" && -x "$HOME/.local/bin/node" ]]; then
  NODE_BIN="$HOME/.local/bin/node"
fi
[[ -n "$IMAGE_PATH" && -n "$MIMO_USER" && ${#MIMO_PASS} -ge 4 ]] || { print -u2 "DIAGNOSTIC_INPUT_REQUIRED"; exit 1; }
[[ -n "$NODE_BIN" ]] || { print -u2 "NODE_REQUIRED"; exit 1; }
[[ -f "$SOURCE_DIR/mimo-safari-ui-diagnostic.mjs" ]] || { print -u2 "DIAGNOSTIC_SOURCE_MISSING"; exit 1; }

export NIANNIAN_MIMO_WEBDRIVER_URL="http://127.0.0.1:4444"
export MIMO_USERNAME="$MIMO_USER"
export MIMO_PASSWORD="$MIMO_PASS"
"$NODE_BIN" "$SOURCE_DIR/mimo-safari-ui-diagnostic.mjs" "$IMAGE_PATH"
unset MIMO_USER MIMO_PASS MIMO_USERNAME MIMO_PASSWORD
