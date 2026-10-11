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
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        if ($CliArgs -and $CliArgs.Count -gt 0) {
            bun run src/cli.ts @CliArgs
        } else {
            bun run src/cli.ts
        }
        exit $LASTEXITCODE
    } elseif (Get-Command node -ErrorAction SilentlyContinue) {
        if (Get-Command npx -ErrorAction SilentlyContinue) {
            if ($CliArgs -and $CliArgs.Count -gt 0) {
                npx tsx src/cli.ts @CliArgs
            } else {
                npx tsx src/cli.ts
            }
            exit $LASTEXITCODE
        } else {
            if ($CliArgs -and $CliArgs.Count -gt 0) {
                node --loader ts-node/esm src/cli.ts @CliArgs
            } else {
                node --loader ts-node/esm src/cli.ts
            }
            exit $LASTEXITCODE
        }
    } else {
        Write-Error "[CPH-PI Error] Neither Bun nor Node.js runtime was found in PATH. Please install Bun (https://bun.sh) or Node.js."
        exit 1
    }
} catch {
    Write-Error "[CPH-PI Launcher Error] $($_.Exception.Message)"
    exit 1
}
