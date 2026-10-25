Import-Module (Join-Path $PSScriptRoot "lib\PnPSession.psm1") -Force
$siteUrl = "https://cmacgmgroup.sharepoint.com/sites/CMA-GBSC_BKGDOMAIN"
try {
    Write-Host "Attempting Get-DpsClientContext for $siteUrl..."
    $ctx = Get-DpsClientContext -SiteUrl $siteUrl
    if ($ctx) {
        Write-Host "PNP_AUTH_SUCCESS: Connected to $($ctx.Url)"
    } else {
        Write-Host "PNP_AUTH_FAILED: ctx is null"
    }
} catch {
    Write-Host "PNP_AUTH_ERROR: $($_.Exception.Message)"
}

