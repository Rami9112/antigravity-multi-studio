@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anti-Multi Studio — Antigravity Multi-Account & Stealth Hub

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js ^(v22.5+^) not found in PATH. Please install Node.js 22+.
  pause
  exit /b 1
)

node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj>22||(maj===22&&min>=5)?0:1)"
if %errorlevel% neq 0 (
  echo [ERROR] Node.js v22.5.0+ is required ^(current: & node -v & echo ^). Please upgrade Node.js.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Anti-Multi] Installing dependencies...
  where pnpm >nul 2>nul
  if %errorlevel% equ 0 (
    call pnpm install
  ) else (
    call npm install
  )
  if %errorlevel% neq 0 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist "dist\cli.js" (
  echo [Anti-Multi] Building TypeScript bundle...
  call npm run build
  if %errorlevel% neq 0 (
    echo [ERROR] TypeScript build failed.
    pause
    exit /b 1
  )
)

set "NODE_SQLITE_FLAG=--no-warnings"
node -e "const [maj,min]=process.versions.node.split('.').map(Number);process.exit(maj===22&&min<13?0:1)"
if %errorlevel% equ 0 (
  set "NODE_SQLITE_FLAG=--experimental-sqlite --no-warnings"
)

node %NODE_SQLITE_FLAG% dist/cli.js %*
pause
