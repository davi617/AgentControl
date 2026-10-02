#!/usr/bin/env bash
# Liga os loops de todos os agentes em segundo plano (Linux/macOS). Seguro rodar de novo: cada loop
# tem trava própria (PID em ~/.config/dw-agents/night-logs/<agente>.pid) e o segundo sai sozinho.
# Só liga quem tem lançador em ~/.config/dw-agents/launchers/<agente>.sh (exemplos em tools/agentes/launchers/).
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${DW_AGENTS_DIR:-$HOME/.config/dw-agents}"
# Lista: argumentos (o Agent Control passa os escolhidos em Ajustes > Seu time), ou $AGENTES, ou os 7 de sempre.
AGENTES="${*:-${AGENTES:-claude codex droid hermes openclaw opencode qwen}}"
ligados=0
for a in $AGENTES; do
  [ -f "$ROOT/launchers/$a.sh" ] || { echo "$a: sem lançador ($ROOT/launchers/$a.sh), pulando"; continue; }
  nohup bash "$HERE/agent-loop.sh" "$a" > /dev/null 2>&1 < /dev/null &
  ligados=$((ligados + 1))
done
echo "Loops pedidos: $ligados. Veja em $ROOT/night-logs/<agente>.log"
