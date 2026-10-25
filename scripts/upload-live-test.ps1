[CmdletBinding()]
param(
    [ValidateSet("v1", "v2", "single_kernel_v2")][string]$Version = "v1"
)

Import-Module (Join-Path $PSScriptRoot "lib\PnPSession.psm1") -Force
$siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
$serverRelativeFolder = "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test"

$stagingDir = Join-Path $PSScriptRoot "..\.cph\state\live-test-workspace"
if (-not (Test-Path $stagingDir)) {
    [System.IO.Directory]::CreateDirectory($stagingDir) | Out-Null
}

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

if ($Version -eq "v1") {
    # 1. app_entry.py
    $entryContent = @"
# app_entry.py - Main Entry Point for Live Test Pipeline
from pricing_service import get_discounted_rate

BASE_PRICE = 1000
FINAL_TOTAL = get_discounted_rate(BASE_PRICE)

if __name__ == "__main__":
    print(f"Computed FINAL_TOTAL: {FINAL_TOTAL}")
"@
    $entryPath = Join-Path $stagingDir "app_entry.py"
    [System.IO.File]::WriteAllText($entryPath, $entryContent, [System.Text.Encoding]::UTF8)

    # 2. pricing_service.py
    $serviceContent = @"
# pricing_service.py - Intermediate Domain Logic
from kernel_calc import KERNEL_MULTIPLIER, SECURITY_OFFSET

def get_discounted_rate(price: int) -> int:
    """Calculates discounted rate based on kernel multiplier and security offset."""
    return (price * KERNEL_MULTIPLIER) + SECURITY_OFFSET
"@
    $servicePath = Join-Path $stagingDir "pricing_service.py"
    [System.IO.File]::WriteAllText($servicePath, $serviceContent, [System.Text.Encoding]::UTF8)

    # 3. kernel_calc.py (v1)
    $kernelContentV1 = @"
# kernel_calc.py - Core Math Kernel (Version 1)
KERNEL_MULTIPLIER = 3
SECURITY_OFFSET = 555

# Verification Math:
# FINAL_TOTAL = (1000 * 3) + 555 = 3555
"@
    $kernelPath = Join-Path $stagingDir "kernel_calc.py"
    [System.IO.File]::WriteAllText($kernelPath, $kernelContentV1, [System.Text.Encoding]::UTF8)

    Upload-FileDirect -LocalFile $entryPath -TargetServerRelativePath "$serverRelativeFolder/app_entry.py"
    Upload-FileDirect -LocalFile $servicePath -TargetServerRelativePath "$serverRelativeFolder/pricing_service.py"
    Upload-FileDirect -LocalFile $kernelPath -TargetServerRelativePath "$serverRelativeFolder/kernel_calc.py"
} elseif ($Version -eq "single_kernel_v2" -or $Version -eq "v2") {
    # kernel_calc.py & kernel_calc.txt (v2) - Single file overwrite
    $kernelContentV2 = @"
# kernel_calc.py - Core Math Kernel (Version 2 - Updated via PnP)
KERNEL_MULTIPLIER = 7
SECURITY_OFFSET = 888

# Verification Math:
# FINAL_TOTAL = (1000 * 7) + 888 = 7888
"@
    $kernelPathPy = Join-Path $stagingDir "kernel_calc.py"
    $kernelPathTxt = Join-Path $stagingDir "kernel_calc.txt"
    [System.IO.File]::WriteAllText($kernelPathPy, $kernelContentV2, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($kernelPathTxt, $kernelContentV2, [System.Text.Encoding]::UTF8)

    Upload-FileDirect -LocalFile $kernelPathPy -TargetServerRelativePath "$serverRelativeFolder/kernel_calc.py"
    Upload-FileDirect -LocalFile $kernelPathTxt -TargetServerRelativePath "$serverRelativeFolder/kernel_calc.txt"
}

# Verify uploaded files in SharePoint
$folder = $ctx.Web.GetFolderByServerRelativeUrl($serverRelativeFolder)
$ctx.Load($folder)
$ctx.Load($folder.Files)
$ctx.ExecuteQuery()

Write-Host "`n--- Current SharePoint State for '$($folder.Name)' ---"
foreach ($f in $folder.Files) {
    $ctx.Load($f)
    $ctx.ExecuteQuery()
    Write-Host "File: $($f.Name) | Length: $($f.Length) | TimeLastModified: $($f.TimeLastModified) | UniqueId: $($f.UniqueId)"
}
