# Liga o JARVIS remoto neste PC: só pelo Tailscale (IP 100.x), sempre com token.
# Pré-requisito: Tailscale instalado e logado (o dono faz). Rodar: powershell -File tools\ligar-remoto.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { throw 'Tailscale não instalado. Rode primeiro: winget install --id Tailscale.Tailscale' }

$ip = (& $ts ip -4 | Select-Object -First 1).Trim()
if ($ip -notmatch '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$') { throw "Tailscale sem IP 100.x ('$ip'). Faça login: tailscale up" }
Write-Host "IP do PC no Tailscale: $ip"

# Liga o remoto na config (node, para não estragar o JSON)
$cfg = Join-Path $root 'jarvis.config.json'
node -e "const fs=require('fs');const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,'utf8'));c.remote={enabled:true,host:process.argv[2],tokenFile:'data/remote-token.txt'};fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')" $cfg $ip

# Reinicia só o JARVIS (a porta 20150); o launcher religa o que estiver parado
$pids = Get-NetTCPConnection -LocalPort 20150 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) { Stop-Process -Id $p -Force }
Start-Sleep -Seconds 2
Start-Process (Join-Path $root 'launcher\dist\JarvisLauncher.exe') -ArgumentList '--autostart' -WindowStyle Hidden
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  $ok = [bool](Get-NetTCPConnection -LocalAddress $ip -LocalPort 20150 -State Listen -ErrorAction SilentlyContinue)
}
if (-not $ok) { throw "JARVIS não subiu em $ip`:20150. Veja o log em $root\data" }

# Teste: sem token tem que dar 401; com token, 200. O token nunca é impresso.
$tokenFile = Join-Path $root 'data\remote-token.txt'
$token = [IO.File]::ReadAllText($tokenFile).Trim()
$sem = try { (Invoke-WebRequest "http://$ip`:20150/" -UseBasicParsing).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
$com = try { (Invoke-WebRequest "http://$ip`:20150/" -UseBasicParsing -Headers @{ Authorization = "Bearer $token" }).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
Write-Host "Sem token: $sem (esperado 401) | Com token: $com (esperado 200)"
$lan = Get-NetTCPConnection -LocalPort 20150 -State Listen | Where-Object { $_.LocalAddress -notin @('127.0.0.1', $ip) }
if ($lan) { Write-Warning "ATENÇÃO: porta 20150 aberta fora do Tailscale: $($lan.LocalAddress -join ', ')" } else { Write-Host 'Porta 20150 só em 127.0.0.1 e no IP do Tailscale. OK.' }
# Firewall: o Tailscale é rede "Privada"; o celular só entra se houver regra de entrada liberando a 20150 nesse perfil.
$fw = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.Profile -match 'Private|Any' } |
  Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -contains '20150' -or ($_ | Get-NetFirewallApplicationFilter).Program -match 'nodejs\\node.exe' }
if (-not $fw) { Write-Warning 'Firewall: nenhuma regra libera a porta 20150 na rede Privada (Tailscale). O celular vai ficar sem resposta. Veja 60-Runbooks/JARVIS no celular.' }
$pub = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match 'nodejs\\node.exe' } | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' -and $_.Profile -match 'Public|Any' }
if ($pub) { Write-Warning 'Firewall: o Node está liberado em rede PÚBLICA (Wi-Fi). Desligue essa regra.' }

Write-Host ''
Write-Host "No celular (com o app Tailscale logado na MESMA conta):"
Write-Host "  Endereço: http://$ip`:20150"
Write-Host "  Token: abra o arquivo $tokenFile (não mande o token por chat nem print)"
