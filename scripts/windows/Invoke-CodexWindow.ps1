[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Open', 'Check', 'Close')][string]$Action,
    [ValidatePattern('^[A-Za-z0-9._/@:\[\]-]{1,200}$')][string]$Model,
    [ValidatePattern('^http://127\.0\.0\.1:[0-9]+/v1$')][string]$BaseUrl,
    [string]$Folder,
    [int]$ProcessId,
    [string]$StartedTicks
)
$ErrorActionPreference = 'Stop'
function Quote-PsLiteral([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
try {
    if ($Action -eq 'Open') {
        if (-not $Model -or -not $BaseUrl -or -not $Folder -or -not $env:JAVIS_ROUTER_API_KEY) { throw 'Missing window arguments.' }
        $starter = Join-Path $PSScriptRoot 'Start-CodexPane.ps1'
        $command = '& ' + (Quote-PsLiteral $starter) + ' -Model ' + (Quote-PsLiteral $Model) + ' -BaseUrl ' + (Quote-PsLiteral $BaseUrl) + ' -Folder ' + (Quote-PsLiteral $Folder)
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        # No redirects: Start-Process opens an independent console with real stdio.
        $ownedProcess = Start-Process -FilePath $shell -ArgumentList @('-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -WorkingDirectory $Folder -PassThru
        @{ pid = $ownedProcess.Id; started = $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress
        exit 0
    }
    if ($ProcessId -le 0 -or $StartedTicks -notmatch '^\d+$') { throw 'Invalid process identity.' }
    $ownedProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $isOwned = $null -ne $ownedProcess -and $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString() -eq $StartedTicks
    if ($Action -eq 'Close' -and $isOwned) {
        & taskkill.exe /PID $ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            $remaining = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
            if ($null -ne $remaining -and $remaining.StartTime.ToUniversalTime().Ticks.ToString() -eq $StartedTicks) { throw 'Cannot close window.' }
        }
        $isOwned = $false
    }
    @{ running = $isOwned } | ConvertTo-Json -Compress
} catch {
    # Do not echo arguments or inherited environment from the credential-bearing helper.
    [Console]::Error.WriteLine('Cannot open/check/close the owned Codex window.')
    exit 1
}
