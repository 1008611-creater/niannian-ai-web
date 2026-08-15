#!/bin/zsh
set -euo pipefail

TOKEN_PIPE="${NIANNIAN_AGENT_TOKEN_PIPE:-$HOME/.niannian-mac-agent-token.pipe}"
STATUS_FILE="${NIANNIAN_AGENT_TOKEN_STATUS_FILE:-$HOME/.niannian-mac-agent-token.status}"
LOG_FILE="${NIANNIAN_AGENT_TOKEN_LOG_FILE:-$HOME/.niannian-mac-agent-token.log}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
SERVICE="com.niannian.mac-agent-token"
LABEL="com.niannian.mac-codex-worker"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

cleanup() {
  unset AGENT_TOKEN
  rm -f "$TOKEN_PIPE"
}
trap cleanup EXIT INT TERM

rm -f "$STATUS_FILE" "$LOG_FILE"
[[ -p "$TOKEN_PIPE" ]] || { print -r -- "TOKEN_PIPE_REQUIRED" > "$LOG_FILE"; print -r -- "failed:token_pipe_required" > "$STATUS_FILE"; exit 1; }
[[ -f "$PLIST" ]] || { print -r -- "WORKER_PLIST_REQUIRED" > "$LOG_FILE"; print -r -- "failed:worker_plist_required" > "$STATUS_FILE"; exit 1; }

IFS= read -r AGENT_TOKEN < "$TOKEN_PIPE"
AGENT_TOKEN="${AGENT_TOKEN%$'\r'}"
if (( ${#AGENT_TOKEN} < 24 )); then
  print -r -- "TOKEN_INVALID" > "$LOG_FILE"
  print -r -- "failed:token_invalid" > "$STATUS_FILE"
  exit 1
fi

# This command is deliberately run from the logged-in Mac GUI session so
# Keychain can authorize the LaunchAgent wrapper without exposing the token.
if ! security add-generic-password -U -a "$USER" -s "$SERVICE" -w "$AGENT_TOKEN" -T /usr/bin/security "$KEYCHAIN" >/dev/null 2>&1; then
  print -r -- "KEYCHAIN_WRITE_DENIED" > "$LOG_FILE"
  print -r -- "failed:keychain_write_denied" > "$STATUS_FILE"
  exit 1
fi
if ! security find-generic-password -a "$USER" -s "$SERVICE" "$KEYCHAIN" >/dev/null 2>&1; then
  print -r -- "KEYCHAIN_METADATA_VERIFY_FAILED" > "$LOG_FILE"
  print -r -- "failed:keychain_metadata_verify" > "$STATUS_FILE"
  exit 1
fi

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
pkill -f 'niannian-mac-worker\.mjs run-loop' >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/$LABEL"

print -r -- "restarted" > "$STATUS_FILE"
print -r -- "MAC_AGENT_TOKEN_REPAIRED_AND_WORKER_RESTARTED" > "$LOG_FILE"
print -r -- "MAC_AGENT_TOKEN_REPAIRED_AND_WORKER_RESTARTED"
