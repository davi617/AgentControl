import type { ProjectCfg } from './config.ts';
import type { Jarvis } from './jarvis.ts';
import { canonicalStatus } from './parser.ts';
import { localDay } from './date.ts';

export type Lane = 'waiting' | 'working' | 'blocked' | 'review' | 'done';

/** Estados desconhecidos ficam visíveis na fila, sem inventar trabalho concluído. */
export function taskLane(raw: string | null | undefined): Lane {
  const status = canonicalStatus(raw ?? undefined);
  if (status === 'DONE') return 'done';
  if (status === 'REVIEW') return 'review';
  if (['BLOCKED', 'FAILED', 'STOPPED', 'NEEDS_HUMAN_REVIEW', 'VIOLATION', 'AWAITING_APPROVAL'].includes(status ?? '')) return 'blocked';
  if (status === 'WORKING') return 'working';
  return 'waiting';
}

/** Retrato local para navegador, desktop e celular; não consulta provedores nem inicia agentes. */
export function overview(j: Pick<Jarvis, 'state' | 'store'>, p: ProjectCfg, now = new Date()) {
  const state = j.state(p);
  const tasks = state.tasks.map((t) => ({ ...t, lane: taskLane(t.status) }));
  const lanes: Record<Lane, number> = { waiting: 0, working: 0, blocked: 0, review: 0, done: 0 };
  for (const t of tasks) lanes[t.lane]++;
  const day = localDay(now); // comandos seguem o relógio local do servidor (nowIso).
  // Conta todo o histórico em SQL: o limite da lista não altera os indicadores.
  const counts = j.store.db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(approval = 'pending'), 0) AS pending,
    COALESCE(SUM(status = 'WORKING'), 0) AS working,
    COALESCE(SUM(status IN ('BLOCKED', 'FAILED', 'VIOLATION')), 0) AS blocked,
    COALESCE(SUM(status = 'DONE' AND substr(updated_at, 1, 10) = ?), 0) AS doneToday
    FROM commands WHERE project = ?`).get(day, p.id) as Record<string, number>;
  const pending = j.store.db.prepare("SELECT * FROM commands WHERE project = ? AND approval = 'pending' ORDER BY id DESC LIMIT 20").all(p.id);
  return {
    project: { id: p.id, name: p.name },
    generatedAt: now.toISOString(), day, goal: state.goal,
    progress: { total: tasks.length, ...lanes, percent: tasks.length ? Math.round(lanes.done / tasks.length * 100) : 0 },
    agents: state.agents.map((a) => ({
      id: a.id, model: a.model ?? a.latest?.model ?? null, status: a.latest?.status ?? null,
      task: a.latest?.task ?? null, updatedAt: a.statusFileMtime,
      lane: taskLane(a.latest?.status), vaultCopyStale: a.vaultCopyStale,
      hasWorktree: !!a.worktree,
    })),
    tasks, commands: { counts, recent: j.store.commands(p.id, 30), pending },
    activity: j.store.feed(p.id, { limit: 12 }).map((e) => ({ id: e.id, agent: e.agent, kind: e.kind, heading: e.heading, status: e.status, ts: e.ts })),
    alerts: state.locks.filter((l) => !l.alive).map((l) => `Lock ${l.name}: o processo ${l.pid ?? '?'} não existe mais.`),
  };
}
