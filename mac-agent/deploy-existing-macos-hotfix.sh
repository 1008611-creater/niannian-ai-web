#!/bin/zsh
set -euo pipefail

# Installs a reviewed Worker update on an already configured Mac without
# retrieving or rewriting Keychain credentials. The existing wrapper remains
# the authority for the agent token and Mimo login environment.
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
BIN_DIR="$INSTALL_ROOT/bin"
WRAPPER="$BIN_DIR/run-loop.zsh"
PLIST="$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
LABEL="com.niannian.mac-codex-worker"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" && -x "$HOME/.local/bin/node" ]]; then
  NODE_BIN="$HOME/.local/bin/node"
fi

[[ "$(uname -s)" == "Darwin" ]] || { echo "MACOS_REQUIRED" >&2; exit 1; }
[[ -z "${SSH_CONNECTION:-}" ]] || { echo "GUI_SESSION_REQUIRED_FOR_LAUNCHAGENT_RESTART" >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { echo "NODE_REQUIRED" >&2; exit 1; }
NPM_BIN="$(command -v npm || true)"
[[ -n "$NPM_BIN" ]] || { echo "NPM_REQUIRED" >&2; exit 1; }
[[ -f "$SOURCE_DIR/niannian-mac-worker.mjs" ]] || { echo "WORKER_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/mimo-safari-visible-submit.mjs" ]] || { echo "MIMO_VISIBLE_SUBMITTER_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/mimo-safari-visible-sync.mjs" ]] || { echo "MIMO_VISIBLE_SYNCHRONIZER_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/prepare-mimo-safari-session.mjs" ]] || { echo "MIMO_SESSION_PREPARER_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/mimo-chrome-cdp.mjs" ]] || { echo "MIMO_CHROME_CDP_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/mimo-chrome-cdp-submit.mjs" && -f "$SOURCE_DIR/mimo-chrome-cdp-sync.mjs" ]] || { echo "MIMO_CHROME_CDP_WORKER_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/patch-mimo-origin-macos.sh" ]] || { echo "MIMO_ORIGIN_PATCH_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/worker-result.schema.json" ]] || { echo "WORKER_SCHEMA_MISSING" >&2; exit 1; }
[[ -f "$SOURCE_DIR/skill-bundle/install-skill-bundle.mjs" ]] || { echo "SKILL_BUNDLE_SOURCE_MISSING" >&2; exit 1; }
[[ -f "$WRAPPER" && -f "$PLIST" ]] || { echo "EXISTING_WORKER_CONFIGURATION_REQUIRED" >&2; exit 1; }

WORKER_VERSION="$(grep -E 'const VERSION = "[0-9]+\.[0-9]+\.[0-9]+"' "$SOURCE_DIR/niannian-mac-worker.mjs" | head -1 | cut -d'"' -f2)"
[[ "$WORKER_VERSION" == "1.4.12" ]] || { echo "UNEXPECTED_WORKER_VERSION:$WORKER_VERSION" >&2; exit 1; }

ROLLBACK_DIR="$(/bin/zsh "$SOURCE_DIR/backup-before-upgrade.sh")"
launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
/bin/zsh "$SOURCE_DIR/patch-mimo-origin-macos.sh"
"$NPM_BIN" install --prefix "$INSTALL_ROOT/runtime/chrome-cdp" --omit=dev --ignore-scripts --no-audit --no-fund playwright-core@1.57.0 >/dev/null
"$NODE_BIN" -e 'require(process.argv[1]);' "$INSTALL_ROOT/runtime/chrome-cdp/node_modules/playwright-core"

"$NODE_BIN" "$SOURCE_DIR/skill-bundle/install-skill-bundle.mjs" --bundle-dir "$SOURCE_DIR/skill-bundle"
install -m 755 "$SOURCE_DIR/niannian-mac-worker.mjs" "$BIN_DIR/niannian-mac-worker.mjs"
install -m 755 "$SOURCE_DIR/mimo-safari-visible-submit.mjs" "$BIN_DIR/mimo-safari-visible-submit.mjs"
install -m 755 "$SOURCE_DIR/mimo-safari-visible-sync.mjs" "$BIN_DIR/mimo-safari-visible-sync.mjs"
install -m 755 "$SOURCE_DIR/prepare-mimo-safari-session.mjs" "$BIN_DIR/prepare-mimo-safari-session.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp.mjs" "$BIN_DIR/mimo-chrome-cdp.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp-submit.mjs" "$BIN_DIR/mimo-chrome-cdp-submit.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp-sync.mjs" "$BIN_DIR/mimo-chrome-cdp-sync.mjs"
install -m 644 "$SOURCE_DIR/worker-result.schema.json" "$BIN_DIR/worker-result.schema.json"

if ! grep -Fq 'export NIANNIAN_MIMO_PARENT_BRIDGE="true"' "$WRAPPER"; then
  grep -Fq 'export MIMO_BASE_URL=' "$WRAPPER" || { echo "WRAPPER_MIMO_CONFIGURATION_MISSING" >&2; exit 1; }
  awk '{ print; if ($0 ~ /export MIMO_BASE_URL=/) print "export NIANNIAN_MIMO_PARENT_BRIDGE=\"true\""; }' "$WRAPPER" > "$WRAPPER.tmp"
  chmod 700 "$WRAPPER.tmp"
  mv "$WRAPPER.tmp" "$WRAPPER"
fi

if ! grep -Fq 'export NIANNIAN_MIMO_BROWSER_ROUTE="chrome_cdp"' "$WRAPPER"; then
  grep -Fq 'export NIANNIAN_MIMO_PARENT_BRIDGE="true"' "$WRAPPER" || { echo "PARENT_BRIDGE_CONFIGURATION_MISSING" >&2; exit 1; }
  awk '{ print; if ($0 ~ /export NIANNIAN_MIMO_PARENT_BRIDGE=/) { print "export NIANNIAN_MIMO_BROWSER_ROUTE=\"chrome_cdp\""; print "export NIANNIAN_MIMO_CDP_URL=\"http://127.0.0.1:9226\""; print "export NIANNIAN_MIMO_CDP_RUNTIME=\"$HOME/Library/Application Support/NiannianMacWorker/runtime/chrome-cdp/node_modules/playwright-core\""; } }' "$WRAPPER" > "$WRAPPER.tmp"
  chmod 700 "$WRAPPER.tmp"
  mv "$WRAPPER.tmp" "$WRAPPER"
fi

grep -Fq 'export NIANNIAN_MIMO_PARENT_BRIDGE="true"' "$WRAPPER" || { echo "PARENT_BRIDGE_CONFIGURATION_FAILED" >&2; exit 1; }
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "NIANNIAN_MAC_WORKER_HOTFIX_INSTALLED"
echo "WORKER_VERSION=$WORKER_VERSION"
echo "ROLLBACK_DIR=$ROLLBACK_DIR"
