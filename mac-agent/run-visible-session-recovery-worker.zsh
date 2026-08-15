#!/bin/zsh
set -euo pipefail

IFS= read -r AGENT_TOKEN
[[ ${#AGENT_TOKEN} -ge 24 ]] || { print -u2 "RECOVERY_AGENT_TOKEN_INVALID"; exit 1; }

NODE_BIN="$HOME/.local/bin/node"
INSTALL_ROOT="$HOME/Library/Application Support/NiannianMacWorker"
WORKER="$INSTALL_ROOT/bin/niannian-mac-worker.mjs"
LOG="$INSTALL_ROOT/logs/visible-session-recovery.log"

[[ -x "$NODE_BIN" && -f "$WORKER" ]] || { print -u2 "RECOVERY_WORKER_REQUIRED"; exit 1; }
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NIANNIAN_ORIGIN="https://sd2.cauai.fun"
export NIANNIAN_MAC_AGENT_TOKEN="$AGENT_TOKEN"
export NIANNIAN_MAC_WORKER_ID="lsbmacbook-air-codex"
export NIANNIAN_MAC_WORKSPACE="$HOME/niannian-mac-worker"
export NIANNIAN_SKILL_BUNDLE_MANIFEST="$HOME/.codex/niannian-skill-bundle.json"
export NIANNIAN_FFPROBE_BIN="$INSTALL_ROOT/runtime/node_modules/@ffprobe-installer/darwin-arm64/ffprobe"
export NIANNIAN_MIMO_PARENT_BRIDGE="true"
export NIANNIAN_MIMO_WEBDRIVER_URL="http://127.0.0.1:4444"
export NIANNIAN_MIMO_INITIAL_POLL_DELAY_MS="60000"
export NIANNIAN_CODEX_MAX_CYCLES="60"

nohup "$NODE_BIN" "$WORKER" run-loop </dev/null >> "$LOG" 2>&1 &
pid=$!
unset AGENT_TOKEN NIANNIAN_MAC_AGENT_TOKEN
print -r -- "VISIBLE_SESSION_PARENT_WORKER_PID=$pid"
