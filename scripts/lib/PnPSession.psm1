# shared/PnPSession.psm1
# DPS 认证层重构：三级 cookie 会话（PnP v1.12.0 cookie 认证，消除 UseWebLogin 脚本错误弹窗）
# - Tier 1: 磁盘缓存 ~/.dps-session.json
# - Tier 2: IE（WinINet）cookie 直读 CookieReader.GetCookie
# - Tier 3: 浏览器登录（反射 GetWebLoginClientContext，scriptErrorsSuppressed=$true）
# 铁律：PWSH5.1 兼容；含中文须 UTF-8 BOM

# ---- 强制 PnP V1（1.12.0）加载（2026-08-13 DebugMode 修复）----
# 背景：PnPSession 反射登录（BrowserHelper.GetWebLoginClientContext / CookieReader.GetCookie）
# 仅存在于 PnP 1.x；PWSH7 默认按 PSModulePath 加载 PnP 3.x（PS7-only，方法已移除，实测
# GetMethod 返回 null）→ dashboard（PS7 启动）DPS 全挂「You cannot call a method on a
# null-valued expression」。修复：显式探测 PS5.1 用户模块目录（OneDrive 重定向 + 默认
# Documents）下的 PnP 1.x psd1 并导入；找不到回退按名导入（PS5.1 正常路径首位，效果等同现状）。
# 注：不改 $env:PSModulePath（避免污染长驻进程/其他模块解析）。
function Get-PnpV1ModulePath {
    <#
    .SYNOPSIS
    探测 PnP 1.x（PS5.1 兼容）模块 psd1 路径。
    -ModuleBases：测试注入候选根目录（默认 = OneDrive 重定向 + 默认 Documents 的
    WindowsPowerShell\Modules\PnP.PowerShell）。
    #>
    param([string[]]$ModuleBases)
    $bases = @()
    if ($ModuleBases -and @($ModuleBases).Count -gt 0) {
        $bases = @($ModuleBases)
    } else {
        $dynamicBases = @(
            (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules\PnP.PowerShell')
        )
        # 动态探测可能存在的 OneDrive 重定向 Documents 目录
        $odDirs = Get-ChildItem -Path $env:USERPROFILE -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue
        foreach ($od in $odDirs) {
            $dynamicBases += (Join-Path $od.FullName 'Documents\WindowsPowerShell\Modules\PnP.PowerShell')
        }
        $bases = $dynamicBases
    }
    foreach ($base in $bases) {
        if (-not (Test-Path $base)) { continue }
        try {
            $dirs = @(Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^1\.\d+\.\d+(\.\d+)?$' } |
                Sort-Object { [version]$_.Name } -Descending)
            if ($dirs.Count -gt 0) {
                $psd1 = Join-Path $dirs[0].FullName 'PnP.PowerShell.psd1'
                if (Test-Path $psd1) { return $psd1 }
            }
        } catch { }
    }
    return $null
}

$script:PnpV1Path = Get-PnpV1ModulePath
if ($script:PnpV1Path) {
    Import-Module $script:PnpV1Path -ErrorAction Stop
} else {
    Import-Module PnP.PowerShell -ErrorAction Stop
}

$script:DpsContexts = @{}    # 多站点内存缓存

function Get-DpsSessionCacheFile {
    param([object]$Config)
    if ($Config -and $Config.SharePoint -and $Config.SharePoint.SessionCacheFile) { return [string]$Config.SharePoint.SessionCacheFile }
    $cphCache = Join-Path $env:USERPROFILE '.cph\pnp-session.json'
    if (Test-Path $cphCache) { return $cphCache }
    $legacyCache = Join-Path $env:USERPROFILE '.ltk-shipschedule-session.json'
    if (Test-Path $legacyCache) { return $legacyCache }
    return $cphCache
}

function Read-DpsSessionCache {
    param([string]$CacheFile)
    if (-not $CacheFile) { $CacheFile = Get-DpsSessionCacheFile }
    if (-not (Test-Path $CacheFile)) { return $null }
    try {
        $c = Get-Content $CacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($c -and $c.SiteUrl -and $c.Cookies -and @($c.Cookies).Count -gt 0) { return $c }
        return $null
    } catch { return $null }
}

function Write-DpsSessionCache {
    param(
        [Parameter(Mandatory)][string]$SiteUrl,
        [Parameter(Mandatory)][object]$Cookies,
        [string]$CacheFile
    )
    if (-not $CacheFile) { $CacheFile = Get-DpsSessionCacheFile }
    if (-not $Cookies -or @($Cookies).Count -eq 0) { throw '无可序列化 cookie' }
    $obj = @{ SiteUrl = $SiteUrl; CachedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); Cookies = @($Cookies) }
    $json = $obj | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($CacheFile, $json, [System.Text.UTF8Encoding]::new($false))
}

