#!/bin/zsh
set -euo pipefail

ORIGIN="${NIANNIAN_ORIGIN:-https://sd2.cauai.fun}"
TOKEN="${NIANNIAN_MAC_AGENT_TOKEN:-}"
SERVICE="com.niannian.mac-agent-token"
MIMO_USERNAME_SERVICE="com.niannian.mimo-username"
MIMO_PASSWORD_SERVICE="com.niannian.mimo-password"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_BUNDLE_DIR="$SOURCE_DIR/skill-bundle"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
BIN_DIR="$INSTALL_ROOT/bin"
LOG_DIR="$INSTALL_ROOT/logs"
RUNTIME_DIR="$INSTALL_ROOT/runtime"
WORKSPACE="$HOME/niannian-mac-worker"
PLIST="$HOME/Library/LaunchAgents/com.niannian.mac-codex-worker.plist"
WRAPPER="$BIN_DIR/run-loop.zsh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "MACOS_REQUIRED" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
CODEX_BIN="$(command -v codex || true)"
NPM_BIN="$(command -v npm || true)"
if [[ -z "$CODEX_BIN" || ! -x "$CODEX_BIN" ]]; then
  for candidate in \
    "$HOME/.codex/packages/standalone/current/codex" \
    "/Applications/ChatGPT.app/Contents/Resources/codex" \
    "$HOME/.codex/plugins/.plugin-appserver/codex"; do
    if [[ -x "$candidate" ]]; then
      CODEX_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "NODE_REQUIRED" >&2
  exit 1
fi
if [[ -z "$CODEX_BIN" ]]; then
  echo "CODEX_CLI_REQUIRED" >&2
  exit 1
fi
if [[ -z "$NPM_BIN" ]]; then
  echo "NPM_REQUIRED" >&2
  exit 1
fi
if [[ -z "$TOKEN" ]]; then
  echo "NIANNIAN_MAC_AGENT_TOKEN_REQUIRED" >&2
  exit 1
