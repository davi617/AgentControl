# Compila o app Android e publica para o celular se atualizar sozinho (o JARVIS serve em /api/app/*).
# Rodar: powershell -ExecutionPolicy Bypass -File tools\publicar-app.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# Versão sempre maior: minutos desde 2026-01-01 (cabe em int até ~6000 anos).
$code = [int](((Get-Date).ToUniversalTime() - [datetime]'2026-01-01').TotalMinutes)
$name = "1.1.$code"

Push-Location (Join-Path $root 'android')
try {
  & .\gradlew.bat assembleRelease --console=plain -q "-PjarvisVersionCode=$code" "-PjarvisVersionName=$name"
  if ($LASTEXITCODE -ne 0) { throw "gradle falhou ($LASTEXITCODE)" }
} finally { Pop-Location }

$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
$dir = Join-Path $root 'data\app'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item $apk (Join-Path $dir 'jarvis.apk') -Force
$sha = (Get-FileHash (Join-Path $dir 'jarvis.apk') -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item (Join-Path $dir 'jarvis.apk')).Length
@{ versionCode = $code; versionName = $name; sha256 = $sha; size = $size } | ConvertTo-Json | Set-Content (Join-Path $dir 'version.json') -Encoding ascii
Write-Host "Publicado $name ($([math]::Round($size/1MB,1)) MB). O app no celular mostra 'Atualizar' na próxima conexão."