function Clear-DpsSessionCache {
    param([string]$CacheFile)
    if (-not $CacheFile) { $CacheFile = Get-DpsSessionCacheFile }
    # 用 .NET File.Delete 而非 Remove-Item：8.3 短名路径（如 C:\Users\GSC~1.VFU\...）下
    # Remove-Item 在 PWSH5.1 与 7 均抛 PSArgumentException（本机 $env:TEMP 即短名，实测）。
    if (Test-Path $CacheFile) { [System.IO.File]::Delete($CacheFile) }
}

function ConvertFrom-DpsCookieCollection {
    # CookieCollection -> 可序列化对象数组
    param([Parameter(Mandatory)][System.Net.CookieCollection]$Cookies)
    $list = @()
    foreach ($c in $Cookies) {
        $list += [PSCustomObject]@{ Name=$c.Name; Value=$c.Value; Domain=$c.Domain; Path=$c.Path; Expires=$c.Expires.ToString('o') }
    }
    return $list
}

function New-DpsCookieContainer {
    # 缓存对象 -> CookieContainer
    param([Parameter(Mandatory)][object]$Cache, [string]$SiteUrl)
    if (-not $SiteUrl) { $SiteUrl = $Cache.SiteUrl }
    $container = New-Object System.Net.CookieContainer
    $collection = New-Object System.Net.CookieCollection
    foreach ($ck in @($Cache.Cookies)) {
        $cookie = New-Object System.Net.Cookie($ck.Name, $ck.Value, $ck.Path, $ck.Domain)
        $exp = [datetime]::MinValue
        if ($ck.Expires -and [datetime]::TryParse([string]$ck.Expires, [ref]$exp)) { $cookie.Expires = $exp }
        $collection.Add($cookie)
    }
    $container.Add((New-Object Uri($SiteUrl)), $collection)
    return $container
}

function New-DpsCookieContext {
    # 复刻 GetWebLoginClientContext 的 cookie 认证 ClientContext 构造（设计 §5.3，已实测）
    param([Parameter(Mandatory)][string]$SiteUrl, [Parameter(Mandatory)][System.Net.CookieContainer]$CookieContainer)
    $ctx = New-Object Microsoft.SharePoint.Client.ClientContext($SiteUrl)
    $ctx.DisableReturnValueCache = $true
    # #4 挂起防护：CSOM ExecuteQuery 默认超时 ~100s，设为 30s 避免单请求长阻塞（并发后仍占一个 runspace）
    $ctx.RequestTimeout = 30000
    $cc = $CookieContainer
    $handler = { param($s, $e) $e.WebRequestExecutor.WebRequest.CookieContainer = $cc }.GetNewClosure()
    $ctx.add_ExecutingWebRequest($handler)
    $settings = New-Object PnP.Framework.Utilities.Context.ClientContextSettings
    $settings.Type = [PnP.Framework.Utilities.Context.ClientContextType]::Cookie
    $settings.AuthenticationManager = New-Object PnP.Framework.AuthenticationManager
    $settings.AuthenticationManager.CookieContainer = $CookieContainer
    $settings.SiteUrl = $SiteUrl
    [Microsoft.SharePoint.Client.InternalClientContextExtensions]::AddContextSettings($ctx, $settings)
    return $ctx
}

