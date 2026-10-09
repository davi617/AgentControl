// Código ao vivo (v4.0): o que cada agente está mexendo no código agora, lido do git da worktree dele.
// A cada poucos segundos: arquivos alterados (git status + git diff --numstat contra o HEAD) e o último commit.
// O que mudou de uma leitura para a outra vira evento 'code' no JARVIS (SSE) e entra na linha do tempo.
// Só lê: nunca roda nada que altere a worktree. O diff passa pelo filtro de segredos antes de sair.

import { execFile } from 'node:child_process';
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import path from 'node:path';
import { agentName } from './agents.ts';
import type { ProjectCfg } from './config.ts';
import { localIso } from './date.ts';
import type { Jarvis } from './jarvis.ts';
import { redact } from './redact.ts';

export interface FileChange { path: string; status: string; adds: number; dels: number; binary?: boolean }
export interface AgentCode {
  agent: string; name: string; worktree: string;
  branch: string | null; head: string | null; headMsg: string | null; headAt: string | null;
  files: FileChange[]; adds: number; dels: number;
  /** Quando o conjunto de mudanças mudou pela última vez (agente mexendo agora = alguns segundos atrás). */
  changedAt: string | null;
  error?: string;
}
export interface CodeEvent { at: string; agent: string; name: string; kind: 'edit' | 'reverted' | 'commit'; path?: string; adds?: number; dels?: number; status?: string; msg?: string; hash?: string }

const POLL_MS = 3_000;
const FEED_MAX = 300;
const DIFF_MAX = 120_000;
/** Teto de arquivos por agente: uma pasta enorme fora do .gitignore não trava a tela. */
const FILES_MAX = 500;

type Git = (cwd: string, args: string[]) => Promise<string>;
const runGit: Git = (cwd, args) => new Promise((resolve, reject) =>
  execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    // diff --no-index sai com código 1 quando há diferença: a saída vai junto no erro.
    (e, out) => (e ? reject(Object.assign(e, { stdout: out })) : resolve(out))));

/** Linhas de um arquivo novo (não rastreado), lendo no máximo 1 MB. */
function countLines(file: string): { lines: number; binary: boolean } {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = Math.min(fstatSync(fd).size, 1_000_000);
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, 0);
    if (buf.includes(0)) return { lines: 0, binary: true };
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return { lines: n + (size && buf[size - 1] !== 10 ? 1 : 0), binary: false };
  } catch { return { lines: 0, binary: false }; } finally { if (fd !== undefined) closeSync(fd); }
}

const STATUS: Record<string, string> = { M: 'alterado', A: 'novo', D: 'apagado', R: 'renomeado', C: 'copiado', U: 'conflito', '?': 'novo' };

