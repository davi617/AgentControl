#!/usr/bin/env bash
# Funções dos agentes no Linux/macOS: onde fica a worktree de cada um e a ordem padrão que ele recebe.
# Ajuste por variável de ambiente (ou no ~/.config/dw-agents/agentes.env, que é lido se existir):
#   AGENT_WORKTREES   pasta onde ficam as worktrees (padrão: ~/Documents/Codex)
#   AGENT_WORKTREE_FMT nome da worktree; %s = agente (padrão: agent-%s)
#   ROUTER_URL        fila anti-429 (padrão: http://127.0.0.1:20129)
if [ -f "${DW_AGENTS_DIR:-$HOME/.config/dw-agents}/agentes.env" ]; then set -a; . "${DW_AGENTS_DIR:-$HOME/.config/dw-agents}/agentes.env"; set +a; fi

worktree_for() {
  # shellcheck disable=SC2059
  printf "%s/$(printf "${AGENT_WORKTREE_FMT:-agent-%s}" "$1")" "${AGENT_WORKTREES:-$HOME/Documents/Codex}"
}

# Mesma ordem dos lançadores do Windows: comando do JARVIS primeiro, depois a missão do Goal. Nada de push.
prompt_for() {
  local up; up="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
  local to="$up ou TODOS"; [ "$up" = "CLAUDE" ] && to="CLAUDE, LEADER ou TODOS"
  printf '%s' "PRIMEIRO leia .ai-team/JARVIS-INBOX.md: comando do dono com to: $to e status NEW tem prioridade sobre o resto (se requires_approval: yes, so execute depois de existir approved: J-xxx). Se seu STATUS.md ja tem - jarvis: J-xxx com DONE, pule esse comando. Ao pegar um comando registre no STATUS.md um bloco com - jarvis: J-xxx e - status: ACK, e no fim - status: DONE com evidencia. Depois: Leia .ai-team/GOAL.md, TASKS.md, INBOX.md e STATUS.md e execute somente a missao atribuida, registrando evidencias no STATUS.md. Fale com o time so por arquivos .md. Nao troque branch, nao push/merge/deploy/release."
}

router_key() { cat "${DW_AGENTS_DIR:-$HOME/.config/dw-agents}/9router.key" 2>/dev/null; }
export -f worktree_for prompt_for router_key
