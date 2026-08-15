#!/bin/zsh
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_PIPE="${NIANNIAN_TOKEN_PIPE:-$HOME/.niannian-mac-worker-token.pipe}"
STATUS_FILE="${NIANNIAN_INSTALL_STATUS_FILE:-$HOME/.niannian-mac-worker-install.status}"
LOG_FILE="${NIANNIAN_INSTALL_LOG_FILE:-$HOME/.niannian-mac-worker-install.log}"

TOKEN=""
cleanup() {
  unset TOKEN NIANNIAN_MAC_AGENT_TOKEN
  rm -f "$TOKEN_PIPE"
}
trap cleanup EXIT INT TERM

rm -f "$STATUS_FILE" "$LOG_FILE"

if [[ ! -p "$TOKEN_PIPE" ]]; then
  print -r -- "TOKEN_PIPE_REQUIRED" | tee "$LOG_FILE" >&2
  print -r -- "failed:token_pipe_required" > "$STATUS_FILE"
  exit 1
fi

IFS= read -r TOKEN < "$TOKEN_PIPE"
rm -f "$TOKEN_PIPE"
TOKEN="${TOKEN%$'\r'}"

if (( ${#TOKEN} < 24 )); then
  print -r -- "TOKEN_FROM_PIPE_INVALID" | tee "$LOG_FILE" >&2
  print -r -- "failed:token_invalid" > "$STATUS_FILE"
  exit 1
fi

export NIANNIAN_MAC_AGENT_TOKEN="$TOKEN"
export NIANNIAN_ORIGIN="${NIANNIAN_ORIGIN:-https://sd2.cauai.fun}"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if /bin/zsh "$SOURCE_DIR/install-macos.sh" > "$LOG_FILE" 2>&1; then
  print -r -- "installed" > "$STATUS_FILE"
  cat "$LOG_FILE"
  print -r -- "NIANNIAN_GUI_INSTALL_SUCCEEDED"
else
  exit_code=$?
  print -r -- "failed:installer_exit_$exit_code" > "$STATUS_FILE"
  cat "$LOG_FILE" >&2
  print -r -- "NIANNIAN_GUI_INSTALL_FAILED" >&2
  exit "$exit_code"
fi
