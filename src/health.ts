// Saúde para o app: fila anti-429 (travou? quem ocupa as vagas?), loops dos agentes e RAM do PC.
// Só leitura. Existe porque "nenhum agente funciona" foi uma fila pendurada que ninguém via do celular.

import { existsSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pauseState, type PauseState } from './control.ts';
import { redact } from './redact.ts';
import type { ProjectCfg, SummaryCfg } from './config.ts';
import { topProcesses } from './extras.ts';

/** % de CPU usada agora: compara os tempos de cada núcleo em dois instantes bem próximos. */
export async function cpuPercent(sampleMs = 200): Promise<number> {
  const read = () => os.cpus().reduce((a, c) => { for (const k of Object.values(c.times)) a.total += k; a.idle += c.times.idle; return a; }, { idle: 0, total: 0 });
  const a = read();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = read();
  const total = b.total - a.total;
  return total > 0 ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : 0;
}

/** Espaço livre no disco onde fica o vault (ex.: OneDrive cheio trava o Obsidian sem avisar). */
export function diskFree(dir: string): { livreMb: number; totalMb: number } | null {
  try {
    const s = statfsSync(dir);
    const block = s.bsize ?? s.frsize ?? 4096;
    return { livreMb: Math.round((s.bavail * block) / 1048576), totalMb: Math.round((s.blocks * block) / 1048576) };
  } catch { return null; }
}

export interface LoopInfo {
  agent: string;
  rodadas: number;
  timeouts: number;
  ultima: string | null; // início da última rodada (hora local do PC)
  estado: 'rodando' | 'esperando RAM' | 'terminou' | 'estourou o tempo' | 'esperando ordem' | 'pausado' | 'parado' | 'falhando';
  minutos: number | null; // há quanto tempo a rodada atual/última começou
  falhas?: number; // rodadas seguidas sem saída (o modelo/CLI não respondeu)
  motivo?: string; // última linha de erro da rodada que falhou (sem segredos)
}

export interface Health {
  gate: { ok: boolean; inFlight?: number; queued?: number; voiceMode?: boolean; retried429?: number; cut?: number; ativos?: { segundos: number; voz: boolean }[]; travada?: boolean; erro?: string };
  loops: LoopInfo[];
  ram: { livreMb: number; totalMb: number };
  cpu: number | null; // % em uso agora
  processos: { nome: string; mb: number }[]; // os 5 que mais usam RAM
  ligadoHaMin: number; // tempo desde que o PC ligou
  disco: { livreMb: number; totalMb: number } | null; // disco do vault
  alertas: string[];
  pausa: PauseState;
}

/** Lê o log de um loop (night-agent-loop.ps1): linhas "[AAAA-MM-DDTHH:MM:SS] RUN|EXIT|TIMEOUT|WAIT_RAM|IDLE|START|STOP …". */
export function parseLoopLog(agent: string, text: string, now = new Date()): LoopInfo {
  let base = 0, rodadas = 0, timeouts = 0, falhas = 0, ultima: string | null = null, estado: LoopInfo['estado'] = 'parado';
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[([^\]]+)\] (RUN|EXIT|TIMEOUT|WAIT_RAM|IDLE|PAUSED|STOPPED|START|STOP|VAZIA)/.exec(line.trim());
    if (!m) continue;
    const [, ts, ev] = m;
    // VAZIA vem logo depois do EXIT de uma rodada sem saída; uma rodada com saída zera a contagem.
    if (ev === 'VAZIA') { falhas = base + 1; estado = 'falhando'; continue; }
    if (ev === 'IDLE' || ev === 'START') falhas = 0;
    if (ev === 'RUN') { base = falhas; rodadas++; ultima = ts; estado = 'rodando'; }
    else if (ev === 'EXIT') { falhas = 0; estado = 'terminou'; }
    else if (ev === 'TIMEOUT') { timeouts++; estado = 'estourou o tempo'; }
    else if (ev === 'WAIT_RAM') estado = 'esperando RAM';
    else if (ev === 'IDLE') estado = 'esperando ordem';
    else if (ev === 'PAUSED' || ev === 'STOPPED') estado = 'pausado';
    else if (ev === 'STOP') estado = 'parado';
  }
  const minutos = ultima ? Math.max(0, Math.round((now.getTime() - new Date(ultima).getTime()) / 60_000)) : null;
  return { agent, rodadas, timeouts, ultima, estado, minutos, ...(falhas ? { falhas } : {}) };
}

