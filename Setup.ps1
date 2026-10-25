$ErrorActionPreference = 'Stop'
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path -LiteralPath $envPath) { throw '.env already exists. Edit it directly; setup will not replace credentials.' }
function New-LocalToken {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$content = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Raw
$content = $content.Replace('replace-with-n8n-service-token', (New-LocalToken))
Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
Write-Output 'Created .env with a random n8n service token. The local demo opens without a workspace token. Do not share or commit .env.'
