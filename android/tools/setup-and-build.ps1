# Instala o mínimo para compilar o app JARVIS (JDK 17, Android SDK cmdline-tools, Gradle) e gera o APK.
# Tudo fica em %LOCALAPPDATA%\jarvis-android-toolchain (não mexe em PATH global nem em Android Studio).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path $env:LOCALAPPDATA 'jarvis-android-toolchain'
$sdk = Join-Path $root 'sdk'
$project = Split-Path $PSScriptRoot -Parent
New-Item -ItemType Directory -Force $root, $sdk | Out-Null
function Step($m) { Write-Output "[$(Get-Date -Format HH:mm:ss)] $m" }

# 1) JDK 17 (Microsoft Build of OpenJDK, via winget)
$jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) {
  Step 'Instalando JDK 17 (winget)...'
  winget install --id Microsoft.OpenJDK.17 -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
  $jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' | Select-Object -First 1
}
$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$($jdk.FullName)\bin;$env:PATH"
Step "JDK: $($jdk.FullName)"

# 2) Android SDK command-line tools (zip oficial do Google)
$cm = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $cm)) {
  Step 'Baixando Android command-line tools...'
  $zip = Join-Path $root 'cmdline-tools.zip'
  Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile $zip
  Expand-Archive $zip (Join-Path $root 'ct') -Force
  New-Item -ItemType Directory -Force (Join-Path $sdk 'cmdline-tools') | Out-Null
  Move-Item (Join-Path $root 'ct\cmdline-tools') (Join-Path $sdk 'cmdline-tools\latest') -Force
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
if (-not (Test-Path (Join-Path $sdk 'licenses\android-sdk-license'))) {
  # As licenças do Google são SUAS para aceitar: o sdkmanager mostra cada uma e você responde "y".
  Step 'Leia e aceite as licenças do Android SDK (digite y em cada uma):'
  & $cm --sdk_root=$sdk --licenses
  if (-not (Test-Path (Join-Path $sdk 'licenses\android-sdk-license'))) { throw 'Licenças não aceitas: sem elas o Google não libera o SDK.' }
}
Step 'Instalando platform 35 + build-tools 35 (≈ 600 MB)...'
& $cm --sdk_root=$sdk 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'
if (-not (Test-Path (Join-Path $sdk 'platforms\android-35'))) { throw 'platform android-35 não instalou.' }

# 3) Gradle (distribuição oficial)
$gradle = Join-Path $root 'gradle-8.11.1\bin\gradle.bat'
if (-not (Test-Path $gradle)) {
  Step 'Baixando Gradle 8.11.1...'
  $gz = Join-Path $root 'gradle.zip'
  Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-8.11.1-bin.zip' -OutFile $gz
  Expand-Archive $gz $root -Force
}

# 4) Build
Set-Content -Path (Join-Path $project 'local.properties') -Value ("sdk.dir=" + ($sdk -replace '\\', '/')) -Encoding ascii
Step 'Compilando o APK (assembleRelease)...'
Push-Location $project
try {
  & $gradle --no-daemon -q wrapper --gradle-version 8.11.1
  & $gradle --no-daemon assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "gradle saiu com $LASTEXITCODE" }
} finally { Pop-Location }
$apk = Get-ChildItem (Join-Path $project 'app\build\outputs\apk\release') -Filter '*.apk' | Select-Object -First 1
Step "APK_OK $($apk.FullName) $([math]::Round($apk.Length/1MB,1)) MB"

# 5) Zip na área de trabalho, para mandar ao celular (ex.: pelo app do Claude ou Drive)
$desk = [Environment]::GetFolderPath('Desktop')
$zip = Join-Path $desk 'JARVIS-app-android.zip'
$named = Join-Path $env:TEMP 'JARVIS.apk'
Copy-Item $apk.FullName $named -Force
Compress-Archive -Path $named -DestinationPath $zip -Force
Step "ZIP_OK $zip"
