# CPH-PI PowerShell Launcher Script
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

# 1. UTF-8 Console encoding configuration
try {
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
}

# 2. Capture original working directory and switch to script directory
$env:CPH_PI_ORIGINAL_CWD = (Get-Location).ProviderPath
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) {
    $ScriptDir = $PSScriptRoot
}
if ($ScriptDir) {
    Set-Location -LiteralPath $ScriptDir
}

# 3. Detect runtime and pass through arguments
try {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        if ($CliArgs -and $CliArgs.Count -gt 0) {
            node --import tsx src/cli.ts @CliArgs
        } else {
            node --import tsx src/cli.ts
        }
        exit $LASTEXITCODE
    } elseif (Get-Command bun -ErrorAction SilentlyContinue) {
        if ($CliArgs -and $CliArgs.Count -gt 0) {
            bun run src/cli.ts @CliArgs
        } else {
            bun run src/cli.ts
        }
        exit $LASTEXITCODE
    } else {
        Write-Error "[CPH-PI Error] Neither Node.js nor Bun runtime was found in PATH. Please install Node.js (https://nodejs.org) or Bun (https://bun.sh)."
        exit 1
    }
} catch {
    Write-Error "[CPH-PI Launcher Error] $($_.Exception.Message)"
    exit 1
}
