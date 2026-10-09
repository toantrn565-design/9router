[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
try {
    Set-Location -LiteralPath $projectRoot
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Cai Node.js LTS tu https://nodejs.org, sau do chay setup-router-board.cmd lai.'
    }
    $nodeVersion = [version]((& node.exe -p 'process.versions.node').Trim())
    if ($nodeVersion -lt [version]'20.9.0') { throw 'Can Node.js 20.9+; nen dung Node.js LTS moi.' }
    Write-Host 'Cai thu vien 9Router...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install that bai.' }
    Write-Host 'Build 9Router...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build that bai. Xem loi ben tren.' }
    if (-not (Get-Command codex.cmd -ErrorAction SilentlyContinue)) {
        Write-Host 'Cai Codex CLI...'
        & npm.cmd install -g '@openai/codex@latest'
        if ($LASTEXITCODE -ne 0) { throw 'Cai Codex that bai. Thu: npm.cmd install -g @openai/codex@latest' }
    }
    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktopPath 'Javis Router Board.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $starter = Join-Path $PSScriptRoot 'Start-RouterBoard.ps1'
    $shortcut.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $starter + '"'
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'Cua so Codex, model va cong ket noi rieng qua 9Router'
    $shortcut.Save()
    Write-Host 'Da tao shortcut Javis Router Board tren Desktop. Giu nguyen thu muc repo nay.' -ForegroundColor Green
    & $starter
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Enter de dong' | Out-Null
    exit 1
}