function Test-DpsContext {
    # 探测上下文有效性（Web.Title 加载）
    param([Parameter(Mandatory)][object]$Context)
    try {
        # #4 挂起防护：任何路径传入的上下文统一设 30s 超时（防 ExecuteQuery 长阻塞）
        if ($Context.PSObject.Properties['RequestTimeout']) { $Context.RequestTimeout = 30000 }
        $Context.Load($Context.Web)
        $Context.ExecuteQuery()
        return $true
    } catch { return $false }
}

function ConvertFrom-DpsCookieString {
    # 从 CookieReader 返回的 cookie 字符串解析 FedAuth/rtFa（Tier 2，纯函数可测）
    param([Parameter(Mandatory)][string]$CookieString, [Parameter(Mandatory)][string]$SiteUrl)
    if ($CookieString -notmatch 'FedAuth') { return $null }
    $container = New-Object System.Net.CookieContainer
    $collection = New-Object System.Net.CookieCollection
    $hostName = ([uri]$SiteUrl).Host
    foreach ($part in ($CookieString -split ';')) {
        $p = $part.Trim()
        if ($p -match '^(FedAuth|rtFa)=') {
            $eq = $p.IndexOf('=')
            $name = $p.Substring(0, $eq)
            $value = $p.Substring($eq + 1)
            $collection.Add((New-Object System.Net.Cookie($name, $value, '/', $hostName)))
        }
    }
    $container.Add((New-Object Uri($SiteUrl)), $collection)
    return $container
}

function Get-DpsIeCookieContainer {
    # Tier 2：从 IE（WinINet）cookie 缓存读取会话 cookie（CookieReader 为 internal 类，须反射）
    param([Parameter(Mandatory)][string]$SiteUrl)
    $asm = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetType('PnP.PowerShell.Commands.Utilities.Auth.CookieReader') } | Select-Object -First 1
    if (-not $asm) { return $null }
    $m = $asm.GetType('PnP.PowerShell.Commands.Utilities.Auth.CookieReader').GetMethod('GetCookie')
    $cookieString = $m.Invoke($null, @($SiteUrl))
    if ([string]::IsNullOrEmpty($cookieString)) { return $null }
    return ConvertFrom-DpsCookieString -CookieString $cookieString -SiteUrl $SiteUrl
}

function Get-DpsContextCookies {
    # 从 ClientContext 提取可序列化 cookie 列表
    param([Parameter(Mandatory)][object]$Context, [Parameter(Mandatory)][string]$SiteUrl)
    $settings = [Microsoft.SharePoint.Client.InternalClientContextExtensions]::GetContextSettings($Context)
    if ($null -eq $settings -or $null -eq $settings.AuthenticationManager -or $null -eq $settings.AuthenticationManager.CookieContainer) { return @() }
    $cookies = $settings.AuthenticationManager.CookieContainer.GetCookies((New-Object Uri($SiteUrl)))
    return ConvertFrom-DpsCookieCollection -Cookies $cookies
}

function Invoke-DpsBrowserLogin {
    # Tier 3：反射调用 PnP BrowserHelper.GetWebLoginClientContext（scriptErrorsSuppressed=$true，唯一反射点）
    param([Parameter(Mandatory)][string]$SiteUrl)
    $asm = $null
    try {
        $asm = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetType('PnP.PowerShell.Commands.Utilities.BrowserHelper') } | Select-Object -First 1
    } catch { $asm = $null }
    if (-not $asm) {
        $module = Get-Module PnP.PowerShell
        if ($module) {
            foreach ($sub in @('Framework', 'Core')) {
                $p = Join-Path (Join-Path $module.ModuleBase $sub) 'PnP.PowerShell.dll'
                if (Test-Path $p) { try { $asm = [System.Reflection.Assembly]::LoadFrom($p); break } catch { } }
            }
        }
    }
    if (-not $asm) { throw '未找到 PnP.PowerShell 程序集（BrowserHelper）' }
    $m = $asm.GetType('PnP.PowerShell.Commands.Utilities.BrowserHelper').GetMethod('GetWebLoginClientContext', [System.Reflection.BindingFlags]'NonPublic,Static')
    $ctx = $m.Invoke($null, @($SiteUrl, $false, $true, $null, [PnP.Framework.AzureEnvironment]::Production))
    if ($null -eq $ctx) { throw '登录未完成：浏览器登录窗口被关闭或登录失败' }
    # #4 挂起防护：登录返回的上下文同样设 30s 超时。
    # 注：此处不做硬超时终止——登录为交互式（用户需在可见窗口完成），且跨 runspace 返回的
    # ClientContext 不可直接用于 CSOM（PowerShell 序列化），硬超时无法保留可用上下文；
    # 服务器并发化已保证登录挂起只占自身请求的 runspace，不再阻塞其他选项卡。
    if ($ctx.PSObject.Properties['RequestTimeout']) { $ctx.RequestTimeout = 30000 }
    return $ctx
}

