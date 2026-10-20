@echo off
setlocal

chcp 65001 >nul 2>&1
set "CPH_PI_ORIGINAL_CWD=%CD%"
cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    node --import tsx src/cli.ts %*
    exit /b %ERRORLEVEL%
)

where bun >nul 2>&1
if %ERRORLEVEL% equ 0 (
    bun run src/cli.ts %*
    exit /b %ERRORLEVEL%
)

echo [CPH-PI ERROR] Neither Node.js nor Bun runtime was found in PATH.
echo Please install Node.js (https://nodejs.org) or Bun (https://bun.sh).
exit /b 1
