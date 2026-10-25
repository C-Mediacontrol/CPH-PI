Import-Module (Join-Path $PSScriptRoot "lib\PnPSession.psm1") -Force
$siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
$serverRelativeFolder = "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test"

try {
    $ctx = Get-DpsClientContext -SiteUrl $siteUrl
    Write-Host "Connected. Checking server-relative folder: $serverRelativeFolder"
    $folder = $ctx.Web.GetFolderByServerRelativeUrl($serverRelativeFolder)
    $ctx.Load($folder)
    $ctx.Load($folder.Files)
    $ctx.ExecuteQuery()

    Write-Host "Folder exists: $($folder.Name)"
    Write-Host "ServerRelativeUrl: $($folder.ServerRelativeUrl)"
    Write-Host "Files count in folder: $($folder.Files.Count)"
    foreach ($f in $folder.Files) {
        $ctx.Load($f)
        $ctx.ExecuteQuery()
        Write-Host " - $($f.Name) (Size: $($f.Length), ServerRelativeUrl: $($f.ServerRelativeUrl), UniqueId: $($f.UniqueId))"
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

