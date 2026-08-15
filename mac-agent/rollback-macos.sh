#!/bin/zsh
set -euo pipefail

BACKUP_DIR="${1:-}"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
PLIST="$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
LABEL="com.niannian.mac-codex-worker"

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "ROLLBACK_BACKUP_REQUIRED" >&2
  exit 1
fi
case "$(cd "$BACKUP_DIR" && pwd)" in
  "$INSTALL_ROOT"/backups/pre-[0-9]*.[0-9]*.[0-9]*-*) ;;
  *) echo "ROLLBACK_BACKUP_PATH_INVALID" >&2; exit 1 ;;
esac
if [[ ! -f "$BACKUP_DIR/rollback-metadata.txt" || ! -f "$BACKUP_DIR/SHA256SUMS.txt" ]]; then
  echo "ROLLBACK_MANIFEST_MISSING" >&2
  exit 1
fi
shasum -a 256 -c "$BACKUP_DIR/SHA256SUMS.txt" >/dev/null

metadata_value() {
  grep -E "^$1=" "$BACKUP_DIR/rollback-metadata.txt" | head -1 | cut -d= -f2- || true
}
BIN_PRESENT="$(metadata_value bin_present)"
PLIST_PRESENT="$(metadata_value plist_present)"
BUNDLE_MANIFEST_PRESENT="$(metadata_value bundle_manifest_present)"
SKILLS_PRESENT=",$(metadata_value skills_present),"
if [[ "$BIN_PRESENT" != "true" && "$BIN_PRESENT" != "false" ]]; then echo "ROLLBACK_METADATA_INVALID:bin_present" >&2; exit 1; fi
if [[ "$PLIST_PRESENT" != "true" && "$PLIST_PRESENT" != "false" ]]; then echo "ROLLBACK_METADATA_INVALID:plist_present" >&2; exit 1; fi
if [[ "$BUNDLE_MANIFEST_PRESENT" != "true" && "$BUNDLE_MANIFEST_PRESENT" != "false" ]]; then echo "ROLLBACK_METADATA_INVALID:bundle_manifest_present" >&2; exit 1; fi

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
rm -rf "$INSTALL_ROOT/bin"
if [[ "$BIN_PRESENT" == "true" ]]; then
  mkdir -p "$INSTALL_ROOT/bin"
  cp -a "$BACKUP_DIR/install-root/bin/." "$INSTALL_ROOT/bin/"
fi
rm -f "$PLIST"
if [[ "$PLIST_PRESENT" == "true" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cp -a "$BACKUP_DIR/launch-agent/com.niannian.mac-codex-worker.plist" "$PLIST"
fi
rm -f "$CODEX_HOME/niannian-skill-bundle.json"
if [[ "$BUNDLE_MANIFEST_PRESENT" == "true" ]]; then
  cp -a "$BACKUP_DIR/codex-skills/niannian-skill-bundle.json" "$CODEX_HOME/niannian-skill-bundle.json"
fi
for skill in niannian-mac-production ai-video-production-router ai-video-channel-router ai-video-fundamentals-skill mimo-8001-video-channel post-coding-review; do
  target="$CODEX_HOME/skills/$skill"
  case "$target" in "$CODEX_HOME"/skills/*) ;; *) echo "ROLLBACK_SKILL_PATH_INVALID" >&2; exit 1 ;; esac
  rm -rf "$target"
  if [[ "$SKILLS_PRESENT" == *",$skill,"* ]]; then
    skill_dir="$BACKUP_DIR/codex-skills/$skill"
    [[ -d "$skill_dir" ]] || { echo "ROLLBACK_SKILL_BACKUP_MISSING:$skill" >&2; exit 1; }
    cp -a "$skill_dir" "$target"
  fi
done
if [[ "$PLIST_PRESENT" == "true" && ! -f "$PLIST" ]]; then
  echo "ROLLBACK_LAUNCH_AGENT_MISSING" >&2
  exit 1
fi
if [[ "$PLIST_PRESENT" == "true" ]]; then
  plutil -lint "$PLIST" >/dev/null
  launchctl bootstrap "gui/$UID" "$PLIST"
  launchctl kickstart -k "gui/$UID/$LABEL"
  echo "NIANNIAN_MAC_WORKER_ROLLBACK_STARTED"
else
  echo "NIANNIAN_MAC_WORKER_ROLLBACK_RESTORED_NO_SERVICE"
fi