/** Última linha útil do .err.log mais novo do agente (ex.: "Missing API key"), sem cores e sem segredos. */
export function lastError(dir: string, agent: string): string | undefined {
  try {
    const pre = `${agent.toLowerCase()}-`;
    const f = readdirSync(dir).filter((n) => n.startsWith(pre) && n.endsWith('.err.log')).sort().pop();
    if (!f) return undefined;
    const lines = readFileSync(path.join(dir, f), 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const line = lines.reverse().find((l) => /erro|error|precisa|aguardando|missing|não encontrad|not found|denied|unauthori|chave|key/i.test(l)) ?? lines[0];
    return line ? redact(line).slice(0, 200) : undefined;
  } catch { return undefined; }
}

export async function health(p: ProjectCfg, summary: SummaryCfg, fetchImpl: typeof fetch = fetch): Promise<Health> {
  const alertas: string[] = [];
  // A fila é o mesmo endereço que os resumos usam (…:20129/v1) → /gate/status.
  let gate: Health['gate'];
  try {
    const url = new URL(summary.routerUrl);
    const r = await fetchImpl(`${url.origin}/gate/status`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('Gate status unavailable');
    const g = await r.json() as NonNullable<Health['gate']> & { ativos?: { segundos: number; voz: boolean }[] };
    const travada = (g.ativos ?? []).some((a) => a.segundos > 600) && (g.queued ?? 0) > 0;
    gate = { ok: true, inFlight: g.inFlight, queued: g.queued, voiceMode: g.voiceMode, retried429: g.retried429, cut: g.cut, ativos: g.ativos, travada };
    if (travada) alertas.push('Fila travada: um pedido está preso há mais de 10 min e tem gente esperando. Ela corta sozinha em até 5 min; se não, reinicie a fila no PC.');
    else if ((g.queued ?? 0) > 20 && !g.voiceMode) alertas.push(`Fila cheia: ${g.queued} pedidos esperando a NVIDIA.`);
    if (g.voiceMode) alertas.push('Modo voz: os agentes esperam enquanto você está numa chamada (voltam 2 min depois da última fala).');
    // Muito 429 hoje = a conta da NVIDIA está no limite; vale pausar alguém ou baixar a força.
    try {
      const u = await (await fetchImpl(`${url.origin}/gate/usage?dias=1`, { signal: AbortSignal.timeout(2000) })).json() as { agentes?: { agent: string; r429: number }[] };
      const r429 = (u.agentes ?? []).reduce((s, a) => s + (a.r429 ?? 0), 0);
      if (r429 > 50) alertas.push(`A NVIDIA mandou esperar ${r429} vezes hoje (429). Considere pausar um agente ou baixar a força.`);
    } catch { /* fila antiga sem /gate/usage */ }
  } catch (e) {
    gate = { ok: false, erro: (e as Error).name === 'TimeoutError' ? 'sem resposta' : 'desligada' };
    alertas.push('A fila anti-429 (porta 20129) não responde: os agentes não conseguem falar com a NVIDIA.');
  }

  const loops: LoopInfo[] = [];
  const dir = p.modelsDir ? path.join(p.modelsDir, 'night-logs') : '';
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => /^[a-z]+\.log$/.test(n))) {
      try {
        const l = parseLoopLog(f.replace('.log', '').toUpperCase(), readFileSync(path.join(dir, f), 'utf8'));
        if (l.estado === 'falhando') { const why = lastError(dir, l.agent); if (why) l.motivo = why; }
        loops.push(l);
      }
      catch { alertas.push(`Não consegui ler o estado de ${f.replace('.log', '').toUpperCase()}; tente atualizar.`); }
    }
  }
  for (const l of loops) {
    if (l.estado === 'rodando' && (l.minutos ?? 0) > 50) alertas.push(`${l.agent} está numa rodada há ${l.minutos} min (o loop corta em 45).`);
    if (l.estado === 'esperando RAM') alertas.push(`${l.agent} está esperando RAM livre no PC.`);
  }
  const falhando = loops.filter((l) => l.estado === 'falhando');
  if (falhando.length) alertas.unshift(`${falhando.length === 1 ? `${falhando[0].agent} não consegue rodar` : `${falhando.length} agentes não conseguem rodar`}: ${falhando[0].motivo ?? 'a rodada sai sem resposta do modelo'}`);
  // Sem a chave do 9Router nem o AgentC responde no chat nem os agentes têm modelo.
  if (summary.enabled && summary.keyFile && !existsSync(summary.keyFile)) alertas.unshift('Falta a chave do 9Router (~/.config/agent-control/9router.key): agentes e o AgentC ficam sem modelo. Crie uma chave no painel do 9Router e salve nesse arquivo.');

  const ram = { livreMb: Math.round(os.freemem() / 1048576), totalMb: Math.round(os.totalmem() / 1048576) };
  if (ram.livreMb < 700) alertas.push(`PC com pouca RAM: ${ram.livreMb} MB livres.`);
  const cpu = await cpuPercent().catch(() => null);
  if (cpu !== null && cpu > 92) alertas.push(`CPU no talo (${cpu}%): o PC pode ficar lento para tudo, inclusive os agentes.`);
  const disco = diskFree(p.vault);
  if (disco && disco.livreMb < 1024) alertas.push(`Disco do vault com pouco espaço: ${disco.livreMb} MB livres.`);
  const pausa = p.modelsDir ? pauseState(p.modelsDir) : { paused: false, agora: false, desde: null };
  if (pausa.paused) alertas.unshift('Agentes PAUSADOS por você. Nenhuma rodada nova começa até você retomar.');
  const processos = await topProcesses().catch(() => []);
  return { gate, loops: loops.sort((a, b) => a.agent.localeCompare(b.agent)), ram, cpu, disco, processos, ligadoHaMin: Math.round(os.uptime() / 60), alertas, pausa };
}
