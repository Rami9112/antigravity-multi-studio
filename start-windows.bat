@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anti-Multi Studio — Antigravity Multi-Account & Stealth Hub

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js (v22.5+) not found in PATH. Please install Node.js 22+.
  pause
  exit /b 1
)

if not exist "dist\cli.js" (
  echo [Anti-Multi] Building TypeScript bundle...
  call npx tsc -p tsconfig.build.json
)

node dist/cli.js %*
pause
