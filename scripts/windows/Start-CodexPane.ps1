[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._/@:\[\]-]{1,200}$')][string]$Model,
    [Parameter(Mandatory)][ValidatePattern('^http://127\.0\.0\.1:[0-9]+/v1$')][string]$BaseUrl,
    [Parameter(Mandatory)][string]$Folder
)
$ErrorActionPreference = 'Stop'
try {
    if (-not $env:JAVIS_ROUTER_API_KEY) { throw 'Thieu API key cua router. Mo lai Router Board.' }
    if (-not (Get-Command codex.cmd -ErrorAction SilentlyContinue)) { throw 'Chua cai Codex CLI. Chay setup-router-board.cmd.' }
    Set-Location -LiteralPath $Folder
    $Host.UI.RawUI.WindowTitle = "Router Board - $Model"
    # Per-invocation overrides; never modify the user's global config.toml.
    $codexArguments = @(
        '-m', $Model,
        '-c', 'model_provider=javis_router',
        '-c', 'model_providers.javis_router.name=JavisRouter',
        '-c', "model_providers.javis_router.base_url=$BaseUrl",
        '-c', 'model_providers.javis_router.wire_api=responses',
        '-c', 'model_providers.javis_router.env_key=JAVIS_ROUTER_API_KEY',
        '-c', 'model_providers.javis_router.requires_openai_auth=false',
        '-c', 'web_search=disabled'
    )
    & codex.cmd @codexArguments
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }
