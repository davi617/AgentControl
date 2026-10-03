#!/usr/bin/env bash
# Loop de um agente no Linux/macOS (o mesmo papel do night-agent-loop.ps1 no Windows).
#   agent-loop.sh <agente> [lançador]
# - Um loop por agente: o PID fica em ~/.config/agent-control/night-logs/<agente>.pid (o Launcher lê para mostrar LIGADO).
# - Só roda quando chega ORDEM NOVA (INBOX/TASKS/GOAL/LEADER/DECISIONS ou comando do JARVIS para ele mudou).
# - Arquivo PAUSE na pasta dos agentes: nenhuma rodada nova começa; com a palavra "agora", corta a rodada atual.
# - Pouca RAM (< 700 MB livres): espera. Rodada com mais de 45 min: corta.
# - Log no mesmo formato do Windows ("[AAAA-MM-DDTHH:MM:SS] RUN|EXIT|..."), que o servidor lê na tela Saúde.
# Compatível com o bash 3.2 do macOS.
set -u
AGENT="${1:?uso: agent-loop.sh <agente> [lançador]}"
ROOT="${DW_AGENTS_DIR:-$HOME/.config/agent-control}"
LOGS="$ROOT/night-logs"
LAUNCHER="${2:-$ROOT/launchers/$AGENT.sh}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export AGENT_CONTROL_DIR="${AGENT_CONTROL_DIR:-$(cd "$HERE/../.." && pwd)}"
mkdir -p "$LOGS"
LOG="$LOGS/$AGENT.log"; PIDF="$LOGS/$AGENT.pid"; SIGF="$LOGS/$AGENT.orders.sig"
. "$HERE/comum.sh"

ts() { date +%Y-%m-%dT%H:%M:%S; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Trava: se já tem um loop vivo deste agente, sai quieto.
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDF"
trap 'log STOP; rm -f "$PIDF"' EXIT
trap 'exit 0' INT TERM
[ -f "$LAUNCHER" ] || { log "ERRO lançador não encontrado: $LAUNCHER"; exit 1; }

export AGENT WORKTREE PROMPT
WORKTREE="$(worktree_for "$AGENT")"
PROMPT="$(prompt_for "$AGENT")"

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

# Assinatura das ordens: muda só quando chega algo novo para este agente.
orders_sig() {
  local dir="$WORKTREE/.ai-team" up
  [ -d "$dir" ] || return 0
  up="$(echo "$AGENT" | tr '[:lower:]' '[:upper:]')"
  {
    for f in INBOX.md TASKS.md GOAL.md LEADER.md DECISIONS.md; do [ -f "$dir/$f" ] && cat "$dir/$f"; done
    # JARVIS-INBOX: só os blocos para este agente (ou TODOS; LEADER acorda o CLAUDE) e as aprovações.
    [ -f "$dir/JARVIS-INBOX.md" ] && awk -v me="$up" '
      function flush() { if (keep) printf "%s", buf; buf = ""; keep = 0 }
      /^## / { flush() }
      { buf = buf $0 "\n"
        if (match($0, /^-[ \t]*to:[ \t]*[^ \t]+/)) { t = toupper(substr($0, RSTART, RLENGTH)); sub(/^-[ \t]*TO:[ \t]*/, "", t)
          if (t == me || t == "TODOS" || (me == "CLAUDE" && t == "LEADER")) keep = 1 }
        if ($0 ~ /^-[ \t]*(approved|rejected):/) keep = 1 }
      END { flush() }' "$dir/JARVIS-INBOX.md"
  } | sha
}

free_mb() {
  local m=""
  if [ -r /proc/meminfo ]; then m="$(awk '/MemAvailable/ { a=int($2/1024) } /MemFree/ { f=int($2/1024) } END { print (a ? a : f) }' /proc/meminfo)"
  elif command -v vm_stat >/dev/null 2>&1; then m="$(vm_stat | awk '/page size of/ { ps=$8 } /Pages (free|inactive|speculative)/ { gsub("\\.","",$NF); n+=$NF } END { print int(n*ps/1048576) }')"; fi
  echo "${m:-99999}" # sem como medir: não trava
}

kill_tree() {
  local p="$1" c
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill -TERM "$p" 2>/dev/null; sleep 2; kill -KILL "$p" 2>/dev/null
}

log "START end=sempre"
idle=0; paused=0; falhas=0
while :; do
  if [ -f "$ROOT/PAUSE" ]; then
    [ $paused -eq 0 ] && log "PAUSED pelo dono"; paused=1; sleep 20; continue
  fi
  [ $paused -eq 1 ] && { paused=0; idle=0; }
  sig="$(orders_sig)"
  if [ -n "$sig" ] && [ "$sig" = "$(cat "$SIGF" 2>/dev/null)" ]; then
    [ $idle -eq 0 ] && log "IDLE sem ordem nova"; idle=1; sleep "${AGENT_LOOP_IDLE:-60}"; continue
  fi
  idle=0
  while [ "$(free_mb)" -lt 700 ]; do log WAIT_RAM; sleep 30; done
  stamp="$(date +%Y%m%d-%H%M%S)"
  log "RUN $LAUNCHER"
  bash "$LAUNCHER" > "$LOGS/$AGENT-$stamp.out.log" 2> "$LOGS/$AGENT-$stamp.err.log" &
  pid=$!
  deadline=$(( $(date +%s) + 45 * 60 ))
  cut=""
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then cut="TIMEOUT pid=$pid"; break; fi
    if [ -f "$ROOT/PAUSE" ] && grep -qi agora "$ROOT/PAUSE"; then cut="STOPPED pelo dono pid=$pid"; break; fi
    sleep 5
  done
  if [ -n "$cut" ]; then log "$cut"; kill_tree "$pid"; wait "$pid" 2>/dev/null
  else wait "$pid"; log "EXIT code=$?"; fi
  # Rodada SEM NENHUMA saída (modelo não respondeu) não conta como feita: tenta de novo, esperando mais a cada vez.
  if [ -z "$(tr -d "[:space:]" < "$LOGS/$AGENT-$stamp.out.log" 2>/dev/null)" ]; then
    falhas=$((falhas + 1)); espera=$((120 * falhas)); [ $espera -gt 900 ] && espera=900
    log "VAZIA sem saida; tenta de novo em $espera s (falha $falhas)"
    sleep "${AGENT_LOOP_RETRY:-$espera}"; continue
  fi
  falhas=0
  [ -n "$sig" ] && echo "$sig" > "$SIGF"
  sleep "${AGENT_LOOP_PAUSE:-30}"
done