function Get-DpsClientContext {
    # 三级会话获取（LTK 版：Config 对象传入，无 DPS config 依赖）
    param([psobject]$Config, [string]$SiteUrl)
    $sp = $Config.SharePoint
    if (-not $SiteUrl) { $SiteUrl = $sp.SiteUrl }
    $cacheFile = Get-DpsSessionCacheFile -Config $Config
    # 0. 内存命中（按站点分槽；web 长驻复用）
    if ($script:DpsContexts.ContainsKey($SiteUrl)) {
        if (Test-DpsContext -Context $script:DpsContexts[$SiteUrl]) { return $script:DpsContexts[$SiteUrl] }
        $script:DpsContexts.Remove($SiteUrl)
    }
    # 1. Tier 1 磁盘缓存（损坏/语义非法缓存 → 降级 Tier 2，不中断）
    $cache = Read-DpsSessionCache -CacheFile $cacheFile
    if ($cache) {
        try {
            $container = New-DpsCookieContainer -Cache $cache -SiteUrl $SiteUrl
            $ctx = New-DpsCookieContext -SiteUrl $SiteUrl -CookieContainer $container
            if (Test-DpsContext -Context $ctx) { $script:DpsContexts[$SiteUrl] = $ctx; return $ctx }
        } catch { $container = $null }
    }
    # 2. Tier 2 IE cookie 直读（无窗口；抛错降级 Tier 3）
    try {
        $ieContainer = Get-DpsIeCookieContainer -SiteUrl $SiteUrl
        if ($ieContainer) {
            $ctx2 = New-DpsCookieContext -SiteUrl $SiteUrl -CookieContainer $ieContainer
            if (Test-DpsContext -Context $ctx2) {
                Write-DpsSessionCache -SiteUrl $SiteUrl -Cookies (Get-DpsContextCookies -Context $ctx2 -SiteUrl $SiteUrl) -CacheFile $cacheFile
                $script:DpsContexts[$SiteUrl] = $ctx2
                return $ctx2
            }
        }
    } catch { }
    # 3. Tier 3 浏览器登录（唯一弹窗时刻）
    Clear-DpsSessionCache -CacheFile $cacheFile
    $loginCtx = Invoke-DpsBrowserLogin -SiteUrl $SiteUrl
    try {
        Write-DpsSessionCache -SiteUrl $SiteUrl -Cookies (Get-DpsContextCookies -Context $loginCtx -SiteUrl $SiteUrl) -CacheFile $cacheFile
    } catch {
        Write-Warning "DPS: cookie 缓存写入失败（本次会话不受影响）: $($_.Exception.Message)"
    }
    $script:DpsContexts[$SiteUrl] = $loginCtx
    return $loginCtx
}

function Get-DpsConnection {
    # 兼容包装
    param([psobject]$Config, [string]$SiteUrl)
    $null = Get-DpsClientContext -Config $Config -SiteUrl $SiteUrl
    return $true
}

function Disconnect-DpsSharePoint {
    $script:DpsContexts = @{}
}

Export-ModuleMember -Function Get-DpsClientContext, Get-DpsConnection, Disconnect-DpsSharePoint, Get-PnpV1ModulePath
