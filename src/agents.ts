// Nome de cada agente para as telas (o id, CLAUDE, CODEX…, continua sendo a chave em arquivos e na API).

const NAMES: Record<string, string> = {
  CLAUDE: 'Claude Code', CODEX: 'Codex', QWEN: 'Qwen Code', OPENCODE: 'OpenCode', HERMES: 'Hermes', OPENCLAW: 'OpenClaw',
  DROID: 'Droid', GEMINI: 'Gemini CLI', GROK: 'Grok CLI', AIDER: 'Aider', CURSOR: 'Cursor', AMP: 'Amp', KIMI: 'Kimi CLI',
  CHATGPT: 'ChatGPT', LEADER: 'Líder', JARVIS: 'AgentC', DONO: 'Você', TODOS: 'Todos',
};

/** "CLAUDE" → "Claude Code"; id desconhecido vira "Meu_agente" → "Meu agente". */
export function agentName(id: string): string {
  const up = String(id ?? '').toUpperCase();
  if (NAMES[up]) return NAMES[up];
  const s = up.replace(/_/g, ' ').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '?';
}
