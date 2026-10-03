// Pacote de funções do app (2026-09-27): uso dos agentes, histórico de chamadas, "Sobre", processos pesados
// e o diário automático no vault. Só leitura do PC, exceto o diário (escreve em 20-Operations/Diario).

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectCfg, SummaryCfg } from './config.ts';
import type { Store } from './store.ts';
import { localDay } from './date.ts';

const STARTED = Date.now();
/** Commit do código que ESTE processo carregou (lido ao ligar). Antes lia o HEAD na hora e mostrava commit novo com código velho rodando. */
const RUNNING_COMMIT = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', timeout: 3000, windowsHide: true }).trim(); } catch { return ''; }
})();

/** Uso por agente vindo da fila (/gate/usage). */
export async function gateUsage(summary: SummaryCfg, dias: number, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = new URL(summary.routerUrl);
  const r = await fetchImpl(`${url.origin}/gate/usage?dias=${dias}`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`fila respondeu HTTP ${r.status}`);
  return r.json();
}

export interface CallInfo { id: string; path: string; topic: string; data: string; falas: number; tarefas: number }

/** Atas das chamadas (20-Operations/Calls/CALL-*.md), mais nova primeiro. */
export function listCalls(p: ProjectCfg, limit = 50): CallInfo[] {
  const dir = path.join(p.vault, '20-Operations', 'Calls');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^CALL-.+\.md$/.test(f)).sort().reverse().slice(0, limit).map((f) => {
    const t = readFileSync(path.join(dir, f), 'utf8');
    return {
      id: f.slice(0, -3),
      path: `20-Operations/Calls/${f}`,
      topic: (/^# CALL-[^·]+·\s*(.+)$/m.exec(t)?.[1] ?? '').trim(),
      data: (/^data:\s*(.+)$/m.exec(t)?.[1] ?? '').trim(),
      falas: (t.match(/^\*\*[A-Z]+\*\* \(/gm) ?? []).length,
      tarefas: (t.match(/^- \[ \] \*\*/gm) ?? []).length,
    };
  });
}

/** Versões e tempo ligado: ajuda a saber se o PC/JARVIS reiniciou e qual código está rodando. */
export function about(dbFile: string) {
  const commit = RUNNING_COMMIT;
  let app: unknown = null;
  try { app = JSON.parse(readFileSync(path.join(path.dirname(dbFile), 'app', 'version.json'), 'utf8')); } catch { /* nenhum app publicado */ }
  return {
    jarvis: { commit, node: process.version, ligadoHaMin: Math.round((Date.now() - STARTED) / 60_000) },
    pc: { nome: "Computador", ligadoHaMin: Math.round(os.uptime() / 60), nucleos: os.cpus().length },
    app,
  };
}

/** Os 5 processos que mais usam RAM no PC (tasklist do Windows). Nada de linha de comando: só nome e MB. */
export function topProcesses(limit = 5): Promise<{ nome: string; mb: number }[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => {
      if (e) { resolve([]); return; }
      const byName = new Map<string, number>();
      for (const line of out.split(/\r?\n/)) {
        const c = line.match(/"([^"]*)"/g)?.map((x) => x.slice(1, -1));
        if (!c || c.length < 5) continue;
        const kb = Number(c[4].replace(/[^\d]/g, ''));
        if (kb) byName.set(c[0], (byName.get(c[0]) ?? 0) + kb);
      }
      resolve([...byName.entries()].map(([nome, kb]) => ({ nome, mb: Math.round(kb / 1024) })).sort((a, b) => b.mb - a.mb).slice(0, limit));
    });
  });
}

/**
 * Diário do dia no vault (20-Operations/Diario/AAAA-MM-DD.md): comandos, notas, chamadas e uso da NVIDIA.
 * Reescrito de hora em hora (sempre o retrato atual do dia); nota de outro dia não é tocada.
 */
export async function writeDiary(store: Store, p: ProjectCfg, summary: SummaryCfg, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<string> {
  const dia = localDay(now);
  const cmds = store.commands(p.id, 1000).filter((c) => c.created_at.slice(0, 10) === dia);
  const notas = store.notes(p.id, 500).filter((n) => n.created_at.slice(0, 10) === dia);
  const calls = listCalls(p, 200).filter((c) => c.id.startsWith(`CALL-${dia}`));
  let uso: { agentes?: { agent: string; req: number; pin: number; pout: number; r429: number }[] } = {};
  try { uso = await gateUsage(summary, 1, fetchImpl) as typeof uso; } catch { /* fila fora do ar */ }
  const md = [
    '---', 'type: diario', `data: ${dia}`, 'tags: [diario, jarvis]', '---',
    `# Diário do JARVIS · ${dia}`, '',
    `> Gerado pelo JARVIS (${now.toLocaleTimeString('pt-BR').slice(0, 5)}). Reescrito de hora em hora durante o dia.`, '',
    `## Comandos (${cmds.length})`,
    ...(cmds.length ? cmds.map((c) => `- **${c.code}** → ${c.target} · ${c.status} · ${c.text.replace(/\s+/g, ' ').slice(0, 140)}`) : ['- nenhum']), '',
    `## Chamadas (${calls.length})`,
    ...(calls.length ? calls.map((c) => `- [[${c.id}]] · ${c.topic} · ${c.falas} falas · ${c.tarefas} tarefas`) : ['- nenhuma']), '',
    `## Notas rápidas (${notas.length})`,
    ...(notas.length ? notas.map((n) => `- [${n.done ? 'x' : ' '}] ${n.text.replace(/\s+/g, ' ').slice(0, 160)}`) : ['- nenhuma']), '',
    '## Uso da NVIDIA (pela fila)',
    ...(uso.agentes?.length ? ['| Quem | Pedidos | Tokens | 429 |', '|---|---|---|---|', ...uso.agentes.map((a) => `| ${a.agent} | ${a.req} | ${a.pin + a.pout} | ${a.r429} |`)] : ['- sem dados (fila fora do ar ou nada hoje)']),
    '',
  ].join('\n');
  const file = path.join(p.vault, '20-Operations', 'Diario', `${dia}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, md);
  return file;
}

/** Comandos criados por dia (para o gráfico das Estatísticas). */
export function commandsPerDay(store: Store, p: ProjectCfg, dias: number, now = new Date()) {
  const cmds = store.commands(p.id, 2000);
  const out: { dia: string; total: number; done: number }[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = localDay(new Date(now.getTime() - i * 86_400_000));
    const doDia = cmds.filter((c) => c.created_at.slice(0, 10) === dia);
    out.push({ dia, total: doDia.length, done: doDia.filter((c) => c.status === 'DONE').length });
  }
  return out;
}
