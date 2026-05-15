#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

echo "Starting Conserva SES Score Dashboard"
echo "Project: $PROJECT_DIR"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found in this Terminal session."
  echo "Install Node.js/npm, then double-click this launcher again."
  echo
  echo "Press any key to close this window."
  read -k 1
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Dependencies are not installed yet. Running npm install..."
  npm install
  install_status=$?

  if [ "$install_status" -ne 0 ]; then
    echo
    echo "npm install failed with exit code $install_status."
    echo "Press any key to close this window."
    read -k 1
    exit "$install_status"
  fi

  echo
fi

echo "Local dashboard URL: http://localhost:${PORT:-3000}"
echo "Leave this Terminal window open while using the dashboard."
echo "Press Control-C here to stop the local server."
echo

npm run dashboard
status=$?

echo
echo "Dashboard server stopped with exit code $status."
echo "Press any key to close this window."
read -k 1
exit "$status"
