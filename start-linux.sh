#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

export PATH="$HOME/.volta/bin:$HOME/.local/share/mise/shims:$HOME/.asdf/shims:$HOME/.local/bin:/usr/local/bin:$PATH"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env 2>/dev/null)" || true
elif [ -x "$HOME/.local/share/fnm/fnm" ]; then
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env 2>/dev/null)" || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js (v22.5+) not found in PATH. Please install Node.js 22+."
  exit 1
fi

if ! node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj>22||(maj===22&&min>=5)?0:1)"; then
  echo "[ERROR] Node.js v22.5.0+ is required (detected $(node -v))."
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
