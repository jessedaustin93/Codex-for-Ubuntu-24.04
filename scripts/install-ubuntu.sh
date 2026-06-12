#!/usr/bin/env bash
set -euo pipefail

if [[ "$(lsb_release -rs 2>/dev/null || true)" != "24.04" ]]; then
  echo "Warning: this installer is tested on Ubuntu 24.04."
fi

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(\".\")[0])')"
fi

if (( NODE_MAJOR < 20 )); then
  echo "Installing Node.js 22 and build prerequisites..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs build-essential
fi

sudo apt-get update
sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils

if ! command -v codex >/dev/null 2>&1; then
  echo "Installing the official Codex CLI..."
  sudo npm install -g @openai/codex
fi

npm install
npm run dist

echo
echo "Build complete. Install the .deb from dist/ or run the AppImage."
echo "Before first use, authenticate with: codex login"
