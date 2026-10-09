[CmdletBinding()]
param([switch]$ResetKey)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$boardData = Join-Path $env:LOCALAPPDATA 'Javis9Router'
$keyFile = Join-Path $boardData 'board.api-key.xml'
$passwordFile = Join-Path $boardData 'dashboard.password.xml'
$modeFile = Join-Path $boardData 'router.mode.txt'
New-Item -ItemType Directory -Path $boardData -Force | Out-Null

function Test-RouterReady {
    try {
        $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:20128/v1/models' -TimeoutSec 2
        return $true
    } catch {
        return ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -in @(401, 403))
    }
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Can Node.js 20.9+ de chay Router Board.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.next/BUILD_ID'))) { throw 'Chua build 9Router. Chay setup-router-board.cmd truoc.' }
    if (Test-NetConnection -ComputerName 127.0.0.1 -Port 20129 -InformationLevel Quiet -WarningAction SilentlyContinue) {
        Write-Host 'Cong 20129 dang duoc dung. Neu Router Board da mo, truy cap http://127.0.0.1:20129.'
        Read-Host 'Enter de dong' | Out-Null
        exit 0
    }
    $env:DATA_DIR = Join-Path $boardData 'data'
    $routerMode = if (Test-Path -LiteralPath $modeFile) { (Get-Content -LiteralPath $modeFile -Raw).Trim() } else { '' }
    if ($routerMode -notin @('', 'owned', 'external')) { throw 'File router.mode.txt khong hop le.' }
    $routerReady = Test-RouterReady
    if ($routerReady -and -not $routerMode) {
        # Keep a previously installed router's accounts/key bound to that router.
        'external' | Set-Content -LiteralPath $modeFile -Encoding ASCII
        $routerMode = 'external'
    }
    if (-not $routerReady) {
        if ($routerMode -eq 'external') {
            throw 'Board dang dung router da cai san. Hay khoi dong lai router cu tai cong 20128, roi mo board lai. Khong tu chuyen sang du lieu moi.'
        }
        if (Test-NetConnection -ComputerName 127.0.0.1 -Port 20128 -InformationLevel Quiet -WarningAction SilentlyContinue) {
            throw 'Cong 20128 bi chiem nhung router khong san sang. Dong ung dung dang dung cong nay truoc.'
        }
        if (-not (Test-Path -LiteralPath $passwordFile)) {
            $password = Read-Host 'Dat mat khau khoi tao dashboard 9Router' -AsSecureString
            if ($password.Length -eq 0) { throw 'Mat khau dashboard khong duoc de trong.' }
            $password | Export-Clixml -LiteralPath $passwordFile
        }
        # INITIAL_PASSWORD is not persisted by 9Router. Reload it for every owned launch.
        # A password subsequently set in the dashboard takes precedence over this fallback.
        $savedPassword = Import-Clixml -LiteralPath $passwordFile
        if ($savedPassword -isnot [Security.SecureString]) { throw 'File mat khau khoi tao khong hop le.' }
        $env:INITIAL_PASSWORD = [System.Net.NetworkCredential]::new('', $savedPassword).Password
        $routerStarter = Join-Path $PSScriptRoot 'Start-RouterServer.ps1'
        $routerEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& '" + $routerStarter.Replace("'", "''") + "'"))
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $routerEncoded) | Out-Null
        Remove-Item Env:INITIAL_PASSWORD -ErrorAction SilentlyContinue
        $ready = $false
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            if (Test-RouterReady) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw 'Router chua san sang. Xem loi trong cua so 9Router.' }
        'owned' | Set-Content -LiteralPath $modeFile -Encoding ASCII
    }
    if ($ResetKey -or -not (Test-Path -LiteralPath $keyFile)) {
        Start-Process 'http://127.0.0.1:20128/dashboard'
        Write-Host 'Trong 9Router: Providers -> Codex -> Add Connection (tung tai khoan).'
        Write-Host 'Sau do: Endpoint -> API Keys -> Create Key. Bat Require API key.'
        $secureKey = Read-Host 'Dan API key cua 9Router (chi nhap lan dau)' -AsSecureString
        if ($secureKey.Length -eq 0) { throw 'API key khong duoc de trong.' }
        # On Windows SecureString is encrypted with current-user DPAPI.
        $secureKey | Export-Clixml -LiteralPath $keyFile
    }
    $savedKey = Import-Clixml -LiteralPath $keyFile
    if ($savedKey -isnot [Security.SecureString]) { throw 'File key khong hop le. Mo voi -ResetKey.' }
    $env:JAVIS_ROUTER_API_KEY = [System.Net.NetworkCredential]::new('', $savedKey).Password
    $env:JAVIS_ROUTER_URL = 'http://127.0.0.1:20128'
    $env:JAVIS_BOARD_PORT = '20129'
    $env:JAVIS_FIRST_WINDOW_PORT = '20130'
    Set-Location -LiteralPath $projectRoot
    Write-Host 'Router Board: http://127.0.0.1:20129. Giu cua so nay mo khi lam viec.'
    & node.exe (Join-Path $projectRoot 'scripts/router-board/server.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Router Board khong khoi dong duoc. Xem thong bao ben tren.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Enter de dong' | Out-Null
} finally {
    Remove-Item Env:JAVIS_ROUTER_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:INITIAL_PASSWORD -ErrorAction SilentlyContinue
}
