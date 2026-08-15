#!/bin/zsh
set -euo pipefail

USERNAME_PIPE="${NIANNIAN_MIMO_USERNAME_PIPE:-$HOME/.niannian-mimo-username.pipe}"
PASSWORD_PIPE="${NIANNIAN_MIMO_PASSWORD_PIPE:-$HOME/.niannian-mimo-password.pipe}"
STATUS_FILE="${NIANNIAN_MIMO_STATUS_FILE:-$HOME/.niannian-mimo-config.status}"
LOG_FILE="${NIANNIAN_MIMO_LOG_FILE:-$HOME/.niannian-mimo-config.log}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
USERNAME_SERVICE="com.niannian.mimo-username"
PASSWORD_SERVICE="com.niannian.mimo-password"
USERNAME=""
PASSWORD=""

cleanup() {
  unset USERNAME PASSWORD
  rm -f "$USERNAME_PIPE" "$PASSWORD_PIPE"
}
trap cleanup EXIT INT TERM
rm -f "$STATUS_FILE" "$LOG_FILE"

if [[ ! -p "$USERNAME_PIPE" || ! -p "$PASSWORD_PIPE" ]]; then
  print -r -- "MIMO_CREDENTIAL_PIPES_REQUIRED" > "$LOG_FILE"
  print -r -- "failed:pipes_required" > "$STATUS_FILE"
  exit 1
fi

IFS= read -r USERNAME < "$USERNAME_PIPE"
IFS= read -r PASSWORD < "$PASSWORD_PIPE"
rm -f "$USERNAME_PIPE" "$PASSWORD_PIPE"
USERNAME="${USERNAME%$'\r'}"
PASSWORD="${PASSWORD%$'\r'}"

if [[ -z "$USERNAME" || ${#USERNAME} -gt 200 || ${#PASSWORD} -lt 4 ]]; then
  print -r -- "MIMO_CREDENTIALS_INVALID" > "$LOG_FILE"
  print -r -- "failed:credentials_invalid" > "$STATUS_FILE"
  exit 1
fi

for service in "$USERNAME_SERVICE" "$PASSWORD_SERVICE"; do
  security delete-generic-password -a "$USER" -s "$service" "$KEYCHAIN" >/dev/null 2>&1 || true
done
security add-generic-password -a "$USER" -s "$USERNAME_SERVICE" -w "$USERNAME" -T /usr/bin/security "$KEYCHAIN" >/dev/null
security add-generic-password -a "$USER" -s "$PASSWORD_SERVICE" -w "$PASSWORD" -T /usr/bin/security "$KEYCHAIN" >/dev/null
print -r -- "configured" > "$STATUS_FILE"
print -r -- "MIMO_CREDENTIALS_STORED_IN_KEYCHAIN" > "$LOG_FILE"
launchctl kickstart -k "gui/$UID/com.niannian.mac-codex-worker" >/dev/null 2>&1 || true
print -r -- "NIANNIAN_MIMO_CONFIGURATION_SUCCEEDED"
