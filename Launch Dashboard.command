#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR" || exit 1

echo "Starting Conserva SES Score Dashboard"
echo "Project: $PROJECT_DIR"
echo

APP_PATH="$PROJECT_DIR/dist/mac-arm64/Conserva SES Score Dashboard.app"
DMG_PATH="$PROJECT_DIR/dist/Conserva SES Score Dashboard-0.1.0-arm64.dmg"

if [ -d "$APP_PATH" ]; then
  echo "Opening Electron desktop app..."
  open -n "$APP_PATH"
  exit 0
fi

if [ -f "$DMG_PATH" ]; then
  echo "The packaged app is inside the DMG."
  echo "Opening the DMG now. Drag the app into Applications, then double-click it there."
  open "$DMG_PATH"
  exit 0
fi

echo "The Electron desktop app has not been built yet."
echo
echo "Build it first with:"
echo "  npm run dist:mac"
echo
echo "Then double-click this launcher again, or open:"
echo "  dist/mac-arm64/Conserva SES Score Dashboard.app"
echo
echo "Press any key to close this window."
read -k 1
exit 1