fi
if (( ${#TOKEN} < 24 )); then
  echo "NIANNIAN_MAC_AGENT_TOKEN_TOO_SHORT" >&2
  exit 1
fi
if [[ ! -f "$SKILL_BUNDLE_DIR/bundle-manifest.json" || ! -f "$SKILL_BUNDLE_DIR/install-skill-bundle.mjs" ]]; then
  echo "NIANNIAN_SKILL_BUNDLE_REQUIRED" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_DIR/backup-before-upgrade.sh" || ! -f "$SOURCE_DIR/rollback-macos.sh" ]]; then
  echo "NIANNIAN_ROLLBACK_SCRIPTS_REQUIRED" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$LOG_DIR" "$RUNTIME_DIR" "$WORKSPACE" "$HOME/Library/LaunchAgents"
ROLLBACK_DIR="$(/bin/zsh "$SOURCE_DIR/backup-before-upgrade.sh")"
$NODE_BIN "$SKILL_BUNDLE_DIR/install-skill-bundle.mjs" --bundle-dir "$SKILL_BUNDLE_DIR"
FFPROBE_BIN="$(command -v ffprobe || true)"
if [[ -z "$FFPROBE_BIN" ]]; then
  "$NPM_BIN" install --prefix "$RUNTIME_DIR" --omit=dev --ignore-scripts @ffprobe-installer/ffprobe@2.1.2 >/dev/null
  FFPROBE_BIN="$($NODE_BIN -e 'process.stdout.write(require(process.argv[1]).path)' "$RUNTIME_DIR/node_modules/@ffprobe-installer/ffprobe")"
  chmod 755 "$FFPROBE_BIN"
fi
"$FFPROBE_BIN" -version >/dev/null
"$NPM_BIN" install --prefix "$RUNTIME_DIR/chrome-cdp" --omit=dev --ignore-scripts --no-audit --no-fund playwright-core@1.57.0 >/dev/null
"$NODE_BIN" -e 'require(process.argv[1]);' "$RUNTIME_DIR/chrome-cdp/node_modules/playwright-core"
install -m 755 "$SOURCE_DIR/niannian-mac-worker.mjs" "$BIN_DIR/niannian-mac-worker.mjs"
install -m 755 "$SOURCE_DIR/mimo-safari-visible-submit.mjs" "$BIN_DIR/mimo-safari-visible-submit.mjs"
install -m 755 "$SOURCE_DIR/mimo-safari-visible-sync.mjs" "$BIN_DIR/mimo-safari-visible-sync.mjs"
install -m 755 "$SOURCE_DIR/prepare-mimo-safari-session.mjs" "$BIN_DIR/prepare-mimo-safari-session.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp.mjs" "$BIN_DIR/mimo-chrome-cdp.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp-submit.mjs" "$BIN_DIR/mimo-chrome-cdp-submit.mjs"
install -m 755 "$SOURCE_DIR/mimo-chrome-cdp-sync.mjs" "$BIN_DIR/mimo-chrome-cdp-sync.mjs"
install -m 644 "$SOURCE_DIR/worker-result.schema.json" "$BIN_DIR/worker-result.schema.json"
security delete-generic-password -a "$USER" -s "$SERVICE" "$KEYCHAIN" >/dev/null 2>&1 || true
security add-generic-password -a "$USER" -s "$SERVICE" -w "$TOKEN" -T /usr/bin/security "$KEYCHAIN" >/dev/null
if [[ -n "${MIMO_USERNAME:-}" && -n "${MIMO_PASSWORD:-}" ]]; then
  security delete-generic-password -a "$USER" -s "$MIMO_USERNAME_SERVICE" "$KEYCHAIN" >/dev/null 2>&1 || true
  security delete-generic-password -a "$USER" -s "$MIMO_PASSWORD_SERVICE" "$KEYCHAIN" >/dev/null 2>&1 || true
  security add-generic-password -a "$USER" -s "$MIMO_USERNAME_SERVICE" -w "$MIMO_USERNAME" -T /usr/bin/security "$KEYCHAIN" >/dev/null
  security add-generic-password -a "$USER" -s "$MIMO_PASSWORD_SERVICE" -w "$MIMO_PASSWORD" -T /usr/bin/security "$KEYCHAIN" >/dev/null
fi

cat > "$WRAPPER" <<EOF
#!/bin/zsh
set -euo pipefail
export PATH="$(dirname "$NODE_BIN"):$(dirname "$CODEX_BIN"):$(dirname "$FFPROBE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NIANNIAN_ORIGIN="$ORIGIN"
export NIANNIAN_MAC_AGENT_TOKEN="\$(security find-generic-password -a "\$(id -un)" -s "$SERVICE" -w "$KEYCHAIN")"
export NIANNIAN_MAC_WORKER_ID="lsbmacbook-air-codex"
export NIANNIAN_MAC_WORKSPACE="$WORKSPACE"
export NIANNIAN_CODEX_BIN="$CODEX_BIN"
export NIANNIAN_SKILL_BUNDLE_MANIFEST="$HOME/.codex/niannian-skill-bundle.json"
export NIANNIAN_FFPROBE_BIN="$FFPROBE_BIN"
export MIMO_BASE_URL="${MIMO_BASE_URL:-https://fd.aancn.cn}"
export NIANNIAN_MIMO_PARENT_BRIDGE="true"
export NIANNIAN_MIMO_BROWSER_ROUTE="chrome_cdp"
export NIANNIAN_MIMO_CDP_URL="http://127.0.0.1:9226"
export NIANNIAN_MIMO_CDP_RUNTIME="$RUNTIME_DIR/chrome-cdp/node_modules/playwright-core"
if security find-generic-password -a "\$(id -un)" -s "$MIMO_USERNAME_SERVICE" "$KEYCHAIN" >/dev/null 2>&1; then
  export MIMO_USERNAME="\$(security find-generic-password -a "\$(id -un)" -s "$MIMO_USERNAME_SERVICE" -w "$KEYCHAIN")"
fi
if security find-generic-password -a "\$(id -un)" -s "$MIMO_PASSWORD_SERVICE" "$KEYCHAIN" >/dev/null 2>&1; then
  export MIMO_PASSWORD="\$(security find-generic-password -a "\$(id -un)" -s "$MIMO_PASSWORD_SERVICE" -w "$KEYCHAIN")"
fi
export NIANNIAN_MAC_HEARTBEAT_MS="30000"
export NIANNIAN_CODEX_TIMEOUT_MS="2700000"
export NIANNIAN_CODEX_SANDBOX="danger-full-access"
exec "$NODE_BIN" "$BIN_DIR/niannian-mac-worker.mjs" run-loop
EOF
chmod 700 "$WRAPPER"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.niannian.mac-codex-worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$WRAPPER</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/worker.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/worker.err.log</string>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
EOF
chmod 600 "$PLIST"
plutil -lint "$PLIST"

launchctl bootout "gui/$UID/com.niannian.mac-codex-worker" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl kickstart -k "gui/$UID/com.niannian.mac-codex-worker"

unset TOKEN NIANNIAN_MAC_AGENT_TOKEN
echo "NIANNIAN_MAC_WORKER_INSTALLED"
echo "PLIST=$PLIST"
echo "LOG_DIR=$LOG_DIR"
echo "ROLLBACK_DIR=$ROLLBACK_DIR"
