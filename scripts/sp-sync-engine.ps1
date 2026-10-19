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
    [Parameter(Mandatory = $true)][ValidateSet('SyncWorkspace', 'SyncSingleFile')][string]$Action,
    [string]$SiteUrl,
    [string]$TargetFolder = '/Shared Documents/workspace-mirror',
    [string]$SourceFile,
    [string]$WorkspaceRoot,
    [string]$ManifestPath,
    [string]$DirtyLogPath,
    [switch]$AllowLegacyFallback,
    [switch]$MockTransport
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
    $lastFullSync = $null
    $version = 1

    if (Test-Path $Path) {
        try {
            $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
            $parsed = $raw | ConvertFrom-Json
            if ($parsed) {
                if ($parsed.version) { $version = [int]$parsed.version }
                if ($parsed.lastFullSync) { $lastFullSync = $parsed.lastFullSync }
                if ($parsed.files) {
                    $parsed.files.PSObject.Properties | ForEach-Object {
                        $filesMap[$_.Name] = @{
                            sha256 = [string]$_.Value.sha256
                            lastSyncedAt = [string]$_.Value.lastSyncedAt
                        }
                    }
                }
            }
        } catch {
            Write-Warning "Manifest parse warning: $($_.Exception.Message)"
        }
    }

    return @{
        version = $version
        lastFullSync = $lastFullSync
        files = $filesMap
    }
}

function Save-SyncManifest {
    param([hashtable]$Manifest, [string]$Path)
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if (-not (Test-Path $dir)) {
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
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

# 7. 文件推送到 SharePoint (带 3 次重试与 Mock 支持)
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
                $relDir = [System.IO.Path]::GetDirectoryName($RelativePath).Replace('\', '/')
                $remoteFolder = if ([string]::IsNullOrEmpty($relDir)) { $TargetFolder } else { "$TargetFolder/$relDir" }
                Add-PnPFile -Path $LocalFullPath -Folder $remoteFolder -Values @{} -ErrorAction Stop | Out-Null
                return $true
            }
        } catch {
            $lastError = $_.Exception.Message
            Start-Sleep -Milliseconds (100 * $attempt)
        }
    }
    throw $lastError
}

# 8. 单个文件增量判定与同步
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
    if ($existing -and $existing.sha256 -eq $sha256) {
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

        $manifest = Get-SyncManifest -Path $ManifestPath
        Sync-Item -RelativePath $rel -WorkspaceRoot $WorkspaceRoot -Manifest $manifest `
            -ManifestPath $ManifestPath -DirtyLogPath $DirtyLogPath `
            -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
            -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
    }

    'SyncWorkspace' {
        $manifest = Get-SyncManifest -Path $ManifestPath
        $files = @()

        # 优先使用 git ls-files (跟踪文件 + 未跟踪文件，排除 .gitignore)
        try {
            $gitOut = git -C $WorkspaceRoot ls-files --cached --others --exclude-standard 2>$null
            if ($LASTEXITCODE -eq 0 -and $gitOut) {
                $files = @($gitOut)
            }
        } catch { }

        # 回退扫描本地目录（排除系统和构建目录）
        if ($files.Count -eq 0) {
            $items = Get-ChildItem -Path $WorkspaceRoot -Recurse -File | Where-Object {
                $_.FullName -notmatch '[\\/](\.git|node_modules|\.cph|dist|package)[\\/]'
            }
            foreach ($item in $items) {
                $rel = $item.FullName.Substring($WorkspaceRoot.Length).TrimStart('\', '/')
                $files += $rel
            }
        }

        foreach ($file in $files) {
            if ([string]::IsNullOrWhiteSpace($file)) { continue }
            Sync-Item -RelativePath $file -WorkspaceRoot $WorkspaceRoot -Manifest $manifest `
                -ManifestPath $ManifestPath -DirtyLogPath $DirtyLogPath `
                -SiteUrl $SiteUrl -TargetFolder $TargetFolder `
                -MockTransport:$MockTransport -AllowLegacyFallback:$AllowLegacyFallback
        }

        $manifest.lastFullSync = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Save-SyncManifest -Manifest $manifest -Path $ManifestPath
    }
}
