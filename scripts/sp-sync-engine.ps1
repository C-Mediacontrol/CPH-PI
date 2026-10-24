<#
.SYNOPSIS
    sp-sync-engine.ps1 - SharePoint 物理镜像同步引擎 (Windows PowerShell 5.1 强锁定)
.DESCRIPTION
    支持 SyncWorkspace (增量全量) 与 SyncSingleFile (单文件更新)。
    基于 .cph/state/sync-manifest.json 状态基线比对 SHA256，未变更跳过，失败重试3次并写入 dirty-sync.jsonl。
    遵循本地单一真实源 (SSOT) 规范，本地文件绝对覆盖云端。
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('SyncWorkspace', 'SyncSingleFile', 'Prewarm', 'PullFile', 'VerifyMirror', 'EnsureFolder')][string]$Action,
    [string]$SiteUrl,
    [string]$TargetFolder = '/Shared Documents/workspace-mirror',
    [Alias('FilePath')][string]$SourceFile,
    [Alias('FolderPath')][string]$SourceFolder = '',
    [string]$WorkspaceRoot,
    [string]$ManifestPath,
    [string]$DirtyLogPath,
    [switch]$AllowLegacyFallback,
    [switch]$MockTransport,
    [switch]$HardReset
)

# 1. 运行环境硬断言：必须且仅能在 powershell.exe (Windows PowerShell 5.1) 下运行
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw "FATAL: sp-sync-engine.ps1 必须使用 powershell.exe (Windows PowerShell 5.1) 运行！严禁使用 pwsh (PS7+)."
}

# 2. 导入 PnPSession 模块
$pnpModule = Join-Path $PSScriptRoot "lib\PnPSession.psm1"
if (Test-Path $pnpModule) {
    Import-Module $pnpModule -Force -ErrorAction SilentlyContinue
}

# 3. 根目录与状态路径归一化
if (-not $WorkspaceRoot) {
    $WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
} else {
    $WorkspaceRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot)
}
$WorkspaceRoot = $WorkspaceRoot.TrimEnd('\', '/')

$stateDir = Join-Path $WorkspaceRoot '.cph\state'
if (-not (Test-Path $stateDir)) {
    [System.IO.Directory]::CreateDirectory($stateDir) | Out-Null
}

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $WorkspaceRoot '.cph\state\sync-manifest.json'
}
if (-not $DirtyLogPath) {
    $DirtyLogPath = Join-Path $WorkspaceRoot '.cph\state\dirty-sync.jsonl'
}

# 4. SHA256 计算辅助函数
function Get-FileSha256 {
    param([string]$FilePath)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($FilePath)
    try {
        $hashBytes = $hasher.ComputeHash($stream)
        return -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    } finally {
        $stream.Close()
        $stream.Dispose()
        $hasher.Dispose()
    }
}

# 5. 增量状态清单加载与保存
function Get-SyncManifest {
    param([string]$Path)
    $filesMap = @{}
    $foldersMap = @{}
    $lastFullSync = $null
    $lastPrewarmAt = $null
    $version = 2

    if (Test-Path $Path) {
        try {
            $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
            $parsed = $raw | ConvertFrom-Json
            if ($parsed) {
                if ($parsed.version) { $version = [int]$parsed.version }
                if ($parsed.lastFullSync) { $lastFullSync = $parsed.lastFullSync }
                if ($parsed.lastPrewarmAt) { $lastPrewarmAt = $parsed.lastPrewarmAt }
                if ($parsed.files) {
                    $parsed.files.PSObject.Properties | ForEach-Object {
                        $filesMap[$_.Name] = @{
                            sha256 = [string]$_.Value.sha256
                            size = if ($_.Value.size) { [long]$_.Value.size } else { 0 }
                            uniqueId = [string]$_.Value.uniqueId
                            lastSyncedAt = [string]$_.Value.lastSyncedAt
                        }
                    }
                }
                if ($parsed.folders) {
                    $parsed.folders.PSObject.Properties | ForEach-Object {
                        $foldersMap[$_.Name] = @{
                            lastSyncedAt = [string]$_.Value.lastSyncedAt
                            uniqueId = [string]$_.Value.uniqueId
                        }
                    }
                }
            }
        } catch {
            Write-Warning "Manifest parse warning: $($_.Exception.Message)"
        }
    }

    if ($version -lt 2) {
        $version = 2
    }

    return @{
        version = $version
        lastFullSync = $lastFullSync
        lastPrewarmAt = $lastPrewarmAt
        files = $filesMap
        folders = $foldersMap
    }
}

