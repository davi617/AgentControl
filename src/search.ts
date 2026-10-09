// Busca única: sala, comandos, tarefas e o cérebro (vault), numa lista só (pedido do dono: "achar tudo num lugar").

import type { ProjectCfg } from './config.ts';
import type { Jarvis } from './jarvis.ts';
import { chatMeta } from './chat.ts';
import { searchNotes } from './vault.ts';

export interface SearchHit { kind: 'sala' | 'comando' | 'tarefa' | 'nota'; title: string; snippet: string; ref: string }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchAll(j: Pick<Jarvis, 'store' | 'state'>, p: ProjectCfg, q: string, limit = 30): SearchHit[] {
  const term = fold(q.trim());
  if (!term) return [];
  // Cada fonte tem sua cota: 30 mensagens da sala não escondem mais o comando, a tarefa e a nota.
  const per = Math.ceil(limit / 3);
  const out: SearchHit[] = [];
  const take = (kind: SearchHit['kind'], hits: SearchHit[]) => out.push(...hits.filter((h) => h.kind === kind).slice(0, per));
  const sala: SearchHit[] = [], cmds: SearchHit[] = [], tarefas: SearchHit[] = [], notas: SearchHit[] = [];

  for (const e of j.store.chat(p.id, 2000)) {
    const m = chatMeta(e.body);
    if (fold(`${e.agent} ${m.text}`).includes(term)) sala.push({ kind: 'sala', title: e.agent, snippet: m.text.slice(0, 180), ref: String(e.id) });
  }
  for (const c of j.store.commands(p.id, 500)) {
    if (fold(`${c.code} ${c.target} ${c.text}`).includes(term)) cmds.push({ kind: 'comando', title: c.code, snippet: c.text.slice(0, 180), ref: c.code });
  }
  for (const t of j.state(p).tasks ?? []) {
    if (fold(`${t.id} ${t.owner} ${t.task}`).includes(term)) tarefas.push({ kind: 'tarefa', title: t.id, snippet: t.task.slice(0, 180), ref: t.id });
  }
  for (const n of searchNotes(p.vault, q, 15).hits) notas.push({ kind: 'nota', title: n.title, snippet: n.snippet || n.folder, ref: n.path });

  take('sala', sala); take('comando', cmds); take('tarefa', tarefas); take('nota', notas);
  return out.slice(0, limit);
}
