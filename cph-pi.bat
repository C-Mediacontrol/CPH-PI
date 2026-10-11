@echo off
setlocal

chcp 65001 >nul 2>&1
set "CPH_PI_ORIGINAL_CWD=%CD%"
cd /d "%~dp0"

where bun >nul 2>&1
if %ERRORLEVEL% equ 0 (
    bun run src/cli.ts %*
    exit /b %ERRORLEVEL%
)

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    where npx >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        npx tsx src/cli.ts %*
        exit /b %ERRORLEVEL%
    )
    node --loader ts-node/esm src/cli.ts %*
    exit /b %ERRORLEVEL%
)

echo [CPH-PI ERROR] Neither Bun nor Node.js runtime was found in PATH.
echo Please install Bun (https://bun.sh) or Node.js (https://nodejs.org).
exit /b 1
