#!/usr/bin/env bash
set -Eeuo pipefail

: "${CREDENTIALS_DIRECTORY:?CREDENTIALS_DIRECTORY is required}"

secret_id_file="${CREDENTIALS_DIRECTORY}/niannian-cos-secret-id"
secret_key_file="${CREDENTIALS_DIRECTORY}/niannian-cos-secret-key"
runtime_dir="/run/niannian-cos"
runtime_env="${runtime_dir}/tencent-cos.env"
temporary_env="${runtime_env}.tmp"

[[ -r "${secret_id_file}" ]] || { echo "COS_SECRET_ID_CREDENTIAL_UNREADABLE" >&2; exit 1; }
[[ -r "${secret_key_file}" ]] || { echo "COS_SECRET_KEY_CREDENTIAL_UNREADABLE" >&2; exit 1; }

secret_id="$(<"${secret_id_file}")"
secret_key="$(<"${secret_key_file}")"

[[ "${secret_id}" =~ ^[A-Za-z0-9]+$ ]] || { echo "COS_SECRET_ID_FORMAT_INVALID" >&2; exit 1; }
[[ "${secret_key}" =~ ^[A-Za-z0-9]+$ ]] || { echo "COS_SECRET_KEY_FORMAT_INVALID" >&2; exit 1; }

install -d -m 0700 -o root -g root "${runtime_dir}"
umask 0077
printf 'TENCENT_COS_SECRET_ID=%s\nTENCENT_COS_SECRET_KEY=%s\n' "${secret_id}" "${secret_key}" > "${temporary_env}"
chmod 0400 "${temporary_env}"
chown root:root "${temporary_env}"
mv -f "${temporary_env}" "${runtime_env}"

unset secret_id secret_key
echo "NIANNIAN_COS_RUNTIME_ENV_READY"
