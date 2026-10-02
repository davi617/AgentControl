# Loop de um agente no Windows (o agent-loop.sh faz o mesmo no Linux/macOS). Chamado por tools\ligar-agentes.ps1.
# Só roda quando chega ordem nova; PAUSE na pasta dos agentes segura; "agora" no PAUSE corta a rodada.
param(
  [Parameter(Mandatory=$true)][string]$Agent,
  [Parameter(Mandatory=$true)][string]$Launcher,
  [switch]$Sempre,          # 2026-09-26 : sem horário de parar; para fechando a janela do loop
  [int]$EsperarJanela=0     # PID de uma janela cmd com o agente ainda rodando: espera ele terminar antes
)
$ErrorActionPreference='Continue'
$root=Join-Path $env:USERPROFILE '.config\dw-agents'
$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$worktree=Join-Path (Join-Path $env:USERPROFILE 'Documents\Codex') ('agent-'+$Agent.ToLower())
try {
  $config=Get-Content (Join-Path $repo 'jarvis.config.json') -Raw | ConvertFrom-Json
  $configured=@($config.projects | ForEach-Object { $_.agents } | Where-Object { $_.id -ieq $Agent -and $_.worktree }) | Select-Object -First 1
  if($configured){
    $worktree=$configured.worktree
    if($worktree.StartsWith('~')){ $worktree=Join-Path $env:USERPROFILE $worktree.Substring(1).TrimStart('/','\') }
    elseif(-not [IO.Path]::IsPathRooted($worktree)){ $worktree=Join-Path $repo $worktree }
  }
} catch { Write-Error 'Não consegui ler a configuração do projeto.'; exit 1 }
if(-not (Test-Path (Join-Path $worktree '.ai-team'))){ Write-Error 'Configure a worktree e crie .ai-team antes de ligar o agente.'; exit 1 }
$env:WORKTREE=$worktree
$env:PROMPT='Leia .ai-team/JARVIS-INBOX.md e execute somente ordens destinadas a você ou TODOS, respeitando requires_approval e approved. Registre ACK e depois DONE ou BLOCKED com evidência em .ai-team/STATUS.md. Depois leia GOAL.md, TASKS.md e INBOX.md. Não troque branch, nem faça push, merge, deploy ou release.'
$logs=Join-Path $root 'night-logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log=Join-Path $logs ($Agent+'.log')
$sync=Join-Path $root 'goal-sync.ps1'
$sigFile=Join-Path $logs ($Agent+'.orders.sig')
$idle=$false
$paused=$false
$falhas=0
# 2026-10-02: lê mesmo com outro processo escrevendo no arquivo (goal-sync/agente); antes dava ERRO "sendo usado por outro processo".
function Read-Shared([string]$f){ try { $fs=[IO.File]::Open($f,'Open','Read','ReadWrite,Delete'); try { (New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() } } catch { '' } }
function Get-OrdersSig([string]$name){
  $dir=Join-Path $worktree '.ai-team'
  if(-not (Test-Path $dir)){ return $null }
  $txt=foreach($f in 'INBOX.md','TASKS.md','GOAL.md','LEADER.md','DECISIONS.md'){ $x=Join-Path $dir $f; if(Test-Path $x){ (Read-Shared $x) } }
  # JARVIS-INBOX: só acorda com comando para este agente (ou TODOS; LEADER acorda o CLAUDE, líder em exercício) e aprovações.
  $ji=Join-Path $dir 'JARVIS-INBOX.md'
  if(Test-Path $ji){
    $para=@($name.ToUpper(),'TODOS'); if($name -ieq 'claude'){ $para+='LEADER' }
    $txt+=(Read-Shared $ji) -split "`n## " | Where-Object { ($_ -match '(?m)^-\s*to:\s*(\S+)' -and $para -contains $Matches[1].Trim().ToUpper()) -or $_ -match '(?m)^-\s*(approved|rejected):' }
  }
  $sha=[Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($txt -join "`n"))))).Replace('-','')
}
$mutex=New-Object System.Threading.Mutex($false,('AgentLoop-'+$Agent))
if(-not $mutex.WaitOne(0,$false)){ exit 0 }
$now=Get-Date
$end=Get-Date -Hour 8 -Minute 0 -Second 0
if($now -ge $end){ $end=$end.AddDays(1) }
if($Sempre){ $end=[datetime]::MaxValue }
if($EsperarJanela -gt 0){
  # Não roda dois agentes na mesma worktree: espera a missão que já estava aberta acabar.
  while(@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$EsperarJanela" -ErrorAction SilentlyContinue | Where-Object Name -ne 'conhost.exe').Count -gt 0){ Start-Sleep -Seconds 15 }
}
Add-Content $log ("["+($now.ToString('s'))+"] START end="+$end.ToString('s'))
try {
 # 2026-09-26: um erro (ex.: PC sem RAM) registrava STOP e matava o loop. Agora registra ERRO e continua.
 while((Get-Date) -lt $end){ try {
  while((Get-Date) -lt $end){
    if(Test-Path $sync){ try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sync | Out-Null } catch {} }

    # 2026-09-26 : só roda quando chega ordem nova (INBOX/TASKS/JARVIS-INBOX/GOAL/LEADER/DECISIONS mudou).
    # Antes rodava a cada 30 s refazendo a mesma tarefa e gastando a cota da NVIDIA à toa.
    # 2026-09-26 : botão "Parar todos os agentes" do JARVIS/app cria o arquivo PAUSE. Enquanto existir, nenhuma rodada nova começa.
    if(Test-Path (Join-Path $root 'PAUSE')){
      if(-not $paused){ Add-Content $log ("["+(Get-Date).ToString('s')+"] PAUSED pelo dono"); $paused=$true }
      Start-Sleep -Seconds 20
      continue
    }
    if($paused){ $paused=$false; $idle=$false }
    $sig=Get-OrdersSig $Agent
    if($sig -and $sig -eq (Get-Content $sigFile -ErrorAction SilentlyContinue)){
      if(-not $idle){ Add-Content $log ("["+(Get-Date).ToString('s')+"] IDLE sem ordem nova"); $idle=$true }
      Start-Sleep -Seconds 60
      continue
    }
    $idle=$false
    # Trava de RAM (só quando vai rodar): com menos de 700 MB livres, espera (evita congelar o PC com todos os agentes juntos).
    while(((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB) -lt 700){
      Add-Content $log ("["+(Get-Date).ToString('s')+"] WAIT_RAM")
      Start-Sleep -Seconds 30
    }    $stamp=(Get-Date).ToString('yyyyMMdd-HHmmss')
    $stdout=Join-Path $logs ($Agent+'-'+$stamp+'.out.log')
    $stderr=Join-Path $logs ($Agent+'-'+$stamp+'.err.log')
    Add-Content $log ("["+(Get-Date).ToString('s')+"] RUN "+$Launcher)
    $p=Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c',$Launcher) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline=(Get-Date).AddMinutes(45)
    while(-not $p.HasExited -and (Get-Date) -lt $deadline -and (Get-Date) -lt $end){
      Start-Sleep -Seconds 5
      try { $p.Refresh() } catch {}
      # "Parar agora" (PAUSE com a palavra agora): corta a rodada em andamento também.
      $pf=Join-Path $root 'PAUSE'
      if((Test-Path $pf) -and ((Get-Content $pf -Raw -ErrorAction SilentlyContinue) -match 'agora')){
        Add-Content $log ("["+(Get-Date).ToString('s')+"] STOPPED pelo dono pid="+$p.Id)
        & taskkill.exe /PID $p.Id /T /F | Out-Null
        Start-Sleep -Seconds 2
        break
      }
    }
    if(-not $p.HasExited){
      Add-Content $log ("["+(Get-Date).ToString('s')+"] TIMEOUT pid="+$p.Id)
      & taskkill.exe /PID $p.Id /T /F | Out-Null
      Start-Sleep -Seconds 3
    } else {
      Add-Content $log ("["+(Get-Date).ToString('s')+"] EXIT code="+$p.ExitCode)
    }
    # 2026-10-02: rodada SEM NENHUMA saída (modelo não respondeu) não conta como feita: tenta de novo, esperando mais a cada vez.
    # Antes a ordem era marcada como vista e se perdia (J-005 ficou NEW porque a rodada das 21:57 saiu vazia).
    $vazia = -not (Test-Path $stdout) -or ([IO.File]::ReadAllText($stdout)).Trim().Length -eq 0
    if($vazia -and -not $p.HasExited){ $vazia = $false }
    if($vazia){
      $falhas++
      $espera = [Math]::Min(900, 120 * $falhas)
      Add-Content $log ("["+(Get-Date).ToString('s')+"] VAZIA sem saida; tenta de novo em "+$espera+" s (falha "+$falhas+")")
      Start-Sleep -Seconds $espera
      continue
    }
    $falhas = 0
    if($sig){ Set-Content $sigFile $sig }
    if(Test-Path $sync){ try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sync | Out-Null } catch {} }
    if((Get-Date) -lt $end){ Start-Sleep -Seconds 30 }
  }
 } catch { Add-Content $log ("["+(Get-Date).ToString('s')+"] ERRO "+$_.Exception.Message); Start-Sleep -Seconds 30 } }
} finally {
  Add-Content $log ("["+(Get-Date).ToString('s')+"] STOP")
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
