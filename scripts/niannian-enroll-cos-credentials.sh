#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 1
fi

credential_store="/etc/credstore.encrypted"
secret_id_target="${credential_store}/niannian-cos-secret-id.cred"
secret_key_target="${credential_store}/niannian-cos-secret-key.cred"

install -d -m 0700 -o root -g root "${credential_store}"
umask 0077

if [[ "${1:-}" == "--stdin" ]]; then
  IFS= read -r secret_id || { echo "COS_SECRET_ID_MISSING" >&2; exit 1; }
  IFS= read -r secret_key || { echo "COS_SECRET_KEY_MISSING" >&2; exit 1; }
  if IFS= read -r extra_line; then
    echo "COS_CREDENTIAL_INPUT_EXTRA_DATA" >&2
    exit 1
  fi
  unset extra_line
elif [[ "$#" -eq 0 ]]; then
  read -r -s -p "Tencent COS SecretId: " secret_id
  printf '\n' > /dev/tty
  read -r -s -p "Tencent COS SecretKey: " secret_key
  printf '\n' > /dev/tty
else
  echo "USAGE: niannian-enroll-cos-credentials [--stdin]" >&2
  exit 2
fi

[[ "${secret_id}" =~ ^[A-Za-z0-9]+$ ]] || { echo "COS_SECRET_ID_FORMAT_INVALID" >&2; exit 1; }
[[ "${secret_key}" =~ ^[A-Za-z0-9]+$ ]] || { echo "COS_SECRET_KEY_FORMAT_INVALID" >&2; exit 1; }

secret_id_pending="${secret_id_target}.pending"
secret_key_pending="${secret_key_target}.pending"
trap 'rm -f "${secret_id_pending:-}" "${secret_key_pending:-}"; unset secret_id secret_key' EXIT

printf '%s' "${secret_id}" | systemd-creds encrypt --name=niannian-cos-secret-id - "${secret_id_pending}" >/dev/null
printf '%s' "${secret_key}" | systemd-creds encrypt --name=niannian-cos-secret-key - "${secret_key_pending}" >/dev/null
chmod 0600 "${secret_id_pending}" "${secret_key_pending}"
chown root:root "${secret_id_pending}" "${secret_key_pending}"
mv -f "${secret_id_pending}" "${secret_id_target}"
mv -f "${secret_key_pending}" "${secret_key_target}"

unset secret_id secret_key
systemctl daemon-reload
systemctl enable niannian-cos-runtime-credentials.service >/dev/null
systemctl restart niannian-cos-runtime-credentials.service
test -s /run/niannian-cos/tencent-cos.env
test "$(stat -c '%a:%U:%G' /run/niannian-cos/tencent-cos.env)" = "400:root:root"

echo "NIANNIAN_COS_ENCRYPTED_CREDENTIALS_READY"
