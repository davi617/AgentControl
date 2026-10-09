// Descobre os arquivos de cada projeto e transforma mudanças em entradas da sala.
// Tudo aqui é SOMENTE LEITURA sobre vault, worktrees e orquestrador.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ProjectCfg } from './config.ts';
import { normalize } from './normalize.ts';
import { canonicalStatus, parseTasks, statusInText, readKey, sha, splitSections, type TaskRow } from './parser.ts';
import { redact } from './redact.ts';
import { localIso } from './date.ts';
import { agentName } from './agents.ts';
import type { Entry, Store } from './store.ts';

export type Kind = 'chat' | 'command' | 'status' | 'leader' | 'events' | 'decisions' | 'inbox' | 'goal' | 'handoff' | 'tasks' | 'meta';

export interface SourceFile {
  path: string;
  kind: Kind;
  agent: string; // dono; para arquivos compartilhados é o rótulo do arquivo
}

const MAX_BODY = 60_000;

export function readText(p: string): string {
  return redact(normalize(readFileSync(p, 'utf8')));
}

export { localIso };
export function nowIso(): string { return localIso(new Date()); }

/** Pasta do Goal ativo, lida de ACTIVE_GOAL.md (nunca hardcoded). */
export function goalDir(p: ProjectCfg): string | undefined {
  const f = path.join(p.vault, p.activeGoalFile);
  if (!existsSync(f)) return undefined;
  const txt = normalize(readFileSync(f, 'utf8'));
  const goal = readKey(txt, 'goal');
  if (!goal) return undefined;
  const dir = path.join(p.vault, p.goalsDir, goal);
  return existsSync(dir) ? dir : undefined;
}

export function activeGoalId(p: ProjectCfg): string | undefined {
  const d = goalDir(p);
  return d ? path.basename(d) : undefined;
}

const SHARED: Record<string, { kind: Kind; label: string }> = {
  'GOAL.md': { kind: 'goal', label: 'GOAL' },
  'LEADER.md': { kind: 'leader', label: 'LEADER' },
  'EVENTS.md': { kind: 'events', label: 'EVENTS' },
  'DECISIONS.md': { kind: 'decisions', label: 'DECISIONS' },
  'HANDOFF.md': { kind: 'handoff', label: 'HANDOFF' },
  'TASKS.md': { kind: 'tasks', label: 'TASKS' },
  'JARVIS-INBOX.md': { kind: 'command', label: 'DONO' },
};

/** Lista de arquivos que viram entradas (e portanto são observados). */
export function sourceFiles(p: ProjectCfg): SourceFile[] {
  const out: SourceFile[] = [];
  out.push({ path: path.join(p.vault, p.activeGoalFile), kind: 'meta', agent: 'ACTIVE_GOAL' });
  const gd = goalDir(p);
  if (gd) {
    for (const [name, s] of Object.entries(SHARED)) out.push({ path: path.join(gd, name), kind: s.kind, agent: s.label });
    for (const a of p.agents) {
      // Inbox do agente (ordens do líder)
      out.push({ path: path.join(gd, 'AGENTS', `${a.id}.md`), kind: a.worktree ? 'inbox' : 'status', agent: a.id });
      // Agente sem worktree (ex.: CHATGPT): a cópia no vault é a única fonte de status
      if (!a.worktree) out.push({ path: path.join(gd, 'AGENTS', `${a.id}-STATUS.md`), kind: 'status', agent: a.id });
    }
  }
  // STATUS direto da worktree: a cópia do vault pode estar atrasada (Fase 0, F2)
  for (const a of p.agents) if (a.worktree) out.push({ path: path.join(a.worktree, '.ai-team', 'STATUS.md'), kind: 'status', agent: a.id });
  return out;
}

/** Arquivos que só mudam o painel de agentes (locks, marcadores, modelos). */
export function metaPaths(p: ProjectCfg): string[] {
  const out: string[] = [];
  if (p.orchestratorDir) out.push(p.orchestratorDir);
  if (p.modelsDir) out.push(path.join(p.modelsDir, 'provider-ring-state.json'));
  if (p.modelsDir) for (const a of p.agents) out.push(path.join(p.modelsDir, `active-model-${a.id.toLowerCase()}.txt`));
  return out;
}

function authorFor(src: SourceFile, headingAgent: string | undefined, known: Set<string>): string {
  if (src.kind === 'status' || src.kind === 'inbox' || src.kind === 'chat') return src.agent;
  const first = headingAgent?.split(/\s+/)[0];
  return first && known.has(first) ? first : src.agent;
}

/**
 * Lê um arquivo e grava as seções novas. `initial` marca importação da primeira varredura,
 * para a UI não tratar o histórico inteiro como novidade.
 */
