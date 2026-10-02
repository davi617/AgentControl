// Cotas informadas pelo provedor. Contagem local de pedidos nunca vira saldo de cota.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProjectCfg, SummaryCfg } from './config.ts';
import { modelChoices } from './models.ts';

export interface LimitWindow { name: string; remainingPercent: number; windowMinutes: number; resetsAt: number | null }
export interface AgentLimit {
  agent: string; provider: string; status: 'live' | 'unavailable' | 'stale' | 'limited';
  remainingPercent: number | null; windows: LimitWindow[]; checkedAt: string | null; detail: string;
}

/** Só conserva números e nomes de janelas: não expõe identidade, créditos ou tokens de login. */
export function codexLimit(raw: any, now = new Date()): AgentLimit {
  const bucket = raw?.rateLimitsByLimitId?.codex ?? raw?.rateLimits;
  const windows: LimitWindow[] = [];
  for (const [name, w] of [['principal', bucket?.primary], ['secundária', bucket?.secondary]] as const) {
    if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) continue;
    const mins = typeof w.windowDurationMins === 'number' ? w.windowDurationMins : 0;
    windows.push({ name: mins === 10080 ? '7 dias' : mins === 300 ? '5 horas' : name,
      remainingPercent: Math.max(0, Math.min(100, 100 - w.usedPercent)), windowMinutes: mins,
      resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt : null });
  }
  const blocked = raw?.ordinaryUsageAllowed === false || !!bucket?.rateLimitReachedType;
  return { agent: 'CODEX', provider: 'OpenAI / ChatGPT', status: blocked ? 'limited' : windows.length ? 'live' : 'unavailable',
    remainingPercent: windows.length ? Math.min(...windows.map(w => w.remainingPercent)) : null,
    windows, checkedAt: now.toISOString(), detail: blocked ? 'O provedor informa um limite atingido.' : windows.length ? 'Saldo informado pela conta do Codex; compartilhado entre sessões.' : 'A conta não informou janelas de cota.' };
}

function codexCommand(): [string, string[]] {
  const home = homedir();
  if (process.platform === 'win32') {
    for (const root of [path.join(home, '.codex-cli', 'node_modules', '@openai'), path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai')]) {
      for (const rel of ['codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe', 'codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe', 'codex/vendor/x86_64-pc-windows-msvc/bin/codex.exe']) {
        const exe = path.join(root, rel); if (existsSync(exe)) return [exe, ['app-server']];
      }
    }
    return ['codex.exe', ['app-server']];
  }
  return ['codex', ['app-server']];
}

/** JSON-RPC somente leitura. Não cria thread, inicia turn, muda modelo nem compra créditos. */
export function readCodexLimits(command = codexCommand(), timeoutMs = 12000): Promise<AgentLimit> {
  return new Promise((resolve) => {
    const [exe, args] = command;
    const child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let done = false, buffer = '';
    const finish = (value: AgentLimit) => { if (done) return; done = true; clearTimeout(timer); child.stdin.end(); child.kill(); resolve(value); };
    const unavailable = () => finish({ agent: 'CODEX', provider: 'OpenAI / ChatGPT', status: 'unavailable', remainingPercent: null, windows: [], checkedAt: null, detail: 'Não consegui consultar a conta do Codex. Confira o CLI e seu login.' });
    const timer = setTimeout(unavailable, timeoutMs);
    const send = (v: object) => { if (!done && child.stdin.writable) child.stdin.write(JSON.stringify(v) + '\n'); };
    child.on('error', unavailable); child.on('exit', () => { if (!done) unavailable(); }); child.stdin.on('error', unavailable);
    child.stdout.on('data', (b: Buffer) => {
      buffer += b.toString('utf8'); if (buffer.length > 1000000) { unavailable(); return; }
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            if (msg.error) { unavailable(); return; }
            send({ method: 'initialized', params: {} }); send({ method: 'account/rateLimits/read', id: 2 });
          } else if (msg.id === 2) { if (msg.error) unavailable(); else finish(codexLimit(msg.result)); }
        } catch { /* linhas não JSON não são exibidas */ }
      }
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'agent_control', title: 'Agent Control', version: '1.2.0' } } });
  });
}

let cached: AgentLimit | undefined, checked = 0, pending: Promise<AgentLimit> | undefined;
async function codexCached(): Promise<AgentLimit> {
  if (Date.now() - checked < 60000 && cached) return cached;
  if (!pending) pending = readCodexLimits().then(value => {
    checked = Date.now();
    if (value.status === 'unavailable' && cached?.windows.length) cached = { ...cached, status: 'stale', detail: 'Última leitura; consulta atual indisponível.' };
    else cached = value;
    return cached;
  }).finally(() => { pending = undefined; });
  return pending;
}

export async function agentLimits(p: ProjectCfg, summary: SummaryCfg) {
  const codex = p.agents.some(a => a.id.toUpperCase() === 'CODEX') ? codexCached() : Promise.resolve(undefined);
  let gate: any = null;
  try { const r = await fetch(new URL('/gate/status', summary.routerUrl), { signal: AbortSignal.timeout(2500) }); if (r.ok) gate = await r.json(); } catch { }
  const choices = modelChoices(p.modelsDir ?? '');
  const c = await codex;
  const agents = p.agents.filter(a => a.id.toUpperCase() !== 'CHATGPT').map(a => {
    const id = a.id.toUpperCase(); if (id === 'CODEX' && c) return c;
    const model = choices.find(m => m.id === id)?.current ?? '';
    const shared = /kimi|glm|nemotron|nvidia|gemma/i.test(model);
    const until = gate?.cooldownUntil ? Date.parse(gate.cooldownUntil) : 0;
    return { agent: id, provider: shared ? 'NVIDIA / fila compartilhada' : 'Provedor do agente', status: shared && until > Date.now() ? 'limited' : 'unavailable', remainingPercent: null, windows: [], checkedAt: gate && shared ? new Date().toISOString() : null,
      detail: shared ? until > Date.now() ? 'Provedor pediu espera. A cota é compartilhada pelo time.' : 'O provedor não informa saldo de cota nesta integração. Pedidos e 429 aparecem em Uso.' : 'Saldo não disponibilizado pelo provedor nesta integração.' } satisfies AgentLimit;
  });
  return { agents, updatedAt: new Date().toISOString(), refreshSeconds: 60,
    gate: gate ? { inFlight: gate.inFlight, queued: gate.queued, maxConcurrent: gate.maxConcurrent, cooldownUntil: gate.cooldownUntil ?? null } : null };
}
