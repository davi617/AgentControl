# Liga os loops dos agentes em segundo plano (sem janela). Seguro rodar de novo: cada loop tem trava
# própria (mutex AgentLoop-<agente>) e o segundo sai sozinho. Chamado no logon pelo atalho em shell:startup.
# 2026-09-28: depois de reiniciar o PC ninguém religava os loops e os agentes ficaram 2 dias parados.
# 2026-10-01 (Dono: "coloque todos os agentes"): Codex e Droid entram também. O Codex usa launchers\codex-loop.cmd
# ("codex exec", sem tela interativa); o codex.cmd normal continua abrindo a janela do Codex.
# -Agentes: lista escolhida no Agent Control (Ajustes > Seu time). Sem ela, liga os 7 de sempre.
param([string]$Agentes = 'claude,codex,droid,hermes,openclaw,opencode,qwen')
$root = Join-Path $env:USERPROFILE '.config\dw-agents'
$loop = Join-Path $PSScriptRoot 'agentes\agent-loop.ps1'
foreach ($a in ($Agentes -split '[,; ]+' | Where-Object { $_ } | ForEach-Object { $_.ToLower() })) {
  $launcher = Join-Path $root "launchers\$a-loop.cmd"
  if (-not (Test-Path $launcher)) { $launcher = Join-Path $root "launchers\$a.cmd" }
  if (-not (Test-Path $launcher)) { continue }
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $loop, '-Agent', $a, '-Launcher', $launcher, '-Sempre')
}
