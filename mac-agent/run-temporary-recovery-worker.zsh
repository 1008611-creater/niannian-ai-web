#!/bin/zsh
set -euo pipefail

# This is an in-memory recovery runner for an already authorized task. It is
# deliberately not a LaunchAgent replacement: credentials arrive once on
# stdin, are inherited only by this parent worker, and are never written out.
IFS= read -r -d '' AGENT_TOKEN
IFS= read -r -d '' MIMO_USER
IFS= read -r -d '' MIMO_PASS

NODE_BIN="$HOME/.local/bin/node"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
FFPROBE_BIN="$INSTALL_ROOT/runtime/node_modules/@ffprobe-installer/darwin-arm64/ffprobe"
WORKER="$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
LOG="$INSTALL_ROOT/logs/direct-recovery-1.4.8.log"

[[ -x "$NODE_BIN" ]] || { print -u2 "NODE_REQUIRED"; exit 1; }
[[ -x "$FFPROBE_BIN" ]] || { print -u2 "FFPROBE_REQUIRED"; exit 1; }
[[ -f "$WORKER" ]] || { print -u2 "WORKER_REQUIRED"; exit 1; }
[[ ${#AGENT_TOKEN} -ge 24 && -n "$MIMO_USER" && ${#MIMO_PASS} -ge 4 ]] || { print -u2 "RECOVERY_CREDENTIAL_INPUT_INVALID"; exit 1; }

export PATH="$HOME/.local/bin:$(dirname "$FFPROBE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NIANNIAN_ORIGIN="https://sd2.cauai.fun"
export NIANNIAN_MAC_AGENT_TOKEN="$AGENT_TOKEN"
export NIANNIAN_MAC_WORKER_ID="lsbmacbook-air-codex"
export NIANNIAN_MAC_WORKSPACE="$HOME/niannian-mac-worker"
export NIANNIAN_SKILL_BUNDLE_MANIFEST="$HOME/.codex/niannian-skill-bundle.json"
export NIANNIAN_FFPROBE_BIN="$FFPROBE_BIN"
export NIANNIAN_MIMO_PARENT_BRIDGE="true"
export NIANNIAN_MIMO_WEBDRIVER_URL="http://127.0.0.1:4444"
export MIMO_USERNAME="$MIMO_USER"
export MIMO_PASSWORD="$MIMO_PASS"

nohup "$NODE_BIN" "$WORKER" run-loop </dev/null >> "$LOG" 2>&1 &
pid=$!
unset AGENT_TOKEN MIMO_USER MIMO_PASS NIANNIAN_MAC_AGENT_TOKEN MIMO_USERNAME MIMO_PASSWORD
print -r -- "DIRECT_PARENT_WORKER_PID=$pid"
