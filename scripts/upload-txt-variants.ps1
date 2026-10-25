Import-Module (Join-Path $PSScriptRoot "lib\PnPSession.psm1") -Force
$siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
$serverRelativeFolder = "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test"

$stagingDir = Join-Path $PSScriptRoot "..\.cph\state\live-test-workspace"

$ctx = Get-DpsClientContext -SiteUrl $siteUrl

function Upload-FileDirect {
    param([string]$LocalFile, [string]$TargetServerRelativePath)
    Write-Host "Uploading $LocalFile -> $TargetServerRelativePath..."
    $stream = [System.IO.File]::OpenRead($LocalFile)
    try {
        [Microsoft.SharePoint.Client.File]::SaveBinaryDirect($ctx, $TargetServerRelativePath, $stream, $true) | Out-Null
        Write-Host "Uploaded successfully: $TargetServerRelativePath"
    } finally {
        $stream.Dispose()
    }
}

# 1. app_entry.txt
$entryContent = @"
# app_entry.txt - Main Entry Point for Live Test Pipeline
from pricing_service import get_discounted_rate

BASE_PRICE = 1000
FINAL_TOTAL = get_discounted_rate(BASE_PRICE)

if __name__ == "__main__":
    print(f"Computed FINAL_TOTAL: {FINAL_TOTAL}")
"@
$entryPath = Join-Path $stagingDir "app_entry.txt"
[System.IO.File]::WriteAllText($entryPath, $entryContent, [System.Text.Encoding]::UTF8)

# 2. pricing_service.txt
$serviceContent = @"
# pricing_service.txt - Intermediate Domain Logic
from kernel_calc import KERNEL_MULTIPLIER, SECURITY_OFFSET

def get_discounted_rate(price: int) -> int:
    """Calculates discounted rate based on kernel multiplier and security offset."""
    return (price * KERNEL_MULTIPLIER) + SECURITY_OFFSET
"@
$servicePath = Join-Path $stagingDir "pricing_service.txt"
[System.IO.File]::WriteAllText($servicePath, $serviceContent, [System.Text.Encoding]::UTF8)

# 3. kernel_calc.txt (v1)
$kernelContentV1 = @"
# kernel_calc.txt - Core Math Kernel (Version 1)
KERNEL_MULTIPLIER = 3
SECURITY_OFFSET = 555

# Verification Math:
# FINAL_TOTAL = (1000 * 3) + 555 = 3555
"@
$kernelPath = Join-Path $stagingDir "kernel_calc.txt"
[System.IO.File]::WriteAllText($kernelPath, $kernelContentV1, [System.Text.Encoding]::UTF8)

Upload-FileDirect -LocalFile $entryPath -TargetServerRelativePath "$serverRelativeFolder/app_entry.txt"
Upload-FileDirect -LocalFile $servicePath -TargetServerRelativePath "$serverRelativeFolder/pricing_service.txt"
Upload-FileDirect -LocalFile $kernelPath -TargetServerRelativePath "$serverRelativeFolder/kernel_calc.txt"

Write-Host "Uploaded .txt variants to SharePoint live test directory successfully."

