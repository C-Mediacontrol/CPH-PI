# CPH-PI PowerShell Standalone Launcher Script
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

# 2. Capture original working directory
$env:CPH_PI_ORIGINAL_CWD = (Get-Location).ProviderPath
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) {
    $ScriptDir = $PSScriptRoot
}
$TargetScript = Join-Path $ScriptDir "bin\cph-pi.js"

# 3. Detect runtime and pass through arguments
try {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        if ($CliArgs -and $CliArgs.Count -gt 0) {
            bun run $TargetScript @CliArgs
        } else {
            bun run $TargetScript
        }
        exit $LASTEXITCODE
    } elseif (Get-Command node -ErrorAction SilentlyContinue) {
        if ($CliArgs -and $CliArgs.Count -gt 0) {
            node $TargetScript @CliArgs
        } else {
            node $TargetScript
        }
        exit $LASTEXITCODE
    } else {
        Write-Error "[CPH-PI Error] Neither Bun nor Node.js runtime was found in PATH. Please install Bun (https://bun.sh) or Node.js (https://nodejs.org)."
        exit 1
    }
} catch {
    Write-Error "[CPH-PI Launcher Error] $($_.Exception.Message)"
    exit 1
}

