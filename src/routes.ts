// Rotas da API em tabela (v4.0): método, caminho, papel mínimo, limite do corpo e o handler.
// Antes eram 560 linhas de `if` com listas de POST separadas da checagem de papel; uma rota nova esquecida numa
// das listas já deixou um membro mandar ordem em nome do dono. Aqui o papel é obrigatório em cada linha, e o
// teste da matriz (test/routes.test.ts) passa por todas elas com cada papel.

import { readFileSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { callPeople, callsFor } from './call.ts';
import type { ProjectCfg } from './config.ts';
import { postChat } from './chat.ts';
import { setPause } from './control.ts';
import { about, commandsPerDay, gateUsage, listCalls } from './extras.ts';
import { health } from './health.ts';
import type { Jarvis } from './jarvis.ts';
import { agentLimits } from './limits.ts';
import { lookOwnerOk, sanitizeLook } from './looks.ts';
import { modelChoices, setModel } from './models.ts';
import { addNote, syncNotesFile } from './notes.ts';
import { planAllowsDual, type PlanStore, publicPlan } from './plans.ts';
import { replyToDono } from './reply.ts';
import { searchAll } from './search.ts';
import type { Sessions } from './sessions.ts';
import { localIso } from './sources.ts';
import { mentions, OWNER, type Role, type Team, type Who } from './team.ts';
import { readNote, searchNotes } from './vault.ts';

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  // Microfone só para a chamada; câmera, localização, pagamento e USB desligados. Nada de outra origem lê ou abre a sala.
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Conexões /events abertas ao mesmo tempo por pessoa: cada uma prende listeners no JARVIS. */
export const MAX_STREAMS = 12;

/** Erro com o código HTTP da resposta (o resto vira o `fail` da rota, 409 por padrão). */
export class HttpError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export interface Ctx {
  j: Jarvis;
  who: Who;
  sessionId?: string;
  url: URL;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  send: (code: number, data: unknown) => void;
  /** Corpo JSON já lido (só POST). */
  body: Record<string, unknown>;
  team: Team;
  sessions: Sessions;
  plans: PlanStore;
  csrf: string;
  endSession: (sid: string) => void;
  streams: Map<string, Set<http.ServerResponse>>;
  bySession: Map<string, Set<http.ServerResponse>>;
  /** Projeto do pedido (corpo no POST, ?project= no GET); 404 se não existe. */
  project(): ProjectCfg;
}

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  /** Papel mínimo: leitura < membro < dono. Toda escrita pede pelo menos membro. */
  role: Role;
  /** Limite do corpo (POST), em bytes. Padrão 4 KB. */
  body?: number;
  /** Mensagem do 413. */
  tooBig?: string;
  /** Código para erro comum do handler (padrão 409). */
  fail?: number;
  run: (c: Ctx) => unknown;
}

const RANK: Record<Role, number> = { leitura: 0, membro: 1, dono: 2 };
export const roleAllows = (have: Role, need: Role) => (RANK[have] ?? -1) >= RANK[need];

const str = (v: unknown, def = '') => String(v ?? def);

function modelsDir(c: Ctx, msg: string): string {
  const p = c.project();
  if (!p.modelsDir) throw new HttpError(404, msg);
  return p.modelsDir;
}