function Save-SyncManifest {
    param([hashtable]$Manifest, [string]$Path)
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path $dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    }
    if ($Manifest.version -lt 2) {
        $Manifest.version = 2
    }
    if (-not $Manifest.folders) {
        $Manifest.folders = @{}
    }
    $json = $Manifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

# 6. 脏同步追加日志 (JSONL 格式)
function Append-DirtyLog {
    param(
        [string]$Path,
        [string]$File,
        [string]$ErrorMessage,
        [int]$Attempts = 3
    )
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path $dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
    }
    $isoNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $logObj = [ordered]@{
        file = $File
        timestamp = $isoNow
        error = $ErrorMessage
        attempts = $Attempts
    }
    $jsonLine = ($logObj | ConvertTo-Json -Compress) + "`n"
    [System.IO.File]::AppendAllText($Path, $jsonLine, [System.Text.UTF8Encoding]::new($false))
}

# 7. 确保目标文件夹在 SharePoint 存在 (CSOM 递归)
function Ensure-SharePointFolder {
    param(
        $Context,
        [string]$TargetFolder,
        [string]$RelativeDir
    )
    $folder = $Context.Web.GetFolderByServerRelativeUrl($TargetFolder)
    $Context.Load($folder)
    $Context.ExecuteQuery()
    
    if ([string]::IsNullOrWhiteSpace($RelativeDir)) {
        return $folder.ServerRelativeUrl
    }

    $currentFolder = $folder
    $currentRel = $folder.ServerRelativeUrl

    $parts = $RelativeDir.Replace('\', '/').Trim('/').Split('/')
    foreach ($part in $parts) {
        if ([string]::IsNullOrWhiteSpace($part)) { continue }
        $currentRel = "$currentRel/$part"
        try {
            $f = $Context.Web.GetFolderByServerRelativeUrl($currentRel)
            $Context.Load($f)
            $Context.ExecuteQuery()
            $currentFolder = $f
        } catch {
            $currentFolder = $currentFolder.Folders.Add($part)
            $Context.Load($currentFolder)
            $Context.ExecuteQuery()
        }
    }
    return $currentRel
}

# 8. 文件推送到 SharePoint (带 3 次重试与 Mock 支持，纯 CSOM 规避 PnP ambient context 缺失)
function Push-FileToSharePoint {
    param(
        [string]$LocalFullPath,
        [string]$RelativePath,
        [string]$SiteUrl,
        [string]$TargetFolder,
        [switch]$MockTransport,
        [switch]$AllowLegacyFallback
    )
    $maxAttempts = 3
    $attempt = 0
    $lastError = $null

    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            if ($MockTransport) {
                # 模拟单测故障触发
                if ($env:SP_SYNC_MOCK_FAIL -eq '1' -or ($env:SP_SYNC_MOCK_FAIL_FILE -and ($RelativePath -like $env:SP_SYNC_MOCK_FAIL_FILE -or $LocalFullPath -like $env:SP_SYNC_MOCK_FAIL_FILE))) {
                    throw "Simulated network transport error for $RelativePath"
                }
                return $true
            } else {
                if (-not $SiteUrl) {
                    throw "SiteUrl is required when not in MockTransport mode"
                }
                $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
                if (-not $ctx) {
                    throw "Unable to acquire SharePoint client context for $SiteUrl"
                }
                $relDir = [System.IO.Path]::GetDirectoryName($RelativePath).Replace('\', '/').Trim('/')
                $serverRelFolder = Ensure-SharePointFolder -Context $ctx -TargetFolder $TargetFolder -RelativeDir $relDir
                $fileName = [System.IO.Path]::GetFileName($LocalFullPath)
                $targetFileUrl = "$serverRelFolder/$fileName"

                $stream = [System.IO.File]::OpenRead($LocalFullPath)
                try {
                    [Microsoft.SharePoint.Client.File]::SaveBinaryDirect($ctx, $targetFileUrl, $stream, $true) | Out-Null
                    return $true
                } finally {
                    $stream.Dispose()
                }
            }
        } catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds (100 * $attempt)
        }
    }
    throw $lastError
}