export function ingest(store: Store, p: ProjectCfg, src: SourceFile, initial: boolean): Entry[] {
  // Sem existsSync antes: o arquivo pode sumir ou o OneDrive travá-lo (EBUSY) entre a checagem e a leitura.
  let st: ReturnType<typeof statSync>, text: string;
  try { st = statSync(src.path); text = readText(src.path); } catch { return []; }
  const fileHash = sha(text);
  const relativeSource = redact(path.relative(p.vault, src.path));
  const cacheKey = `${p.id}::${src.kind}::${src.agent}::${relativeSource}`;
  if (store.fileHash(cacheKey) === fileHash) return [];
  store.setFile(cacheKey, fileHash, st.mtime.toISOString());
  if (src.kind === 'tasks') return []; // TASKS vira quadro, não mensagens

  const known = new Set(p.agents.map((a) => a.id));
  const mtime = localIso(st.mtime);
  const seen = nowIso();
  const added: Entry[] = [];
  for (const s of splitSections(text)) {
    const ts = s.date ? `${s.date}T${s.time ?? '00:00'}:00` : mtime;
    const e = store.insert({
      project: p.id,
      source: relativeSource,
      kind: src.kind,
      agent: authorFor(src, s.agent, known),
      heading: s.heading,
      body: s.body.length > MAX_BODY ? s.body.slice(0, MAX_BODY) + '\n…[cortado pelo Agent Control]' : s.body,
      hash: s.hash,
      task: s.fields.task ?? null,
      status: canonicalStatus(s.fields.status) ?? statusInText(s.fields.task) ?? null,
      model: s.fields.model ?? null,
      ts,
      seen_at: seen,
      initial: initial ? 1 : 0,
    });
    if (e) added.push(e);
  }
  return added;
}

export function tasks(p: ProjectCfg): TaskRow[] {
  const gd = goalDir(p);
  const f = gd && path.join(gd, 'TASKS.md');
  return f && existsSync(f) ? parseTasks(readText(f)) : [];
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

export interface LockInfo { name: string; pid: number | null; alive: boolean }

export function locks(p: ProjectCfg): LockInfo[] {
  if (!p.orchestratorDir || !existsSync(p.orchestratorDir)) return [];
  return readdirSync(p.orchestratorDir)
    .filter((n) => n.endsWith('.lock'))
    .map((n) => {
      const pid = Number.parseInt((readSafe(path.join(p.orchestratorDir!, n)) ?? '').trim(), 10);
      return { name: n.replace(/^\.supreme-|\.lock$/g, ''), pid: Number.isNaN(pid) ? null : pid, alive: pidAlive(pid) };
    });
}

function tail(file: string, n: number): string[] {
  let text: string;
  try { text = readText(file); } catch { return []; }
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-n).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300));
}

export interface AgentView {
  id: string;
  name: string; // nome para as telas (Claude Code, Codex…)
  worktree: string | null;
  model: string | null; // active-model-<agent>.txt
  statusFileMtime: string | null;
  vaultCopyStale: boolean | null; // STATUS da worktree ≠ cópia no vault
  done: boolean; // marcador supreme-<AGENTE>.done
  lastLog: string[];
  latest: Pick<Entry, 'heading' | 'task' | 'status' | 'model' | 'ts'> | null;
}

/** Lê um arquivo sem derrubar o servidor: o OneDrive trava o arquivo enquanto sincroniza (EBUSY, 2026-10-01). */
function readSafe(f: string): string | null {
  try { return readFileSync(f, 'utf8'); } catch { return null; }
}

function mtimeOf(f: string): string | null {
  try { return localIso(statSync(f).mtime); } catch { return null; }
}

export function agents(store: Store, p: ProjectCfg): AgentView[] {
  const gd = goalDir(p);
  return p.agents.map((a) => {
    const statusFile = a.worktree ? path.join(a.worktree, '.ai-team', 'STATUS.md') : gd ? path.join(gd, 'AGENTS', `${a.id}-STATUS.md`) : null;
    const hasStatus = !!statusFile && existsSync(statusFile);
    let stale: boolean | null = null;
    if (a.worktree && gd && hasStatus) {
      const copy = path.join(gd, 'AGENTS', `${a.id}-STATUS.md`);
      const a1 = existsSync(copy) ? readSafe(copy) : null;
      const a2 = readSafe(statusFile!);
      stale = !existsSync(copy) ? true : a1 === null || a2 === null ? null : a1 !== a2;
    }
    const modelFile = p.modelsDir && path.join(p.modelsDir, `active-model-${a.id.toLowerCase()}.txt`);
    const latest = store.latestByAgent(p.id, a.id);
    return {
      id: a.id,
      name: agentName(a.id),
      worktree: a.worktree ?? null,
      model: modelFile ? (model => model ? redact(model).slice(0, 120) : null)(readSafe(modelFile)?.trim()) : null,
      statusFileMtime: hasStatus ? mtimeOf(statusFile!) : null,
      vaultCopyStale: stale,
      done: !!p.orchestratorDir && existsSync(path.join(p.orchestratorDir, `supreme-${a.id}.done`)),
      lastLog: p.orchestratorDir ? tail(path.join(p.orchestratorDir, `SUPREME-${a.id}.log`), 3) : [],
      latest: latest ? { heading: latest.heading, task: latest.task, status: latest.status ?? statusInText(latest.task ?? undefined) ?? null, model: latest.model, ts: latest.ts } : null,
    };
  });
}
