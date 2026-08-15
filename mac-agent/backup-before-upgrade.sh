#!/bin/zsh
set -euo pipefail

INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
PLIST="$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
BACKUP_ROOT="$INSTALL_ROOT/backups"
INSTALLED_WORKER="$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
CURRENT_VERSION="$(grep -E 'const VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' "$INSTALLED_WORKER" 2>/dev/null | head -1 | cut -d'"' -f2 || true)"
[[ "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "INSTALLED_WORKER_VERSION_INVALID:${CURRENT_VERSION:-missing}" >&2; exit 1; }
BACKUP_DIR="$BACKUP_ROOT/pre-$CURRENT_VERSION-$(date -u +%Y%m%dT%H%M%SZ)"
SKILLS=(niannian-mac-production ai-video-production-router ai-video-channel-router ai-video-fundamentals-skill mimo-8001-video-channel post-coding-review)

mkdir -p "$BACKUP_DIR/install-root" "$BACKUP_DIR/launch-agent" "$BACKUP_DIR/codex-skills"
BIN_PRESENT=false
PLIST_PRESENT=false
BUNDLE_MANIFEST_PRESENT=false
if [[ -d "$INSTALL_ROOT/bin" ]]; then BIN_PRESENT=true; cp -a "$INSTALL_ROOT/bin" "$BACKUP_DIR/install-root/bin"; fi
if [[ -f "$PLIST" ]]; then PLIST_PRESENT=true; cp -a "$PLIST" "$BACKUP_DIR/launch-agent/com.niannian.mac-codex-worker.plist"; fi
if [[ -f "$CODEX_HOME/niannian-skill-bundle.json" ]]; then BUNDLE_MANIFEST_PRESENT=true; cp -a "$CODEX_HOME/niannian-skill-bundle.json" "$BACKUP_DIR/codex-skills/niannian-skill-bundle.json"; fi
SKILLS_PRESENT=()
for skill in "${SKILLS[@]}"; do
  if [[ -d "$CODEX_HOME/skills/$skill" ]]; then
    SKILLS_PRESENT+=("$skill")
    cp -a "$CODEX_HOME/skills/$skill" "$BACKUP_DIR/codex-skills/$skill"
  fi
done

{
  echo "backup_schema=niannian-mac-worker-rollback-v1"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "backup_worker_version=$CURRENT_VERSION"
  echo "credentials_included=false"
  echo "bin_present=$BIN_PRESENT"
  echo "plist_present=$PLIST_PRESENT"
  echo "bundle_manifest_present=$BUNDLE_MANIFEST_PRESENT"
  echo "skills_present=$(IFS=,; echo "${SKILLS_PRESENT[*]}")"
  if [[ -f "$BACKUP_DIR/install-root/bin/niannian-mac-worker.mjs" ]]; then
    version=$(grep -E 'const VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' "$BACKUP_DIR/install-root/bin/niannian-mac-worker.mjs" | head -1 || true)
    echo "previous_worker_version=${version:-unknown}"
  fi
} > "$BACKUP_DIR/rollback-metadata.txt"

: > "$BACKUP_DIR/SHA256SUMS.txt"
while IFS= read -r -d '' file; do
  shasum -a 256 "$file" >> "$BACKUP_DIR/SHA256SUMS.txt"
done < <(find "$BACKUP_DIR" -type f ! -name SHA256SUMS.txt -print0)
printf '%s\n' "$BACKUP_DIR"
