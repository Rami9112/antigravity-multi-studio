#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Enrich PATH for macOS Finder double-click (.command launches with minimal PATH)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/share/mise/shims:$HOME/.asdf/shims:$HOME/.local/bin:$PATH"

for brew_node in /opt/homebrew/opt/node@24/bin /opt/homebrew/opt/node@22/bin /usr/local/opt/node@24/bin /usr/local/opt/node@22/bin; do
  if [ -d "$brew_node" ]; then
    export PATH="$brew_node:$PATH"
  fi
done

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env 2>/dev/null)" || true
elif [ -x "$HOME/Library/Application Support/fnm/fnm" ]; then
  export PATH="$HOME/Library/Application Support/fnm:$PATH"
  eval "$(fnm env 2>/dev/null)" || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js (v22.5+) not found in PATH."
  echo "        macOS(Homebrew) 설치: brew install node"
  read -r -p "Press Enter to exit..."
  exit 1
fi

if ! node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj>22||(maj===22&&min>=5)?0:1)"; then
  echo "[ERROR] Node.js v22.5.0+ is required (detected $(node -v))."
  echo "        Please install Node.js 22+ (e.g. brew install node or nvm install 22)."
  read -r -p "Press Enter to exit..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[Anti-Multi] Installing dependencies..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install
  else
    npm install
  fi
fi

if [ ! -f "dist/cli.js" ]; then
  echo "[Anti-Multi] Building TypeScript bundle..."
  npm run build
fi

NODE_FLAGS="--no-warnings"
if node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj===22&&min<13?0:1)"; then
  NODE_FLAGS="--experimental-sqlite --no-warnings"
fi

# shellcheck disable=SC2086
exec node $NODE_FLAGS dist/cli.js "$@"
