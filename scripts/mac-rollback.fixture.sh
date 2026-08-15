#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT
export HOME="$FIXTURE/home"
export CODEX_HOME="$HOME/.codex"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
mkdir -p "$INSTALL_ROOT/bin" "$HOME/Library/LaunchAgents" "$CODEX_HOME/skills" "$FIXTURE/fake-bin"
printf '%s\n' 'const VERSION = "1.3.0";' > "$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
printf '%s\n' 'old-plist' > "$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
printf '%s\n' 'old-bundle' > "$CODEX_HOME/niannian-skill-bundle.json"
for skill in niannian-mac-production ai-video-production-router ai-video-channel-router ai-video-fundamentals-skill mimo-8001-video-channel post-coding-review; do
  mkdir -p "$CODEX_HOME/skills/$skill"
  printf '%s\n' "old-$skill" > "$CODEX_HOME/skills/$skill/SKILL.md"
done
printf '%s\n' '#!/bin/sh' 'exit 0' > "$FIXTURE/fake-bin/launchctl"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$FIXTURE/fake-bin/plutil"
chmod +x "$FIXTURE/fake-bin/launchctl" "$FIXTURE/fake-bin/plutil"
export PATH="$FIXTURE/fake-bin:$PATH"
ROLLBACK_DIR="$(bash "$ROOT/mac-agent/backup-before-upgrade.sh")"
printf '%s\n' 'const VERSION = "1.4.0";' > "$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
printf '%s\n' 'new-plist' > "$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
printf '%s\n' 'new-bundle' > "$CODEX_HOME/niannian-skill-bundle.json"
printf '%s\n' 'new-skill' > "$CODEX_HOME/skills/niannian-mac-production/SKILL.md"
mkdir -p "$INSTALL_ROOT/bin/new-only" "$CODEX_HOME/skills/niannian-mac-production/new-only"
bash "$ROOT/mac-agent/rollback-macos.sh" "$ROLLBACK_DIR" >/dev/null
grep -q '1.3.0' "$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
grep -q 'old-plist' "$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
grep -q 'old-bundle' "$CODEX_HOME/niannian-skill-bundle.json"
grep -q 'old-niannian-mac-production' "$CODEX_HOME/skills/niannian-mac-production/SKILL.md"
test ! -e "$INSTALL_ROOT/bin/new-only"
test ! -e "$CODEX_HOME/skills/niannian-mac-production/new-only"
test ! -e "$ROLLBACK_DIR/auth.json"
