#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js (v22.5+) not found in PATH. Please install Node.js 22+."
  exit 1
fi

if [ ! -f "dist/cli.js" ]; then
  echo "[Anti-Multi] Building TypeScript bundle..."
  npx tsc -p tsconfig.build.json
fi

exec node dist/cli.js "$@"