/** Lê o estado do código de uma worktree. */
export async function readWorktree(agent: string, wt: string, git: Git = runGit): Promise<Omit<AgentCode, 'changedAt'>> {
  const base = { agent, name: agentName(agent), worktree: wt, branch: null, head: null, headMsg: null, headAt: null, files: [], adds: 0, dels: 0 };
  try {
    const [status, numstat, head] = await Promise.all([
      git(wt, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
      git(wt, ['diff', 'HEAD', '--numstat', '-z', '--no-renames']).catch(() => ''),
      git(wt, ['log', '-1', '--format=%h%x00%s%x00%cI%x00%D']).catch(() => ''),
    ]);
    const counts = new Map<string, { adds: number; dels: number; binary: boolean }>();
    for (const rec of numstat.split('\0')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);
      if (m) counts.set(m[3], { adds: m[1] === '-' ? 0 : Number(m[1]), dels: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
    }
    const files: FileChange[] = [];
    for (const rec of status.split('\0')) {
      if (rec.length < 4) continue;
      if (files.length >= FILES_MAX) break;
      const xy = rec.slice(0, 2), p = rec.slice(3);
      const code = xy === '??' ? '?' : (xy[1] !== ' ' ? xy[1] : xy[0]);
      const c = counts.get(p) ?? (code === '?' ? (() => { const l = countLines(path.join(wt, p)); return { adds: l.lines, dels: 0, binary: l.binary }; })() : { adds: 0, dels: 0, binary: false });
      files.push({ path: p, status: STATUS[code] ?? code, adds: c.adds, dels: c.dels, ...(c.binary ? { binary: true } : {}) });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const [hash, msg, at, refs] = head.trim().split('\0');
    const branch = /HEAD -> ([^,]+)/.exec(refs ?? '')?.[1] ?? null;
    return { ...base, branch, head: hash || null, headMsg: msg ? redact(msg).slice(0, 200) : null, headAt: at || null, files, adds: files.reduce((s, f) => s + f.adds, 0), dels: files.reduce((s, f) => s + f.dels, 0) };
  } catch (e) {
    return { ...base, error: /not a git repository|cannot change to/i.test(String((e as Error).message)) ? 'pasta sem git' : 'git não respondeu' };
  }
}

/** O que mudou entre duas leituras do mesmo agente (vira linha do tempo). */
export function diffSnapshots(prev: AgentCode | undefined, next: Omit<AgentCode, 'changedAt'>, at = localIso()): CodeEvent[] {
  if (!prev) return [];
  const ev: CodeEvent[] = [];
  const who = { at, agent: next.agent, name: next.name };
  if (next.head && prev.head && next.head !== prev.head) ev.push({ ...who, kind: 'commit', hash: next.head, msg: next.headMsg ?? '' });
  const old = new Map(prev.files.map((f) => [f.path, f]));
  for (const f of next.files) {
    const o = old.get(f.path);
    if (!o || o.adds !== f.adds || o.dels !== f.dels || o.status !== f.status) ev.push({ ...who, kind: 'edit', path: f.path, adds: f.adds, dels: f.dels, status: f.status });
    old.delete(f.path);
  }
  // Sumiu da lista sem commit novo: o agente desfez a mudança.
  if (next.head === prev.head) for (const f of old.values()) ev.push({ ...who, kind: 'reverted', path: f.path });
  return ev;
}

export class LiveCode {
  private j: Jarvis;
  private git: Git;
  private snaps = new Map<string, Map<string, AgentCode>>();
  private feeds = new Map<string, CodeEvent[]>();
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(j: Jarvis, git: Git = runGit) { this.j = j; this.git = git; }

  private agentsOf(p: ProjectCfg) { return p.agents.filter((a) => a.worktree); }

  /** Liga a leitura periódica (na primeira consulta). Não segura o processo aberto. */
  start(ms = POLL_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), ms);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = undefined; }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try { for (const p of this.j.cfg.projects) await this.refresh(p); } finally { this.busy = false; }
  }

  async refresh(p: ProjectCfg): Promise<AgentCode[]> {
    const snaps = this.snaps.get(p.id) ?? new Map<string, AgentCode>();
    this.snaps.set(p.id, snaps);
    const feed = this.feeds.get(p.id) ?? [];
    this.feeds.set(p.id, feed);
    const now = localIso();
    const read = await Promise.all(this.agentsOf(p).map((a) => readWorktree(a.id, a.worktree!, this.git)));
    for (const r of read) {
      const prev = snaps.get(r.agent);
      const events = diffSnapshots(prev, r, now);
      const same = prev && !events.length && prev.error === r.error;
      const snap: AgentCode = { ...r, changedAt: same ? prev.changedAt : prev ? now : null };
      snaps.set(r.agent, snap);
      if (events.length) {
        feed.push(...events);
        if (feed.length > FEED_MAX) feed.splice(0, feed.length - FEED_MAX);
      }
      if (prev && !same) this.j.emit('code', { project: p.id, agent: snap, events });
    }
    return [...snaps.values()];
  }

  /** Estado atual de todos os agentes do projeto (lê na hora se ainda não leu). */
  async state(p: ProjectCfg): Promise<{ agents: AgentCode[]; feed: CodeEvent[] }> {
    this.start();
    if (!this.snaps.has(p.id)) await this.refresh(p);
    return { agents: [...(this.snaps.get(p.id)?.values() ?? [])], feed: [...(this.feeds.get(p.id) ?? [])].reverse() };
  }

  /**
   * Diff de UM arquivo que está na lista de mudanças do agente (nada fora dela: a rota não vira leitor de arquivos).
   * Filtrado (segredos) e cortado em ~120 KB.
   */
  async diff(p: ProjectCfg, agent: string, file: string): Promise<{ agent: string; name: string; path: string; diff: string; cortado: boolean }> {
    const a = this.agentsOf(p).find((x) => x.id === agent.toUpperCase());
    if (!a) throw new Error('agente sem worktree');
    const snap = (await this.state(p)).agents.find((s) => s.agent === a.id);
    const f = snap?.files.find((x) => x.path === file);
    if (!f) throw new Error('esse arquivo não está entre as mudanças do agente');
    let out: string;
    if (f.binary) out = '(arquivo binário)';
    else if (f.status === 'novo' && !(await this.git(a.worktree!, ['ls-files', '--', f.path])).trim()) {
      out = await this.git(a.worktree!, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', f.path]).catch((e: { stdout?: string }) => e.stdout ?? '');
    } else out = await this.git(a.worktree!, ['diff', 'HEAD', '--no-renames', '--', f.path]);
    const cortado = out.length > DIFF_MAX;
    return { agent: a.id, name: agentName(a.id), path: f.path, diff: redact(out.slice(0, DIFF_MAX)), cortado };
  }
}

const lives = new WeakMap<Jarvis, LiveCode>();
export function liveFor(j: Jarvis): LiveCode {
  let l = lives.get(j);
  if (!l) { l = new LiveCode(j); lives.set(j, l); }
  return l;
}