/** Linha na auditoria em nome de quem fez o pedido. Ações do time e da licença não têm projeto (''). */
function audit(c: Ctx, action: string, target = '', detail = '', project = '') {
  c.j.store.audit({ project, actor: c.who.id, action, target, detail });
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // Fórmula no começo da célula vira texto (=, +, -, @ abririam como fórmula no Excel/Sheets).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Ordem de alguém do time leva o nome junto (o agente e o histórico sabem quem pediu). */
const tagged = (who: Who, text: string) => (who.owner ? text : `[${who.name}] ${text}`);

export const ROUTES: Route[] = [
  // ---------- leitura ----------
  { method: 'GET', path: '/api/team', role: 'leitura', run: (c) => c.send(200, { me: c.who, people: c.team.list(), plano: { ...publicPlan(c.plans.state()), pagarUrl: c.j.cfg.pagarUrl ?? null } }) },
  {
    // Aparelhos conectados: o dono vê todos; cada pessoa, os dela.
    method: 'GET', path: '/api/sessions', role: 'leitura',
    run: (c) => c.send(200, c.sessions.view(c.who.owner ? undefined : c.who.id, c.sessionId).map((s) => ({ ...s, nome: s.person === OWNER.id ? 'Você' : c.team.name(s.person) ?? s.person }))),
  },
  { method: 'GET', path: '/api/plan', role: 'leitura', run: (c) => c.send(200, { ...publicPlan(c.plans.state()), pagarUrl: c.j.cfg.pagarUrl ?? null }) },
  // Outro site não consegue ler esta resposta (sem CORS + checagem de Host), então o token não vaza.
  { method: 'GET', path: '/api/session', role: 'leitura', run: (c) => c.send(200, { csrf: c.csrf }) },
  { method: 'GET', path: '/api/app/version', role: 'leitura', run: (c) => c.send(200, appInfo(c)) },
  {
    // Atualização do app do celular: tools/publicar-app.ps1 põe jarvis.apk + version.json em data/app.
    method: 'GET', path: '/api/app/apk', role: 'leitura',
    run: (c) => {
      appInfo(c);
      let apk: Buffer;
      try { apk = readFileSync(path.join(path.dirname(c.j.cfg.db), 'app', 'jarvis.apk')); } catch { throw new HttpError(404, 'nenhum app publicado'); }
      c.res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': apk.length });
      c.res.end(apk);
    },
  },
  { method: 'GET', path: '/api/projects', role: 'leitura', run: (c) => c.send(200, c.j.cfg.projects.map((p) => ({ id: p.id, name: p.name, goal: c.j.state(p).goal }))) },
  { method: 'GET', path: '/api/state', role: 'leitura', run: (c) => c.send(200, c.j.state(c.project())) },
  {
    method: 'GET', path: '/api/feed', role: 'leitura',
    run: (c) => {
      const q = c.url.searchParams;
      c.send(200, c.j.store.feed(c.project().id, { agent: q.get('agent') || undefined, before: Number(q.get('before')) || undefined, limit: Number(q.get('limit')) || undefined }));
    },
  },
  { method: 'GET', path: '/api/chat', role: 'leitura', run: (c) => c.send(200, c.j.store.chat(c.project().id, 300)) },
  {
    // Pendentes levam quem já aprovou e quantos "sim" faltam (aprovação em dupla: "1 de 2").
    method: 'GET', path: '/api/commands', role: 'leitura',
    run: (c) => {
      const p = c.project();
      const precisa = c.j.dualApproval(p) && planAllowsDual(c.plans.state()) ? 2 : 1;
      c.send(200, c.j.store.commands(p.id).map((x) => x.approval !== 'pending' ? x
        : { ...x, precisa, votos: c.j.store.votes(x.code).filter((v) => v.decision === 'approve').map((v) => v.person) }));
    },
  },
  { method: 'GET', path: '/api/call/people', role: 'leitura', run: (c) => c.send(200, callPeople(c.project())) },
  { method: 'GET', path: '/api/call', role: 'leitura', run: (c) => c.send(200, callsFor(c.j).get(c.project().id) ?? null) },
  { method: 'GET', path: '/api/health', role: 'leitura', fail: 500, run: async (c) => c.send(200, await health(c.project(), c.j.cfg.summary)) },
  {
    method: 'GET', path: '/api/limits', role: 'leitura',
    run: async (c) => {
      const p = c.project();
      try { c.send(200, await agentLimits(p, c.j.cfg.summary)); } catch { c.send(503, { error: 'Cotas temporariamente indisponíveis.' }); }
    },
  },
  { method: 'GET', path: '/api/models', role: 'leitura', run: (c) => { const p = c.project(); c.send(200, p.modelsDir ? modelChoices(p.modelsDir) : []); } },
  { method: 'GET', path: '/api/vault/search', role: 'leitura', run: (c) => c.send(200, searchNotes(c.project().vault, (c.url.searchParams.get('q') ?? '').slice(0, 200))) },
  { method: 'GET', path: '/api/search', role: 'leitura', run: (c) => c.send(200, searchAll(c.j, c.project(), (c.url.searchParams.get('q') ?? '').slice(0, 200))) },
  { method: 'GET', path: '/api/notes', role: 'leitura', run: (c) => c.send(200, c.j.store.notes(c.project().id)) },
  { method: 'GET', path: '/api/vault/favorites', role: 'leitura', run: (c) => c.send(200, c.j.store.favorites(c.project().id)) },
  { method: 'GET', path: '/api/shortcuts', role: 'leitura', run: (c) => c.send(200, c.j.store.shortcuts(c.project().id)) },
  { method: 'GET', path: '/api/alerts/prefs', role: 'leitura', run: (c) => c.send(200, c.j.store.alertPrefs(c.project().id)) },
  { method: 'GET', path: '/api/looks', role: 'leitura', run: (c) => c.send(200, c.j.store.looks(c.project().id)) },
  {
    method: 'GET', path: '/api/usage', role: 'leitura',
    run: async (c) => {
      c.project();
      const dias = Math.min(Math.max(Number(c.url.searchParams.get('dias')) || 7, 1), 30);
      try { c.send(200, await gateUsage(c.j.cfg.summary, dias)); } catch (e) { c.send(502, { error: `fila sem resposta: ${(e as Error).message}` }); }
    },
  },
  { method: 'GET', path: '/api/calls', role: 'leitura', run: (c) => c.send(200, listCalls(c.project())) },
  { method: 'GET', path: '/api/about', role: 'leitura', run: (c) => { c.project(); c.send(200, about(c.j.cfg.db)); } },
  {
    method: 'GET', path: '/api/stats', role: 'leitura',
    run: (c) => {
      const p = c.project();
      const dias = Math.min(Math.max(Number(c.url.searchParams.get('dias')) || 7, 1), 60);
      // Hora local, como os registros (created_at/ts): com toISOString (UTC) o corte errava por algumas horas.
      const since = localIso(new Date(Date.now() - dias * 86_400_000));
      const cmds = c.j.store.commandsSince(p.id, since);
      c.send(200, {
        dias,
        agentes: c.j.store.agentStats(p.id, since),
        comandos: { total: cmds.length, done: cmds.filter((x) => x.status === 'DONE').length, bloqueados: cmds.filter((x) => /^(BLOCKED|FAILED)/.test(x.status)).length, protegidos: cmds.filter((x) => x.requires_approval).length },
        porDia: commandsPerDay(c.j.store, p, Math.min(dias, 30)),
      });
    },
  },
  {
    method: 'GET', path: '/api/vault/note', role: 'leitura',
    run: (c) => {
      const n = readNote(c.project().vault, c.url.searchParams.get('path') ?? '');
      if (n) c.send(200, n); else c.send(404, { error: 'nota não encontrada' });
    },
  },
  { method: 'GET', path: '/api/summary', role: 'leitura', run: (c) => { const p = c.project(); c.send(200, { deterministic: c.j.deterministicSummary(p), llm: c.j.store.summaries(p.id, 10).filter((s) => s.kind === 'llm') }); } },
  { method: 'GET', path: '/events', role: 'leitura', run: events },

  // ---------- membro: manda ordem, fala, anota ----------
  {
    method: 'POST', path: '/api/commands', role: 'membro', body: 16_384, tooBig: 'comando grande demais',
    run: (c) => {
      const p = c.project();
      const text = str(c.body.text).trim();
      const to = str(c.body.to, 'LEADER');
      if (!text) throw new HttpError(400, 'comando vazio');
      if (!new Set(['LEADER', ...p.agents.map((a) => a.id)]).has(to)) throw new HttpError(400, 'destino desconhecido');
      const cmd = c.j.command(p, tagged(c.who, text), to, c.who.id);
      c.send(201, {
        command: cmd,
        reply: cmd.requires_approval
          ? `Comando ${cmd.code} registrado. Ele envolve ação protegida (deploy/push/merge…): fica PARADO até você aprovar.`
          : `Comando ${cmd.code} registrado para ${to}. Aguardando ACK do líder.`,
      });
    },
  },
  {
    method: 'POST', path: '/api/chat', role: 'membro', body: 32_768, tooBig: 'mensagem grande demais',
    run: (c) => {
      const p = c.project();
      const text = str(c.body.text).trim();
      const as = c.body.as === 'CHATGPT' && c.who.owner ? 'CHATGPT' : c.who.id;
      const to = str(c.body.to, 'TODOS').toUpperCase();
      if (!text) throw new HttpError(400, 'mensagem vazia');
      if (!/^[A-Z0-9_,\s-]{2,120}$/.test(to)) throw new HttpError(400, 'destino inválido');
      c.j.say(p, as, to, str(c.body.assunto), text);
      c.send(201, { ok: true, mentions: mentions(text, [...c.team.ids(), ...p.agents.map((a) => a.id)]) });
      // O JARVIS responde o dono na sala (os agentes não leem o chat).
      if (as !== 'CHATGPT') void replyToDono(c.j, p, text, c.j.fetchImpl, c.who.owner ? undefined : c.who.name).catch((e) => console.error('[resposta]', (e as Error).message));
    },
  },
  { method: 'POST', path: '/api/notes', role: 'membro', run: (c) => c.send(201, addNote(c.j.store, c.project(), str(c.body.text))) },
  {
    method: 'POST', path: '/api/notes/done', role: 'membro',
    run: (c) => { const p = c.project(); c.j.store.setNoteDone(p.id, Number(c.body.id), c.body.done !== false); syncNotesFile(c.j.store, p); c.send(200, { ok: true }); },
  },
  {
    method: 'POST', path: '/api/notes/delete', role: 'membro',
    run: (c) => { const p = c.project(); c.j.store.deleteNote(p.id, Number(c.body.id)); syncNotesFile(c.j.store, p); c.send(200, { ok: true }); },
  },
  {
    method: 'POST', path: '/api/vault/favorite', role: 'membro',
    run: (c) => {
      const p = c.project();
      const fp = str(c.body.path);
      // Só nota que existe no vault (mesma checagem da leitura): nada de caminho inventado na lista.
      if (!fp || !readNote(p.vault, fp)) throw new HttpError(400, 'nota não encontrada no vault');
      if (c.j.store.isFavorite(p.id, fp)) c.j.store.removeFavorite(p.id, fp);
      else c.j.store.addFavorite(p.id, fp, str(c.body.title, fp));
      c.send(200, { favorito: c.j.store.isFavorite(p.id, fp) });
    },
  },
  {
    method: 'POST', path: '/api/shortcuts/run', role: 'membro',
    run: (c) => {
      const p = c.project();
      const sc = c.j.store.shortcuts(p.id).find((x) => x.id === Number(c.body.id));
      if (!sc) throw new HttpError(404, 'atalho não encontrado');
      if (!new Set(['LEADER', ...p.agents.map((a) => a.id)]).has(sc.target)) throw new HttpError(400, 'destino do atalho não existe mais');
      // Atalho rodado por alguém do time também leva o nome (antes saía como se fosse do dono).
      const cmd = c.j.command(p, tagged(c.who, sc.text), sc.target, c.who.id);
      c.send(201, { command: cmd, reply: `Comando ${cmd.code} registrado para ${sc.target} (atalho "${sc.label}").` });
    },
  },
  {
    method: 'POST', path: '/api/call/attach', role: 'membro', body: 7_500_000, tooBig: 'anexo grande demais (máx. 5 MB)',
    run: async (c) => c.send(200, await callsFor(c.j).attach(c.project(), str(c.body.name, 'anexo'), str(c.body.mime), Buffer.from(str(c.body.data), 'base64'))),
  },
  ...callRoutes(),

  // ---------- dono: aprova, mexe no time, nos agentes e na configuração ----------
  {
    method: 'POST', path: '/api/commands/decide', role: 'dono', body: 2_048,
    run: (c) => {
      const p = c.project();
      const code = str(c.body.code);
      if (!/^J-\d{3,}$/.test(code) || !['approve', 'reject'].includes(str(c.body.decision))) throw new HttpError(400, 'pedido inválido');
      const needed = c.j.dualApproval(p) && planAllowsDual(c.plans.state()) ? 2 : 1;
      const cmd = c.j.decide(p, code, c.body.decision as 'approve' | 'reject', c.who, needed);
      const reply = cmd.approval === 'approved' ? `${code} aprovado. Vale só para este comando.`
        : cmd.approval === 'rejected' ? `${code} recusado. Os agentes não devem executar.`
        : `${code}: sua aprovação foi registrada. Falta mais uma pessoa aprovar (aprovação em dupla).`;
      c.send(200, { command: cmd, reply });
    },
  },
  {
    // Personagens do prédio são do dono (antes qualquer membro trocava o de todo mundo).
    method: 'POST', path: '/api/looks', role: 'dono',
    run: (c) => {
      const p = c.project();
      // personagem do prédio: { id, look } grava; { id, look: null } volta ao sorteado pelo nome
      if (!lookOwnerOk(c.body.id, p.agents.map((a) => a.id))) throw new HttpError(400, 'personagem de quem?');
      const look = c.body.look === null ? null : sanitizeLook(c.body.look);
      if (c.body.look !== null && !look) throw new HttpError(400, 'personagem inválido');
      c.j.store.setLook(p.id, c.body.id as string, look);
      c.send(200, c.j.store.looks(p.id));
    },
  },
  {
    // Atalho vira ordem com um toque de qualquer pessoa do time: criar e apagar é do dono.
    method: 'POST', path: '/api/shortcuts', role: 'dono',
    run: (c) => {
      const p = c.project();
      const label = str(c.body.label).trim().slice(0, 60);
      const text = str(c.body.text).trim().slice(0, 500);
      const target = str(c.body.target, 'LEADER').toUpperCase();
      if (!label || !text) throw new HttpError(400, 'preencha nome e texto do atalho');
      c.send(201, c.j.store.addShortcut(p.id, label, text, target));
    },
  },
  { method: 'POST', path: '/api/shortcuts/delete', role: 'dono', run: (c) => { c.j.store.deleteShortcut(c.project().id, Number(c.body.id)); c.send(200, { ok: true }); } },
  {
    // Avisos que chegam no celular do dono.
    method: 'POST', path: '/api/alerts/prefs', role: 'dono',
    run: (c) => {
      const p = c.project();
      c.j.store.setAlertPrefs(p.id, c.body.prefs && typeof c.body.prefs === 'object' ? c.body.prefs as Record<string, boolean> : {});
      c.send(200, c.j.store.alertPrefs(p.id));
    },
  },
  {
    method: 'POST', path: '/api/agents/pause', role: 'dono', body: 1_024,
    run: (c) => {
      const st = setPause(modelsDir(c, 'projeto sem pasta dos agentes'), c.body.on === true, c.body.agora === true);
      audit(c, st.paused ? 'pausou' : 'retomou', 'agentes', st.agora ? 'agora' : '', c.project().id);
      c.send(200, st);
    },
  },
  {
    method: 'POST', path: '/api/models', role: 'dono', body: 2_048, fail: 400,
    run: async (c) => {
      const m = await setModel(modelsDir(c, 'projeto sem pasta de modelos'), str(c.body.agent), str(c.body.model), c.body.effort ? str(c.body.effort) : undefined);
      audit(c, 'modelo', m.id, `${m.current ?? ''} ${m.effort ?? ''}`.trim(), c.project().id);
      c.send(200, m);
    },
  },
  {
    method: 'POST', path: '/api/sessions/revoke', role: 'dono', fail: 400,
    run: (c) => {
      const sid = str(c.body.id);
      const s = c.sessions.get(sid);
      if (!c.sessions.revoke(sid)) throw new HttpError(404, 'aparelho não encontrado');
      c.endSession(sid);
      audit(c, 'desconectou aparelho', s?.person ?? '', s?.device ?? '');
      c.send(200, { ok: true });
    },
  },
  {
    method: 'POST', path: '/api/plan/license', role: 'dono', fail: 400,
    run: (c) => { const st = c.plans.install(str(c.body.license)); audit(c, 'licença', st.plan.id, st.license?.validaAte ?? ''); c.send(200, publicPlan(st)); },
  },
  {
    method: 'POST', path: '/api/team/invite', role: 'dono', fail: 400,
    run: (c) => {
      // Freemium: o plano define quantas pessoas cabem no time (contando o dono).
      const st = c.plans.state();
      if (c.team.ids().length + 1 >= st.pessoas) throw new HttpError(402, `o plano ${st.plan.nome} permite ${st.pessoas} pessoas no time; para convidar mais, mude de plano`);
      const { person, token } = c.team.invite(str(c.body.name), str(c.body.role, 'membro') as Role);
      audit(c, 'convidou', person.id, person.role);
      const r = c.j.cfg.remote;
      // O token sai só nesta resposta: quem convidou passa para a pessoa (QR/link no app).
      c.send(201, { person, token, remote: r?.enabled ? { host: r.host, port: r.port ?? c.j.cfg.port } : null });
    },
  },
  {
    method: 'POST', path: '/api/team/remove', role: 'dono', fail: 400,
    run: (c) => {
      const id = str(c.body.id).toUpperCase();
      const ok = c.team.remove(id);
      if (ok) audit(c, 'removeu', id);
      c.send(ok ? 200 : 404, { ok: true });
    },
  },
  {
    method: 'POST', path: '/api/team/role', role: 'dono', fail: 400,
    run: (c) => {
      const id = str(c.body.id).toUpperCase();
      const ok = c.team.setRole(id, str(c.body.role) as Role);
      if (ok) audit(c, 'mudou papel', id, str(c.body.role));
      c.send(ok ? 200 : 404, { ok: true });
    },
  },

  // ---------- v4.0: ajustes, auditoria e pânico ----------
  {
    method: 'GET', path: '/api/settings', role: 'leitura',
    run: (c) => {
      const p = c.project();
      const disponivel = planAllowsDual(c.plans.state());
      c.send(200, { aprovacaoDupla: disponivel && c.j.dualApproval(p), aprovacaoDuplaDisponivel: disponivel, panico: c.j.panic() });
    },
  },
  {
    method: 'POST', path: '/api/settings', role: 'dono', body: 1_024,
    run: (c) => {
      const p = c.project();
      if (typeof c.body.aprovacaoDupla === 'boolean') {
        if (c.body.aprovacaoDupla && !planAllowsDual(c.plans.state())) throw new HttpError(402, 'a aprovação em dupla faz parte do plano Time');
        c.j.store.setSetting(p.id, 'aprovacaoDupla', c.body.aprovacaoDupla ? '1' : '0');
        audit(c, 'aprovação em dupla', c.body.aprovacaoDupla ? 'ligou' : 'desligou', '', p.id);
      }
      c.send(200, { aprovacaoDupla: c.j.dualApproval(p), aprovacaoDuplaDisponivel: planAllowsDual(c.plans.state()), panico: c.j.panic() });
    },
  },
  {
    // Log de auditoria (só acréscimo, hash encadeado). ?formato=csv baixa a planilha.
    method: 'GET', path: '/api/audit', role: 'dono',
    run: (c) => {
      const p = c.project();
      const csv = c.url.searchParams.get('formato') === 'csv';
      const rows = c.j.store.auditLog(p.id, csv ? 100_000 : Number(c.url.searchParams.get('limit')) || 200);
      if (!csv) { c.send(200, { verificacao: c.j.store.verifyAudit(), linhas: rows }); return; }
      const lines = [['id', 'quando', 'projeto', 'quem', 'acao', 'alvo', 'detalhe', 'hash'].join(',')];
      for (const r of rows.reverse()) lines.push([r.id, r.at, r.project, r.actor, r.action, r.target, r.detail, r.hash].map(csvCell).join(','));
      c.res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="auditoria-${p.id}.csv"` });
      c.res.end('\uFEFF' + lines.join('\r\n') + '\r\n');
    },
  },
  {
    /**
     * Botão de pânico: para TODOS os agentes agora (corta a rodada em andamento), derruba os aparelhos conectados
     * (menos o de quem apertou) e fecha o acesso de quem não é dono até desligar o pânico. { on: false } desfaz.
     */
    method: 'POST', path: '/api/panic', role: 'dono', body: 1_024,
    run: (c) => {
      const on = c.body.on !== false;
      c.j.setPanic(on ? { by: c.who.id, at: new Date().toISOString() } : null);
      const pausados: string[] = [];
      for (const p of c.j.cfg.projects) {
        if (p.modelsDir) { try { setPause(p.modelsDir, on, true); pausados.push(p.id); } catch (e) { console.error('[pânico]', (e as Error).message); } }
      }
      let aparelhos = 0;
      if (on) {
        for (const s of c.sessions.view()) {
          if (s.id === c.sessionId) continue;
          c.sessions.revoke(s.id); c.endSession(s.id); aparelhos++;
        }
        for (const [id, set] of c.streams) {
          if (id === c.who.id) continue;
          for (const r of set) r.end();
          c.streams.delete(id);
        }
      }
      for (const p of c.j.cfg.projects) {
        try { postChat(p, 'JARVIS', 'TODOS', on ? 'pânico' : 'pânico desligado', on ? `PÂNICO acionado por ${c.who.name}: todos os agentes foram parados agora e os aparelhos conectados foram desligados. Ninguém além do dono entra até desligar.` : `${c.who.name} desligou o pânico. Os agentes voltam na próxima rodada.`); } catch { /* sem sala */ }
        c.j.emit('panic', { project: p.id, on, by: c.who.id });
      }
      audit(c, on ? 'pânico' : 'fim do pânico', '', `${pausados.length} projeto(s) pausado(s), ${aparelhos} aparelho(s) desligado(s)`);
      c.send(200, { panico: c.j.panic(), pausados, aparelhos });
    },
  },
];

/** Chamada: membro fala e anda com a pauta; quem expulsa ou encerra também é do time (o dono vê tudo na sala). */
function callRoutes(): Route[] {
  const r = (p: string, run: (c: Ctx, text: string) => unknown): Route => ({
    method: 'POST', path: `/api/call/${p}`, role: 'membro', body: 8_192,
    run: (c) => run(c, str(c.body.text).trim().slice(0, 2000)),
  });
  return [
    r('start', (c, text) => {
      if (!text) throw new HttpError(400, 'diga o assunto da chamada');
      const modo = ['debate', 'brainstorm', 'revisao', 'goal'].includes(str(c.body.modo)) ? c.body.modo : 'debate';
      c.send(201, callsFor(c.j).start(c.project(), text, Array.isArray(c.body.who) ? c.body.who.map(String).slice(0, 12) : [], modo as 'debate'));
    }),
    r('say', (c, text) => {
      if (!text) throw new HttpError(400, 'fala vazia');
      c.send(200, callsFor(c.j).say(c.project(), text, c.who.owner ? undefined : c.who.id));
    }),
    r('next', async (c) => { const p = c.project(); c.send(200, { turn: await callsFor(c.j).next(p), call: callsFor(c.j).get(p.id) ?? null }); }),
    r('round', (c) => c.send(200, callsFor(c.j).roundAll(c.project()))),
    r('turn', (c) => c.send(200, callsFor(c.j).passTurn(c.project(), str(c.body.agent)))),
    r('kick', (c) => c.send(200, callsFor(c.j).leave(c.project(), str(c.body.agent)))),
    r('end', (c) => c.send(200, callsFor(c.j).end(c.project()) ?? null)),
  ];
}

function appInfo(c: Ctx): { versionCode: number; versionName: string; sha256: string; size: number } {
  try { return JSON.parse(readFileSync(path.join(path.dirname(c.j.cfg.db), 'app', 'version.json'), 'utf8')); } catch { throw new HttpError(404, 'nenhum app publicado'); }
}

/** SSE: novidades do projeto ao vivo. Teto de MAX_STREAMS por pessoa; sair do time ou do aparelho fecha na hora. */
function events(c: Ctx) {
  const p = c.project();
  const { who, res, req, sessionId } = c;
  const mine = c.streams.get(who.id) ?? new Set<http.ServerResponse>();
  if (mine.size >= MAX_STREAMS) throw new HttpError(429, 'conexões demais abertas; feche outra aba');
  mine.add(res);
  c.streams.set(who.id, mine);
  if (sessionId) { const ss = c.bySession.get(sessionId) ?? new Set(); ss.add(res); c.bySession.set(sessionId, ss); }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const push = (type: string) => (ev: { project: string }) => {
    if (ev.project !== p.id) return;
    res.write(`event: ${type}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  const handlers = Object.fromEntries(['entries', 'agents', 'tasks', 'summary', 'commands', 'chat', 'call', 'panic'].map((k) => [k, push(k)]));
  for (const [k, h] of Object.entries(handlers)) c.j.on(k, h);
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    mine.delete(res);
    if (sessionId) c.bySession.get(sessionId)?.delete(res);
    if (!mine.size && c.streams.get(who.id) === mine) c.streams.delete(who.id);
    clearInterval(ping);
    for (const [k, h] of Object.entries(handlers)) c.j.off(k, h);
  });
}

const byKey = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r]));
export const findRoute = (method: string, pathname: string) => byKey.get(`${method} ${pathname}`);
