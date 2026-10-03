import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callPeople, callsFor } from './call.ts';
import { health } from './health.ts';
import { agentLimits } from './limits.ts';
import type { Jarvis } from './jarvis.ts';
import { replyToDono } from './reply.ts';
import { readNote, searchNotes } from './vault.ts';
import { modelChoices, setModel } from './models.ts';
import { setPause } from './control.ts';
import { addNote, syncNotesFile } from './notes.ts';
import { searchAll } from './search.ts';
import { about, commandsPerDay, gateUsage, listCalls } from './extras.ts';
import { OWNER, mentions, teamFor, type Role, type Who } from './team.ts';

const TEAM_POSTS = ['/api/team/invite', '/api/team/remove', '/api/team/role'];
const CALL_POSTS = ['/api/call/start', '/api/call/say', '/api/call/next', '/api/call/end', '/api/call/turn', '/api/call/round'];
const WRITE_POSTS = [
  '/api/models', '/api/agents/pause', '/api/call/attach',
  '/api/notes', '/api/notes/done', '/api/notes/delete',
  '/api/vault/favorite', '/api/shortcuts', '/api/shortcuts/delete', '/api/shortcuts/run',
  '/api/alerts/prefs',
];

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Modo remoto (app do celular via Tailscale): um servidor à parte, preso ao IP do tailnet, só com token. */
export interface RemoteOpts { host: string; token: string; port?: number }

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createServer(j: Jarvis, remote?: RemoteOpts): http.Server {
  // O remoto pode ouvir numa porta própria (remote.port): o Host aceito tem que ser essa porta.
  const port = remote?.port ?? j.cfg.port;
  const csrf = randomBytes(24).toString('hex');
  const allowedHosts = remote
    ? new Set([`${remote.host}:${port}`])
    : new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const team = teamFor(j.cfg.db === ':memory:' ? null : path.dirname(j.cfg.db));
  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Quem está pedindo: no PC é o dono; no remoto, o token principal é o dono e um token de convite é a pessoa do time.
    // Sem token válido no remoto não responde nada (nem a página).
    let who: Who = OWNER;
    if (remote) {
      const auth = String(req.headers.authorization ?? '');
      const guest = auth.startsWith('Bearer ') ? team.byToken(auth.slice(7)) : null;
      if (sameSecret(auth, `Bearer ${remote.token}`)) who = OWNER;
      else if (guest) who = guest;
      else {
        res.writeHead(401, { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Bearer' }).end('token obrigatório');
        return;
      }
    }
    team.touch(who, remote ? 'celular' : 'pc');
    // Anti DNS-rebinding: um site externo que aponte um domínio para 127.0.0.1 manda outro Host.
    const host = req.headers.host ?? '';
    const origin = req.headers.origin;
    if (!allowedHosts.has(host) || (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '')))) {
      res.writeHead(403, SECURITY_HEADERS).end('host recusado');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    // Escritas: comando, aprovação e mensagem na sala. JSON sempre.
    // Local (navegador): Origin da própria sala + token CSRF. Remoto (app): o Bearer já validado basta —
    // não é credencial automática do navegador, então não há CSRF.
    const isPost = req.method === 'POST' && ['/api/commands', '/api/chat', '/api/commands/decide', ...WRITE_POSTS, ...CALL_POSTS, ...TEAM_POSTS].includes(url.pathname);
    const browserOk = !!origin && req.headers['x-jarvis-csrf'] === csrf;
    if (isPost && (!(remote || browserOk) || !String(req.headers['content-type']).startsWith('application/json'))) {
      send(403, { error: 'requisição recusada' });
      return;
    }
    // Papéis: "leitura" só vê; aprovar comando protegido e mexer no time é só do dono.
    if (isPost && who.role === 'leitura') { send(403, { error: 'seu acesso é só de leitura' }); return; }
    if (isPost && (url.pathname === '/api/commands/decide' || TEAM_POSTS.includes(url.pathname) || url.pathname === '/api/agents/pause' || url.pathname === '/api/models') && who.role !== 'dono') {
      send(403, { error: 'só o dono do time pode fazer isso' });
      return;
    }
    if (isPost && TEAM_POSTS.includes(url.pathname)) {
      readBody(req, 2_048).then((raw) => {
        let body: { name?: string; role?: string; id?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        try {
          if (url.pathname === '/api/team/invite') {
            const { person, token } = team.invite(String(body.name ?? ''), (String(body.role ?? 'membro')) as Role);
            // O token sai só nesta resposta: quem convidou passa para a pessoa (QR/link no app).
            send(201, { person, token, remote: j.cfg.remote?.enabled ? { host: j.cfg.remote.host, port: j.cfg.remote.port ?? j.cfg.port } : null });
            return;
          }
          const id = String(body.id ?? '').toUpperCase();
          if (url.pathname === '/api/team/remove') { send(team.remove(id) ? 200 : 404, { ok: true }); return; }
          send(team.setRole(id, String(body.role) as Role) ? 200 : 404, { ok: true });
        } catch (e) { send(400, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && url.pathname === '/api/commands/decide') {
      readBody(req, 2_048).then((raw) => {
        let body: { project?: string; code?: string; decision?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        const code = String(body.code ?? '');
        if (!/^J-\d{3,}$/.test(code) || !['approve', 'reject'].includes(String(body.decision))) { send(400, { error: 'pedido inválido' }); return; }
        try {
          const cmd = j.decide(p, code, body.decision as 'approve' | 'reject');
          send(200, { command: cmd, reply: cmd.approval === 'approved' ? `${code} aprovado. Vale só para este comando.` : `${code} recusado. Os agentes não devem executar.` });
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && url.pathname === '/api/call/attach') {
      readBody(req, 7_500_000).then(async (raw) => {
        let body: { project?: string; name?: string; mime?: string; data?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        try {
          send(200, await callsFor(j).attach(p, String(body.name ?? 'anexo'), String(body.mime ?? ''), Buffer.from(String(body.data ?? ''), 'base64')));
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'anexo grande demais (máx. 5 MB)' }));
      return;
    }
    if (isPost && url.pathname === '/api/agents/pause') {
      readBody(req, 1_024).then((raw) => {
        let body: { project?: string; on?: boolean; agora?: boolean };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p?.modelsDir) { send(404, { error: 'projeto sem pasta dos agentes' }); return; }
        send(200, setPause(p.modelsDir, body.on === true, body.agora === true));
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && WRITE_POSTS.includes(url.pathname) && url.pathname !== '/api/models' && url.pathname !== '/api/agents/pause' && url.pathname !== '/api/call/attach') {
      readBody(req, 4_096).then((raw) => {
        let body: { project?: string; text?: string; id?: number; done?: boolean; path?: string; title?: string; label?: string; target?: string; prefs?: Record<string, boolean> };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        try {
          switch (url.pathname) {
            case '/api/notes':
              send(201, addNote(j.store, p, String(body.text ?? '')));
              return;
            case '/api/notes/done':
              j.store.setNoteDone(p.id, Number(body.id), body.done !== false);
              syncNotesFile(j.store, p);
              send(200, { ok: true });
              return;
            case '/api/notes/delete':
              j.store.deleteNote(p.id, Number(body.id));
              syncNotesFile(j.store, p);
              send(200, { ok: true });
              return;
            case '/api/vault/favorite': {
              const fp = String(body.path ?? '');
              if (!fp) { send(400, { error: 'caminho vazio' }); return; }
              if (j.store.isFavorite(p.id, fp)) j.store.removeFavorite(p.id, fp);
              else j.store.addFavorite(p.id, fp, String(body.title ?? fp));
              send(200, { favorito: j.store.isFavorite(p.id, fp) });
              return;
            }
            case '/api/shortcuts': {
              const label = String(body.label ?? '').trim().slice(0, 60);
              const text = String(body.text ?? '').trim().slice(0, 500);
              const target = String(body.target ?? 'LEADER').toUpperCase();
              if (!label || !text) { send(400, { error: 'preencha nome e texto do atalho' }); return; }
              send(201, j.store.addShortcut(p.id, label, text, target));
              return;
            }
            case '/api/shortcuts/delete':
              j.store.deleteShortcut(p.id, Number(body.id));
              send(200, { ok: true });
              return;
            case '/api/shortcuts/run': {
              const sc = j.store.shortcuts(p.id).find((x) => x.id === Number(body.id));
              if (!sc) { send(404, { error: 'atalho não encontrado' }); return; }
              const known = new Set(['LEADER', ...p.agents.map((a) => a.id)]);
              if (!known.has(sc.target)) { send(400, { error: 'destino do atalho não existe mais' }); return; }
              const cmd = j.command(p, sc.text, sc.target);
              send(201, { command: cmd, reply: `Comando ${cmd.code} registrado para ${sc.target} (atalho "${sc.label}").` });
              return;
            }
            case '/api/alerts/prefs':
              j.store.setAlertPrefs(p.id, body.prefs && typeof body.prefs === 'object' ? body.prefs : {});
              send(200, j.store.alertPrefs(p.id));
              return;
          }
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && url.pathname === '/api/models') {
      readBody(req, 2_048).then(async (raw) => {
        let body: { project?: string; agent?: string; model?: string; effort?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p?.modelsDir) { send(404, { error: 'projeto sem pasta de modelos' }); return; }
        try {
          send(200, await setModel(p.modelsDir, String(body.agent ?? ''), String(body.model ?? ''), body.effort ? String(body.effort) : undefined));
        } catch (e) { send(400, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && CALL_POSTS.includes(url.pathname)) {
      readBody(req, 8_192).then(async (raw) => {
        let body: { project?: string; text?: string; who?: string[]; modo?: string; agent?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        const calls = callsFor(j);
        const text = String(body.text ?? '').trim().slice(0, 2000);
        try {
          switch (url.pathname) {
            case '/api/call/start':
              if (!text) { send(400, { error: 'diga o assunto da chamada' }); return; }
              send(201, calls.start(p, text, Array.isArray(body.who) ? body.who.map(String).slice(0, 12) : [], (['debate', 'brainstorm', 'revisao', 'goal'].includes(String(body.modo)) ? body.modo : 'debate') as 'debate'));
              return;
            case '/api/call/say':
              if (!text) { send(400, { error: 'fala vazia' }); return; }
              send(200, calls.say(p, text, who.owner ? undefined : who.id));
              return;
            case '/api/call/next':
              send(200, { turn: await calls.next(p), call: calls.get(p.id) ?? null });
              return;
            case '/api/call/round':
              send(200, calls.roundAll(p));
              return;
            case '/api/call/turn':
              send(200, calls.passTurn(p, String(body.agent ?? '')));
              return;
            case '/api/call/end':
              send(200, calls.end(p) ?? null);
              return;
          }
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'pedido grande demais' }));
      return;
    }
    if (isPost && url.pathname === '/api/chat') {
      readBody(req, 32_768).then((raw) => {
        let body: { project?: string; text?: string; to?: string; as?: string; assunto?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        const text = String(body.text ?? '').trim();
        const as = body.as === 'CHATGPT' && who.owner ? 'CHATGPT' : who.id;
        const to = String(body.to ?? 'TODOS').toUpperCase();
        if (!text) { send(400, { error: 'mensagem vazia' }); return; }
        if (!/^[A-Z0-9_,\s-]{2,120}$/.test(to)) { send(400, { error: 'destino inválido' }); return; }
        try {
          j.say(p, as, to, String(body.assunto ?? ''), text);
          const tagged = mentions(text, [...team.ids(), ...p.agents.map((a) => a.id)]);
          send(201, { ok: true, mentions: tagged });
          // O JARVIS responde o dono na sala (os agentes não leem o chat).
          if (as !== 'CHATGPT') void replyToDono(j, p, text).catch((e) => console.error('[resposta]', (e as Error).message));
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'mensagem grande demais' }));
      return;
    }
    if (isPost) {
      readBody(req, 16_384).then((raw) => {
        let body: { project?: string; text?: string; to?: string };
        try { body = JSON.parse(raw); } catch { send(400, { error: 'JSON inválido' }); return; }
        const p = j.project(body.project);
        const text = String(body.text ?? '').trim();
        const known = new Set(['LEADER', ...(p?.agents.map((a) => a.id) ?? [])]);
        const to = String(body.to ?? 'LEADER');
        if (!p) { send(404, { error: 'projeto desconhecido' }); return; }
        if (!text) { send(400, { error: 'comando vazio' }); return; }
        if (!known.has(to)) { send(400, { error: 'destino desconhecido' }); return; }
        try {
          // Ordem de alguém do time leva o nome junto (o agente e o histórico sabem quem pediu).
          const cmd = j.command(p, who.owner ? text : `[${who.name}] ${text}`, to);
          send(201, {
            command: cmd,
            reply: cmd.requires_approval
              ? `Comando ${cmd.code} registrado. Ele envolve ação protegida (deploy/push/merge…): fica PARADO até você aprovar.`
              : `Comando ${cmd.code} registrado para ${to}. Aguardando ACK do líder.`,
          });
        } catch (e) { send(409, { error: (e as Error).message }); }
      }).catch(() => send(413, { error: 'comando grande demais' }));
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET' }).end(); return; }

    const st = STATIC[url.pathname];
    if (st) {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': st[1] });
      res.end(readFileSync(path.join(PUBLIC, st[0])));
      return;
    }

    // Time: quem sou eu e quem mais está aqui (presença).
    if (url.pathname === '/api/team') { send(200, { me: who, people: team.list() }); return; }
    if (url.pathname === '/api/session') {
      // Outro site não consegue ler esta resposta (sem CORS + checagem de Host), então o token não vaza.
      send(200, { csrf });
      return;
    }

    // Atualização do app do celular: tools/publicar-app.ps1 põe jarvis.apk + version.json em data/app.
    if (url.pathname === '/api/app/version' || url.pathname === '/api/app/apk') {
      const dir = path.join(path.dirname(j.cfg.db), 'app');
      let info: { versionCode: number; versionName: string; sha256: string; size: number };
      try { info = JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8')); } catch { send(404, { error: 'nenhum app publicado' }); return; }
      if (url.pathname === '/api/app/version') { send(200, info); return; }
      const apk = readFileSync(path.join(dir, 'jarvis.apk'));
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': apk.length });
      res.end(apk);
      return;
    }

    if (url.pathname === '/api/projects') {
      send(200, j.cfg.projects.map((p) => ({ id: p.id, name: p.name, goal: j.state(p).goal })));
      return;
    }

    const p = j.project(url.searchParams.get('project'));
    if (!p) { send(404, { error: 'projeto desconhecido' }); return; }

    switch (url.pathname) {
      case '/api/state':
        send(200, j.state(p));
        return;
      case '/api/feed': {
        const before = Number(url.searchParams.get('before')) || undefined;
        const limit = Number(url.searchParams.get('limit')) || undefined;
        send(200, j.store.feed(p.id, { agent: url.searchParams.get('agent') || undefined, before, limit }));
        return;
      }
      case '/api/chat':
        send(200, j.store.chat(p.id, 300));
        return;
      case '/api/commands':
        send(200, j.store.commands(p.id));
        return;
      case '/api/call/people':
        send(200, callPeople(p));
        return;
      case '/api/call':
        send(200, callsFor(j).get(p.id) ?? null);
        return;
      case '/api/health':
        health(p, j.cfg.summary).then((h) => send(200, h)).catch((e) => send(500, { error: (e as Error).message }));
        return;
      case '/api/limits':
        agentLimits(p, j.cfg.summary).then(l => send(200, l)).catch(() => send(503, { error: 'Cotas temporariamente indisponíveis.' }));
        return;
      case '/api/models':
        send(200, p.modelsDir ? modelChoices(p.modelsDir) : []);
        return;
      case '/api/vault/search':
        send(200, searchNotes(p.vault, (url.searchParams.get('q') ?? '').slice(0, 200)));
        return;
      case '/api/search':
        send(200, searchAll(j, p, (url.searchParams.get('q') ?? '').slice(0, 200)));
        return;
      case '/api/notes':
        send(200, j.store.notes(p.id));
        return;
      case '/api/vault/favorites':
        send(200, j.store.favorites(p.id));
        return;
      case '/api/shortcuts':
        send(200, j.store.shortcuts(p.id));
        return;
      case '/api/alerts/prefs':
        send(200, j.store.alertPrefs(p.id));
        return;
      case '/api/usage': {
        const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 7, 1), 30);
        gateUsage(j.cfg.summary, dias).then((u) => send(200, u)).catch((e) => send(502, { error: `fila sem resposta: ${(e as Error).message}` }));
        return;
      }
      case '/api/calls':
        send(200, listCalls(p));
        return;
      case '/api/about':
        send(200, about(j.cfg.db));
        return;
      case '/api/stats': {
        const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 7, 1), 60);
        const since = new Date(Date.now() - dias * 86_400_000).toISOString();
        const cmds = j.store.commands(p.id, 1000).filter((c) => c.created_at >= since);
        send(200, {
          dias,
          agentes: j.store.agentStats(p.id, since),
          comandos: { total: cmds.length, done: cmds.filter((c) => c.status === 'DONE').length, bloqueados: cmds.filter((c) => /^(BLOCKED|FAILED)/.test(c.status)).length, protegidos: cmds.filter((c) => c.requires_approval).length },
          porDia: commandsPerDay(j.store, p, Math.min(dias, 30)),
        });
        return;
      }
      case '/api/vault/note': {
        const n = readNote(p.vault, url.searchParams.get('path') ?? '');
        if (n) send(200, n); else send(404, { error: 'nota não encontrada' });
        return;
      }
      case '/api/summary':
        send(200, { deterministic: j.deterministicSummary(p), llm: j.store.summaries(p.id, 10).filter((s) => s.kind === 'llm') });
        return;
      case '/events': {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        const push = (type: string) => (ev: { project: string }) => {
          if (ev.project !== p.id) return;
          res.write(`event: ${type}\ndata: ${JSON.stringify(ev)}\n\n`);
        };
        const handlers = { entries: push('entries'), agents: push('agents'), tasks: push('tasks'), summary: push('summary'), commands: push('commands'), chat: push('chat'), call: push('call') };
        for (const [k, h] of Object.entries(handlers)) j.on(k, h);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(ping);
          for (const [k, h] of Object.entries(handlers)) j.off(k, h);
        });
        return;
      }
    }
    send(404, { error: 'não encontrado' });
  };
  // Um erro numa requisição (ex.: OneDrive travando um arquivo, EBUSY) responde 500 em vez de derrubar o servidor.
  return http.createServer((req, res) => {
    try { handle(req, res); } catch (e) {
      console.error('[req]', req.url, (e as Error).message);
      if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'erro interno, tente de novo' }));
    }
  });
}
