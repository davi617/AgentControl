import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface AgentCfg {
  id: string;
  worktree?: string; // sem worktree = agente só no vault (ex.: CHATGPT)
}

export interface ProjectCfg {
  id: string;
  name: string;
  vault: string;
  activeGoalFile: string;
  goalsDir: string;
  chatDir?: string; // relativo ao vault: sala central (cada agente escreve só o próprio <ID>.md)
  orchestratorDir?: string;
  modelsDir?: string;
  agents: AgentCfg[];
}

export interface SummaryCfg {
  enabled: boolean;
  routerUrl: string;
  keyFile: string;
  models: string[];
  allowedPrefixes: string[];
  minIntervalMinutes: number;
  maxInputChars: number;
}

export interface RemoteCfg {
  enabled: boolean;
  host: string; // IP do PC no Tailscale (100.64.0.0/10). Loopback (127.0.0.1) só para teste local (ex.: emulador). Nunca 0.0.0.0 nem IP da rede de casa.
  port?: number; // padrão: mesma porta do servidor local
  tokenFile: string;
}

export interface Config {
  host: string;
  port: number;
  db: string;
  remote?: RemoteCfg;
  pollInterval?: number; // ms; só se o watcher nativo falhar (OneDrive)
  summary: SummaryCfg;
  projects: ProjectCfg[];
  /** Página de pagamento (site/pagar/ ou a do seu SaaS). Só https; vazio = o app não mostra "Mudar de plano". */
  pagarUrl?: string;
}

export function expand(p: string, base = process.cwd()): string {
  const home = p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
  return path.resolve(base, home);
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Faixa CGNAT usada pelo Tailscale: 100.64.0.0/10 (100.64.x.x a 100.127.x.x). */
export function isTailscaleIp(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  return a >= 64 && a <= 127 && b <= 255 && c <= 255;
}

export function loadConfig(file: string): Config {
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as Config;
  const base = path.dirname(path.resolve(file));
  // Regra dura do projeto: só loopback. Rede/Tailscale é Fase 4, com autenticação.
  if (!LOOPBACK.has(cfg.host)) throw new Error(`host "${cfg.host}" recusado: o Agent Control só escuta em 127.0.0.1 nesta fase`);
  if (cfg.remote?.enabled) {
    // Fase 4: só dentro do tailnet — ou em loopback, estritamente local (teste/emulador).
    if (!LOOPBACK.has(cfg.remote.host) && !isTailscaleIp(cfg.remote.host)) throw new Error(`remote.host "${cfg.remote.host}" recusado: use o IP do Tailscale (100.64.0.0/10) ou 127.0.0.1 para teste local`);
    if (cfg.remote.port !== undefined && (!Number.isInteger(cfg.remote.port) || cfg.remote.port < 1 || cfg.remote.port > 65535)) throw new Error('remote.port inválida');
    cfg.remote.tokenFile = expand(cfg.remote.tokenFile, base);
  }
  const pay = cfg.pagarUrl ?? process.env.AGENT_CONTROL_PAY_URL;
  cfg.pagarUrl = pay && /^https:\/\/[^\s"'<>]+$/.test(pay) ? pay : undefined;
  cfg.db = expand(cfg.db, base);
  cfg.summary.keyFile = expand(cfg.summary.keyFile, base);
  for (const p of cfg.projects) {
    p.vault = expand(p.vault, base);
    if (p.orchestratorDir) p.orchestratorDir = expand(p.orchestratorDir, base);
    if (p.modelsDir) p.modelsDir = expand(p.modelsDir, base);
    for (const a of p.agents) if (a.worktree) a.worktree = expand(a.worktree, base);
  }
  return cfg;
}
