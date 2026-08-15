#!/bin/zsh
# Run by double-clicking on the logged-in Mac desktop, never through SSH.
set -uo pipefail

KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
USERNAME_SERVICE="com.niannian.mimo-username"
PASSWORD_SERVICE="com.niannian.mimo-password"
STATUS_FILE="$HOME/.niannian-mimo-config.status"

print "Mimo 本地 Keychain 修复"
print "此窗口只在本机写入 Keychain，不会把凭据传给服务器。"
read "MIMO_USERNAME?Mimo 用户名: "
read -s "MIMO_PASSWORD?Mimo 密码: "
print ""

if [[ -z "$MIMO_USERNAME" || ${#MIMO_USERNAME} -gt 200 || ${#MIMO_PASSWORD} -lt 4 ]]; then
  print -r -- "failed:credentials_invalid" > "$STATUS_FILE"
  chmod 600 "$STATUS_FILE"
  print "未写入：账号或密码格式无效。"
  exit 1
fi

# -U updates legacy entries in place, avoiding the old delete-then-add failure
# when a previous Keychain item's ACL does not permit deletion.
if ! security add-generic-password -U -a "$USER" -s "$USERNAME_SERVICE" -w "$MIMO_USERNAME" -T /usr/bin/security "$KEYCHAIN" >/dev/null 2>&1; then
  print -r -- "failed:keychain_username_write" > "$STATUS_FILE"
  chmod 600 "$STATUS_FILE"
  print "未写入：Keychain 未允许当前本机会话。请解锁 Mac 后重试。"
  exit 1
fi

if ! security add-generic-password -U -a "$USER" -s "$PASSWORD_SERVICE" -w "$MIMO_PASSWORD" -T /usr/bin/security "$KEYCHAIN" >/dev/null 2>&1; then
  print -r -- "failed:keychain_password_write" > "$STATUS_FILE"
  chmod 600 "$STATUS_FILE"
  print "未写入：Keychain 未允许当前本机会话。请解锁 Mac 后重试。"
  exit 1
fi

unset MIMO_USERNAME MIMO_PASSWORD

if ! security find-generic-password -a "$USER" -s "$USERNAME_SERVICE" "$KEYCHAIN" >/dev/null 2>&1 || \
   ! security find-generic-password -a "$USER" -s "$PASSWORD_SERVICE" "$KEYCHAIN" >/dev/null 2>&1; then
  print -r -- "failed:keychain_metadata_verify" > "$STATUS_FILE"
  chmod 600 "$STATUS_FILE"
  print "未确认：Keychain 条目未能验证。"
  exit 1
fi

print -r -- "configured" > "$STATUS_FILE"
chmod 600 "$STATUS_FILE"
print "NIANNIAN_MIMO_CONFIGURATION_SUCCEEDED"
