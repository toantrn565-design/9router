$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $projectRoot
$Host.UI.RawUI.WindowTitle = 'Javis 9Router - 20128'
& node.exe (Join-Path $projectRoot 'custom-server.js') --port 20128 --hostname 127.0.0.1
Write-Host '9Router da dung. Giu cua so nay mo trong khi dung Router Board.'
