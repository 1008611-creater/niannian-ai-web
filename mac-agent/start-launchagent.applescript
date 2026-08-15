tell application "Terminal"
  do script "launchctl bootstrap gui/501 /Users/lsb/Library/LaunchAgents/com.niannian.mac-codex-worker.plist; launchctl kickstart -k gui/501/com.niannian.mac-codex-worker"
end tell
