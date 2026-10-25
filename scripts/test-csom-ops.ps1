Import-Module (Join-Path $PSScriptRoot "lib\PnPSession.psm1") -Force
$siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
$targetBase = "/sites/CMA-GBSC_BKGDOMAIN/AFRASIA/01 Team/03 AFR/AFR SCHK/06_Training/New Hire Training/2025/Vincent Fu/WorkSpace/live test"

try {
    $ctx = Get-DpsClientContext -SiteUrl $siteUrl
    $folder = $ctx.Web.GetFolderByServerRelativeUrl($targetBase)
    $ctx.Load($folder)
    $ctx.Load($folder.Files)
    $ctx.ExecuteQuery()

    Write-Host "Connected. Folder: $($folder.Name)"
    Write-Host "Files in folder:"
    foreach ($f in $folder.Files) {
        $ctx.Load($f)
        $ctx.ExecuteQuery()
        Write-Host " - $($f.Name) (ServerRelativeUrl: $($f.ServerRelativeUrl))"
    }

    # Test creating a dummy subfolder
    $subfolderUrl = "$targetBase/test-sub"
    Write-Host "Testing subfolder check: $subfolderUrl"
    $sub = $ctx.Web.GetFolderByServerRelativeUrl($subfolderUrl)
    $ctx.Load($sub)
    try {
        $ctx.ExecuteQuery()
        Write-Host "Subfolder already exists: $($sub.Name)"
    } catch {
        Write-Host "Creating subfolder: test-sub"
        $sub = $folder.Folders.Add("test-sub")
        $ctx.ExecuteQuery()
        Write-Host "Subfolder created: test-sub"
    }

    # Clean up test-sub
    $sub.DeleteObject()
    $ctx.ExecuteQuery()
    Write-Host "Subfolder deleted successfully."
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

