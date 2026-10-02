# Compila o app do PC (Agent Control) para Windows: desktop\dist\win-x64\AgentControl.exe
#   powershell -ExecutionPolicy Bypass -File tools\publicar-pc.ps1
# Precisa do .NET 8 SDK (https://dot.net). Para Linux/macOS use: bash tools/instalar.sh
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo 'desktop\dist\win-x64'
Get-Process AgentControl -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet publish (Join-Path $repo 'desktop\AgentControl\AgentControl.csproj') -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=none -o $dist
if ($LASTEXITCODE -ne 0) { throw 'O build falhou.' }
Copy-Item (Join-Path $repo 'desktop\AgentControl\Assets\agentc.ico') (Join-Path $dist 'agentc.ico') -Force
Write-Host "Pronto: $dist\AgentControl.exe" -ForegroundColor Green
