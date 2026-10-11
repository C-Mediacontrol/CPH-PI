@echo off
setlocal

chcp 65001 >nul 2>&1
set "CPH_PI_ORIGINAL_CWD=%CD%"
set "SCRIPT_DIR=%~dp0"

where bun >nul 2>&1
if %ERRORLEVEL% equ 0 (
    bun run "%SCRIPT_DIR%bin\cph-pi.js" %*
    exit /b %ERRORLEVEL%
)

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    node "%SCRIPT_DIR%bin\cph-pi.js" %*
    exit /b %ERRORLEVEL%
)

echo [CPH-PI ERROR] Neither Bun nor Node.js runtime was found in PATH.
echo Please install Bun (https://bun.sh) or Node.js (https://nodejs.org).
exit /b 1