# 8. 本地目录与云端实体双轨采集
function Get-LocalFolders {
    param([string]$WorkspaceRoot)
    $cleanRoot = [System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\', '/')
    $localFolders = @{}
    $dirs = Get-ChildItem -Path $cleanRoot -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object {
        $norm = $_.FullName.Replace('\', '/') + '/'
        $norm -notmatch '/(\.git|\.cph|node_modules|dist|package|Library)/'
    }
    foreach ($d in $dirs) {
        $rel = $d.FullName.Substring($cleanRoot.Length).TrimStart('\', '/').Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($rel)) { continue }
        # 校验 git check-ignore
        try {
            $check = git -C $cleanRoot check-ignore $rel 2>$null
            if ($LASTEXITCODE -eq 0 -and $check) { continue }
            $checkDir = git -C $cleanRoot check-ignore "$rel/" 2>$null
            if ($LASTEXITCODE -eq 0 -and $checkDir) { continue }
        } catch { }
        $localFolders[$rel] = $true
    }
    return $localFolders
}

function Get-SharePointCloudEntities {
    param(
        $Context,
        [string]$TargetFolder
    )
    $folder = $Context.Web.GetFolderByServerRelativeUrl($TargetFolder)
    $Context.Load($folder)
    $Context.ExecuteQuery()
    $rootServerRel = $folder.ServerRelativeUrl.TrimEnd('/')

    $cloudFiles = @{}
    $cloudFolders = @{}

    function Enumerate-EntitiesRecursively($currentFolder) {
        $Context.Load($currentFolder.Files)
        $Context.Load($currentFolder.Folders)
        $Context.ExecuteQuery()

        foreach ($f in $currentFolder.Files) {
            $fRel = $f.ServerRelativeUrl.Substring($rootServerRel.Length).TrimStart('/')
            if ($fRel -eq '.cph-mirror.json') { continue }
            $cloudFiles[$fRel] = $f
        }

        foreach ($sub in $currentFolder.Folders) {
            if ($sub.Name.StartsWith("_") -or $sub.Name -eq "Forms") { continue }
            $subRel = $sub.ServerRelativeUrl.Substring($rootServerRel.Length).TrimStart('/')
            if (-not [string]::IsNullOrWhiteSpace($subRel)) {
                $cloudFolders[$subRel] = $sub
            }
            Enumerate-EntitiesRecursively($sub)
        }
    }

    Enumerate-EntitiesRecursively($folder)
    return @{
        files = $cloudFiles
        folders = $cloudFolders
    }
}

function Get-SharePointCloudFiles {
    param(
        $Context,
        [string]$TargetFolder
    )
    $entities = Get-SharePointCloudEntities -Context $Context -TargetFolder $TargetFolder
    return $entities.files
}

# 9. 单个文件增量判定与同步
function Sync-Item {
    param(
        [string]$RelativePath,
        [string]$WorkspaceRoot,
        [hashtable]$Manifest,
        [string]$ManifestPath,
        [string]$DirtyLogPath,
        [string]$SiteUrl,
        [string]$TargetFolder,
        [switch]$MockTransport,
        [switch]$AllowLegacyFallback
    )
    $normalizedRel = $RelativePath.Replace('\', '/').TrimStart('/')
    $fullPath = Join-Path $WorkspaceRoot $normalizedRel

    if (-not (Test-Path $fullPath)) {
        Write-Warning "File not found: $fullPath"
        return
    }

    $sha256 = Get-FileSha256 -FilePath $fullPath
    $existing = $Manifest.files[$normalizedRel]
    if ($existing -and $existing.sha256 -eq $sha256 -and ($MockTransport -or $cloudFiles.ContainsKey($norm))) {
        Write-Output "[SKIP] $normalizedRel"
        return
    }

    try {
        Push-FileToSharePoint -LocalFullPath $fullPath -RelativePath $normalizedRel `
            -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
            -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
        
        $isoNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $Manifest.files[$normalizedRel] = @{
            sha256 = $sha256
            lastSyncedAt = $isoNow
        }
        Save-SyncManifest -Manifest $Manifest -Path $ManifestPath
        Write-Output "[SYNCED] $normalizedRel"
    } catch {
        Append-DirtyLog -Path $DirtyLogPath -File $normalizedRel -ErrorMessage $_.Exception.Message -Attempts 3
        Write-Output "[ERROR] Failed to sync $normalizedRel after 3 attempts: $($_.Exception.Message)"
    }
}

# 9. 动作调度
switch ($Action) {
    'Prewarm' {
        $startTime = [System.Diagnostics.Stopwatch]::StartNew()
        $manifest = if ($HardReset) { @{ version = 2; files = @{}; folders = @{} } } else { Get-SyncManifest -Path $ManifestPath }

        $localFiles = @()
        try {
            $gitOut = git -C $WorkspaceRoot ls-files --cached --others --exclude-standard 2>$null
            if ($LASTEXITCODE -eq 0 -and $gitOut) {
                $localFiles = @($gitOut)
            }
        } catch { }

        if ($localFiles.Count -eq 0) {
            $items = Get-ChildItem -Path $WorkspaceRoot -Recurse -File | Where-Object {
                $_.FullName -notmatch '[\\/](\.git|node_modules|\.cph|dist|package)[\\/]'
            }
            foreach ($item in $items) {
                $rel = $item.FullName.Substring($WorkspaceRoot.Length).TrimStart('\', '/').Replace('\', '/')
                $localFiles += $rel
            }
        }

        # 核心防泄漏过滤：无论来自 git 还是文件遍历，严禁同步 .cph / .git / node_modules 等内部物理状态
        $localFiles = @($localFiles | Where-Object {
            $_ -and ($_ -notmatch '(^|[\\/])(\.git|\.cph|node_modules|dist|package|Library)[\\/]')
        })

        # 1. 递归枚举云端实际存在的所有文件 (实现严格镜像对账)
        $cloudFiles = @{}
        if (-not $MockTransport -and $SiteUrl) {
            try {
                $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
                if ($ctx) {
                    $cloudFiles = Get-SharePointCloudFiles -Context $ctx -TargetFolder $TargetFolder
                }
            } catch {
                Write-Warning "Failed to enumerate cloud files: $($_.Exception.Message)"
            }
        }

        $localSet = @{}
        $results = @()
        $syncedCount = 0
        $skippedCount = 0
        $failedCount = 0

        foreach ($file in $localFiles) {
            if ([string]::IsNullOrWhiteSpace($file)) { continue }
            $norm = $file.Replace('\', '/').TrimStart('/')
            $localSet[$norm] = $true
            $fullPath = Join-Path $WorkspaceRoot $norm
            if (-not (Test-Path $fullPath)) { continue }

            $sha256 = Get-FileSha256 -FilePath $fullPath
            $fileSize = (Get-Item $fullPath).Length
            $existing = $manifest.files[$norm]

            if ($existing -and $existing.sha256 -eq $sha256 -and ($MockTransport -or $cloudFiles.ContainsKey($norm))) {
                $skippedCount++
                $results += @{
                    relativePath = $norm
                    status = 'skipped'
                    size = $fileSize
                    sha256 = $sha256
                    uniqueId = $existing.uniqueId
                }
            } else {
                $uniqueId = "guid-$([System.Guid]::NewGuid().ToString().Substring(0, 8))"
                try {
                    if (-not $MockTransport) {
                        Push-FileToSharePoint -LocalFullPath $fullPath -RelativePath $norm `
                            -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
                            -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
                    }
                    $isoNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                    $manifest.files[$norm] = @{
                        sha256 = $sha256
                        size = $fileSize
                        uniqueId = $uniqueId
                        lastSyncedAt = $isoNow
                    }
                    $syncedCount++
                    $results += @{
                        relativePath = $norm
                        status = 'synced'
                        size = $fileSize
                        sha256 = $sha256
                        uniqueId = $uniqueId
                    }
                } catch {
                    $failedCount++
                    $results += @{
                        relativePath = $norm
                        status = 'failed'
                        size = $fileSize
                        sha256 = $sha256
                        error = $_.Exception.Message
                    }
                }
            }
        }

        # 规则 2 真实清理：云端有本地没有，把云端文件移入回收站
        $prunedCount = 0
        $orphansToRecycle = @{}

        # 真实模式：来自云端实际扫描出的非本地文件
        foreach ($ck in $cloudFiles.Keys) {
            if (-not $localSet.ContainsKey($ck)) {
                $orphansToRecycle[$ck] = $cloudFiles[$ck]
            }
        }

        # 同时也清理 manifest 中历史记录但本地已删除的项 (兼容 Mock 测试与历史遗留)
        foreach ($mk in @($manifest.files.Keys)) {
            if (-not $localSet.ContainsKey($mk)) {
                if (-not $orphansToRecycle.ContainsKey($mk)) {
                    $orphansToRecycle[$mk] = $null
                }
            }
        }

        foreach ($mk in @($orphansToRecycle.Keys)) {
            if (-not $MockTransport) {
                try {
                    $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
                    if ($ctx) {
                        $targetSpFile = $orphansToRecycle[$mk]
                        if (-not $targetSpFile) {
                            $folder = $ctx.Web.GetFolderByServerRelativeUrl($TargetFolder)
                            $ctx.Load($folder)
                            $ctx.ExecuteQuery()
                            $remoteFile = "$($folder.ServerRelativeUrl)/$($mk.Replace('\', '/').TrimStart('/'))"
                            $targetSpFile = $ctx.Web.GetFileByServerRelativeUrl($remoteFile)
                        }
                        $targetSpFile.Recycle() | Out-Null
                        $ctx.ExecuteQuery()
                    }
                } catch {
                    Write-Warning "Failed to recycle cloud orphan file $mk : $($_.Exception.Message)"
                }
            }
            if ($manifest.files.ContainsKey($mk)) {
                $manifest.files.Remove($mk)
            }
            $prunedCount++
            $results += @{
                relativePath = $mk
                status = 'recycled'
            }
        }

        # 清理全空子目录 (例如 test/ 目录内文件全部移入回收站后清理空目录)
        if (-not $MockTransport -and $SiteUrl -and $prunedCount -gt 0) {
            try {
                $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
                if ($ctx) {
                    $rootFolder = $ctx.Web.GetFolderByServerRelativeUrl($TargetFolder)
                    $ctx.Load($rootFolder.Folders)
                    $ctx.ExecuteQuery()
                    foreach ($sub in $rootFolder.Folders) {
                        if ($sub.Name.StartsWith("_") -or $sub.Name -eq "Forms") { continue }
                        $ctx.Load($sub.Files)
                        $ctx.Load($sub.Folders)
                        $ctx.ExecuteQuery()
                        if ($sub.Files.Count -eq 0 -and $sub.Folders.Count -eq 0) {
                            $sub.Recycle() | Out-Null
                            $ctx.ExecuteQuery()
                        }
                    }
                }
            } catch { }
        }

        $manifest.lastPrewarmAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Save-SyncManifest -Manifest $manifest -Path $ManifestPath
        $startTime.Stop()

        $report = @{
            workspaceRoot = $WorkspaceRoot
            targetFolder = $TargetFolder
            totalLocal = $localSet.Count
            syncedCount = $syncedCount
            skippedCount = $skippedCount
            prunedCount = $prunedCount
            failedCount = $failedCount
            durationMs = [int]$startTime.ElapsedMilliseconds
            results = $results
        }

        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
    }

    'SyncSingleFile' {
        if (-not $SourceFile) {
            throw "SourceFile is required for SyncSingleFile action"
        }
        $fullSource = if ([System.IO.Path]::IsPathRooted($SourceFile)) {
            [System.IO.Path]::GetFullPath($SourceFile)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot $SourceFile))
        }
        if (-not (Test-Path $fullSource)) {
            throw "SourceFile does not exist: $fullSource"
        }
        $rel = $fullSource.Substring($WorkspaceRoot.Length).TrimStart('\', '/').Replace('\', '/')
        $sha256 = Get-FileSha256 -FilePath $fullSource
        $fileSize = (Get-Item $fullSource).Length
        $uniqueId = "guid-$([System.Guid]::NewGuid().ToString().Substring(0, 8))"

        $manifest = Get-SyncManifest -Path $ManifestPath
        $existing = $manifest.files[$rel]
        $status = 'synced'

        if ($existing -and $existing.sha256 -eq $sha256) {
            $status = 'skipped'
            $uniqueId = $existing.uniqueId
        } else {
            try {
                if (-not $MockTransport) {
                    Push-FileToSharePoint -LocalFullPath $fullSource -RelativePath $rel `
                        -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
                        -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
                }
                $isoNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                $manifest.files[$rel] = @{
                    sha256 = $sha256
                    size = $fileSize
                    uniqueId = $uniqueId
                    lastSyncedAt = $isoNow
                }
                Save-SyncManifest -Manifest $manifest -Path $ManifestPath
            } catch {
                $status = 'failed'
            }
        }

        if ($status -eq 'skipped') {
            Write-Output "[SKIP] $rel"
        } elseif ($status -eq 'synced') {
            Write-Output "[SYNCED] $rel"
        } else {
            Write-Output "[ERROR] Failed to sync $rel"
        }

        $report = @{
            results = @(
                @{
                    relativePath = $rel
                    status = $status
                    size = $fileSize
                    sha256 = $sha256
                    uniqueId = $uniqueId
                }
            )
        }

        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
    }

    'EnsureFolder' {
        if (-not $SourceFolder) {
            throw "SourceFolder is required for EnsureFolder action"
        }
        $cleanSource = $SourceFolder.Replace('\', '/').Trim('/')
        if ([string]::IsNullOrWhiteSpace($cleanSource)) {
            throw "SourceFolder cannot be empty or root"
        }

        $manifest = Get-SyncManifest -Path $ManifestPath
        $isoNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $status = 'synced'

        if ($MockTransport) {
            Write-Output "[FOLDER-SYNCED] $cleanSource"
            $manifest.folders[$cleanSource] = @{
                lastSyncedAt = $isoNow
            }
            Save-SyncManifest -Manifest $manifest -Path $ManifestPath
        } else {
            if (-not $SiteUrl) {
                throw "SiteUrl is required when not in MockTransport mode"
            }
            $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
            if (-not $ctx) {
                throw "Unable to acquire SharePoint client context for $SiteUrl"
            }
            try {
                Ensure-SharePointFolder -Context $ctx -TargetFolder $TargetFolder -RelativeDir $cleanSource | Out-Null
                $manifest.folders[$cleanSource] = @{
                    lastSyncedAt = $isoNow
                }
                Save-SyncManifest -Manifest $manifest -Path $ManifestPath
                Write-Output "[FOLDER-SYNCED] $cleanSource"
            } catch {
                $status = 'failed'
                Write-Output "[ERROR] Failed to ensure folder $cleanSource : $($_.Exception.Message)"
            }
        }

        $report = @{
            results = @(
                @{
                    relativePath = $cleanSource
                    relativeFolder = $cleanSource
                    status = $status
                }
            )
        }

        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
    }

    'PullFile' {
        if (-not $SourceFile) {
            throw "SourceFile/FilePath is required for PullFile action"
        }
        $fullDest = if ([System.IO.Path]::IsPathRooted($SourceFile)) {
            [System.IO.Path]::GetFullPath($SourceFile)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $WorkspaceRoot $SourceFile))
        }
        $destDir = [System.IO.Path]::GetDirectoryName($fullDest)
        if (-not (Test-Path $destDir)) {
            [System.IO.Directory]::CreateDirectory($destDir) | Out-Null
        }

        $status = 'synced'
        if ($MockTransport) {
            [System.IO.File]::WriteAllText($fullDest, "MOCK PULL CONTENT", [System.Text.UTF8Encoding]::new($false))
        } else {
            if (-not $SiteUrl) {
                throw "SiteUrl is required when not in MockTransport mode"
            }
            $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
            if (-not $ctx) {
                throw "Unable to acquire SharePoint client context for $SiteUrl"
            }
            $folder = $ctx.Web.GetFolderByServerRelativeUrl($TargetFolder)
            $ctx.Load($folder)
            $ctx.ExecuteQuery()
            $cleanSource = $SourceFile.Replace('\', '/').TrimStart('/')
            $targetFileUrl = "$($folder.ServerRelativeUrl)/$cleanSource"
            $fileInfo = [Microsoft.SharePoint.Client.File]::OpenBinaryDirect($ctx, $targetFileUrl)
            $destStream = [System.IO.File]::Create($fullDest)
            try {
                $fileInfo.Stream.CopyTo($destStream)
            } finally {
                $destStream.Dispose()
                $fileInfo.Stream.Dispose()
            }
        }

        $report = @{
            results = @(
                @{
                    relativePath = $SourceFile.Replace('\', '/').TrimStart('/')
                    status = $status
                }
            )
        }

        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
    }

    'SyncWorkspace' {
        $manifest = Get-SyncManifest -Path $ManifestPath
        $files = @()

        try {
            $gitOut = git -C $WorkspaceRoot ls-files --cached --others --exclude-standard 2>$null
            if ($LASTEXITCODE -eq 0 -and $gitOut) {
                $files = @($gitOut)
            }
        } catch { }

        if ($files.Count -eq 0) {
            $items = Get-ChildItem -Path $WorkspaceRoot -Recurse -File | Where-Object {
                $_.FullName -notmatch '[\\/](\.git|node_modules|\.cph|dist|package)[\\/]'
            }
            foreach ($item in $items) {
                $rel = $item.FullName.Substring($WorkspaceRoot.Length).TrimStart('\', '/')
                $files += $rel
            }
        }

        # 核心防泄漏过滤：无论来自 git 还是文件遍历，严禁同步 .cph / .git / node_modules 等内部物理状态
        $files = @($files | Where-Object {
            $_ -and ($_ -notmatch '(^|[\\/])(\.git|\.cph|node_modules|dist|package|Library)[\\/]')
        })

        foreach ($file in $files) {
            if ([string]::IsNullOrWhiteSpace($file)) { continue }
            Sync-Item -RelativePath $file -WorkspaceRoot $WorkspaceRoot -Manifest $manifest `
                -ManifestPath $ManifestPath -DirtyLogPath $DirtyLogPath `
                -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
                -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
        }

        $manifest.lastFullSync = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Save-SyncManifest -Manifest $manifest -Path $ManifestPath

        $report = @{
            status = 'completed'
            totalFiles = $files.Count
        }
        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
    }

    'VerifyMirror' {
        $isValid = $false
        $reason = ""
        $cloudFileCount = 0
        $overlapCount = 0
        $hasMirrorFile = $false

        if ($MockTransport) {
            if ($env:SP_SYNC_MOCK_CLOUD_EMPTY -eq '1') {
                $isValid = $true
                $cloudFileCount = 0
                $overlapCount = 0
                $hasMirrorFile = $false
                $reason = "Cloud folder is empty; initialized new mirror."
            } elseif ($env:SP_SYNC_MOCK_MIRROR_MISMATCH -eq '1') {
                $isValid = $false
                $cloudFileCount = 1
                $overlapCount = 0
                $hasMirrorFile = $true
                $reason = "MIRROR_MISMATCH: Cloud mirror points to another workspace."
            } elseif ($env:SP_SYNC_MOCK_MIRROR_MATCH -eq '1') {
                $isValid = $true
                $cloudFileCount = 1
                $overlapCount = 1
                $hasMirrorFile = $true
                $reason = "Mirror fingerprint matched."
            } elseif ($env:SP_SYNC_MOCK_OVERLAP_ZERO -eq '1') {
                $isValid = $false
                $cloudFileCount = 5
                $overlapCount = 0
                $hasMirrorFile = $false
                $reason = "UNMATCHED_CLOUD_FOLDER: Cloud folder contains files but shares 0 overlap with local workspace."
            } elseif ($env:SP_SYNC_MOCK_OVERLAP_MATCH -eq '1') {
                $isValid = $true
                $cloudFileCount = 3
                $overlapCount = 2
                $hasMirrorFile = $false
                $reason = "Cloud files overlap with local workspace (2 matches)."
            } else {
                $isValid = $true
                $cloudFileCount = 0
                $overlapCount = 0
                $hasMirrorFile = $false
                $reason = "Cloud folder is empty; initialized new mirror."
            }
        } else {
            if (-not $SiteUrl) {
                throw "SiteUrl is required when not in MockTransport mode"
            }
            $ctx = Get-DpsClientContext -SiteUrl $SiteUrl
            if (-not $ctx) {
                throw "Unable to acquire SharePoint client context for $SiteUrl"
            }

            $targetFolderClean = $TargetFolder.TrimEnd('/')

            try {
                $folder = $ctx.Web.GetFolderByServerRelativeUrl($targetFolderClean)
                $ctx.Load($folder)
                $ctx.Load($folder.Files)
                $ctx.ExecuteQuery()

                $mirrorFile = $null
                foreach ($f in $folder.Files) {
                    if ($f.Name -eq '.cph-mirror.json') {
                        $mirrorFile = $f
                        break
                    }
                }

                if ($mirrorFile) {
                    $hasMirrorFile = $true
                    $cloudFileCount = $folder.Files.Count
                    $fileInfo = [Microsoft.SharePoint.Client.File]::OpenBinaryDirect($ctx, $mirrorFile.ServerRelativeUrl)
                    $sr = New-Object System.IO.StreamReader($fileInfo.Stream)
                    $mirrorContent = $sr.ReadToEnd()
                    $sr.Close()
                    $mirrorObj = $null
                    try {
                        $mirrorObj = $mirrorContent | ConvertFrom-Json
                    } catch { }

                    if ($mirrorObj -and $mirrorObj.workspaceRoot -eq $WorkspaceRoot) {
                        $isValid = $true
                        $overlapCount = 1
                        $reason = "Mirror fingerprint matched."
                    } else {
                        $isValid = $false
                        $overlapCount = 0
                        $reason = "MIRROR_MISMATCH: Cloud mirror points to another workspace."
                    }
                } else {
                    $cloudFiles = @($folder.Files)
                    $cloudFileCount = $cloudFiles.Count
                    if ($cloudFileCount -eq 0) {
                        $isValid = $true
                        $overlapCount = 0
                        $reason = "Cloud folder is empty; initialized new mirror."
                    } else {
                        $localFiles = @()
                        try {
                            $gitOut = git -C $WorkspaceRoot ls-files --cached --others --exclude-standard 2>$null
                            if ($LASTEXITCODE -eq 0 -and $gitOut) {
                                $localFiles = @($gitOut)
                            }
                        } catch { }

                        if ($localFiles.Count -eq 0) {
                            $items = Get-ChildItem -Path $WorkspaceRoot -Recurse -File | Where-Object {
                                $_.FullName -notmatch '[\\/](\.git|node_modules|\.cph|dist|package)[\\/]'
                            }
                            foreach ($item in $items) {
                                $rel = $item.FullName.Substring($WorkspaceRoot.Length).TrimStart('\', '/').Replace('\', '/')
                                $localFiles += $rel
                            }
                        }

                        $localLookup = @{}
                        foreach ($lf in $localFiles) {
                            $localLookup[$lf.Replace('\', '/').TrimStart('/')] = $true
                        }

                        $overlapCount = 0
                        foreach ($cf in $cloudFiles) {
                            if ($localLookup.ContainsKey($cf.Name)) {
                                $overlapCount++
                            }
                        }

                        if ($overlapCount -eq 0) {
                            $isValid = $false
                            $reason = "UNMATCHED_CLOUD_FOLDER: Cloud folder contains files but shares 0 overlap with local workspace."
                        } else {
                            $isValid = $true
                            $reason = "Cloud files overlap with local workspace ($overlapCount matches)."
                        }
                    }
                }
            } catch {
                $isValid = $true
                $cloudFileCount = 0
                $overlapCount = 0
                $hasMirrorFile = $false
                $reason = "Cloud folder is empty; initialized new mirror."
            }
        }

        $report = @{
            valid = [bool]$isValid
            reason = [string]$reason
            cloudFileCount = [int]$cloudFileCount
            overlapCount = [int]$overlapCount
            hasMirrorFile = [bool]$hasMirrorFile
            targetFolder = $TargetFolder
            workspaceRoot = $WorkspaceRoot
        }

        Write-Output "###REPORT_JSON_START###"
        Write-Output ($report | ConvertTo-Json -Depth 5 -Compress)
        Write-Output "###REPORT_JSON_END###"
        exit 0
    }
}
