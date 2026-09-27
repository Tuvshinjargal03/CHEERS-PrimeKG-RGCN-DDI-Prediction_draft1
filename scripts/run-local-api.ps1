$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'

if (-not (Test-Path -LiteralPath $envFile)) {
    throw 'Project-root .env.local was not found.'
}

$keyLine = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match '^\s*GEMINI_API_KEY\s*=' } |
    Select-Object -Last 1

if (-not $keyLine) {
    throw 'GEMINI_API_KEY is missing from .env.local.'
}

$keyValue = ($keyLine -split '=', 2)[1].Trim()
if (($keyValue.StartsWith('"') -and $keyValue.EndsWith('"')) -or
    ($keyValue.StartsWith("'") -and $keyValue.EndsWith("'"))) {
    $keyValue = $keyValue.Substring(1, $keyValue.Length - 2)
}
if (-not $keyValue) {
    throw 'GEMINI_API_KEY is empty in .env.local.'
}

$env:GEMINI_API_KEY = $keyValue
Set-Location -LiteralPath $projectRoot
python -m uvicorn api.main:app --reload
