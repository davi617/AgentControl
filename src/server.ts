import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Jarvis } from './jarvis.ts';
import { OWNER, teamFor, type Who } from './team.ts';
import { PlanStore } from './plans.ts';
import { SESSION_COOKIE, SESSION_DAYS, sessionsFor } from './sessions.ts';
import { type Ctx, findRoute, HttpError, roleAllows, SECURITY_HEADERS } from './routes.ts';

export { MAX_STREAMS } from './routes.ts';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/missions.js': ['missions.js', 'text/javascript; charset=utf-8'],
  '/predio.js': ['predio.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  // iPhone/iPad e navegador de qualquer celular: app instalável pela tela de início (PWA) e tela de entrar.
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/entrar': ['entrar.html', 'text/html; charset=utf-8'],
  '/entrar.js': ['entrar.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'],
};
/** Abrem sem token no remoto: só a tela de entrar e o que ela precisa (nada com dado do time). */
const OPEN_STATIC = new Set(['/entrar', '/entrar.js', '/icon.svg', '/apple-touch-icon.png', '/manifest.webmanifest', '/style.css', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']);

/** Arquivos da pasta public em memória; relê só quando o mtime muda (antes era um readFileSync por requisição). */
const staticCache = new Map<string, { mtime: number; data: Buffer }>();
function staticFile(name: string): Buffer {
  const file = path.join(PUBLIC, name);
  const mtime = statSync(file).mtimeMs;
  const hit = staticCache.get(file);
  if (hit && hit.mtime === mtime) return hit.data;
  const data = readFileSync(file);
  staticCache.set(file, { mtime, data });
  return data;
}

/**
 * Freio contra adivinhar o token na tela de entrar: 8 erros por IP em 15 min bloqueiam aquele IP por 15 min.
 * Fica na memória (reiniciar o servidor zera), o que basta: o token tem 256 bits e o remoto só existe no tailnet.
 */
export class LoginGuard {
  private fails = new Map<string, { n: number; first: number; until: number }>();
  private max: number;
  private windowMs: number;
  constructor(max = 8, windowMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; }
  blocked(ip: string, now = Date.now()): boolean { const f = this.fails.get(ip); return !!f && f.until > now; }
  fail(ip: string, now = Date.now()): void {
    const f = this.fails.get(ip);
    if (!f || now - f.first > this.windowMs) { this.fails.set(ip, { n: 1, first: now, until: 0 }); return; }
    f.n++;
    if (f.n >= this.max) f.until = now + this.windowMs;
    // Não deixa a memória crescer sem fim: sai o IP mais antigo (antes um clear() soltava todos os bloqueados de uma vez).
    while (this.fails.size > 10_000) this.fails.delete(this.fails.keys().next().value!);
  }
  ok(ip: string): void { this.fails.delete(ip); }
}

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

/** Valor de um cookie pelo nome (sem decodificar). */
const cookieOf = (req: http.IncomingMessage, name: string) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(String(req.headers.cookie ?? ''))?.[1];
/** Apaga o cookie de sessão e o antigo ac_token (que guardava o token cru, antes das sessões). */
const CLEAR_COOKIES = [`${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, 'ac_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'];

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
  const guard = new LoginGuard();
  const plans = new PlanStore(j.cfg.db === ':memory:' ? null : path.dirname(j.cfg.db));
  const sessions = sessionsFor(j.cfg.db === ':memory:' ? null : path.dirname(j.cfg.db));
  // Streams /events abertos, por pessoa: quem sai do time perde na hora o que já estava recebendo.
  const streams = new Map<string, Set<http.ServerResponse>>();
  const bySession = new Map<string, Set<http.ServerResponse>>();
  const endSession = (sid: string) => { for (const r of bySession.get(sid) ?? []) r.end(); bySession.delete(sid); };
  const onRemoved = (id: string) => {
    for (const r of streams.get(id) ?? []) r.end();
    streams.delete(id);
    sessions.revokePerson(id);
  };
  team.on('removed', onRemoved);
  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Quem está pedindo: no PC é o dono; no remoto, o token principal é o dono e um token de convite é a pessoa do time.
    // Sem token válido no remoto não responde nada (nem a página).
    let who: Who = OWNER;
    // Navegador (iPhone/PWA) não manda Bearer: depois de /entrar, o token vai num cookie HttpOnly. Pedido por cookie
    // é credencial automática do navegador, então as escritas por esse caminho exigem o token CSRF (como no PC).
    let viaCookie = false, anon = false;
    let sessionId: string | undefined;
    // Sair (iPhone/PWA): apaga o cookie. Vale com ou sem token válido; Origin de outro site é recusado.
    if ((req.url ?? '').split('?')[0] === '/api/logout' && req.method === 'POST') {
      const o = req.headers.origin;
      const okOrigin = !o || o.replace(/^https?:\/\//, '') === req.headers.host;
      // Sair encerra a sessão no servidor também: o cookie copiado de outro lugar para de valer.
      const sid = okOrigin ? sessions.verify(decodeURIComponent(cookieOf(req, SESSION_COOKIE) ?? '')) : null;
      if (sid) { sessions.revoke(sid.id); endSession(sid.id); }
      res.writeHead(okOrigin ? 200 : 403, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...(okOrigin ? { 'Set-Cookie': CLEAR_COOKIES } : {}) }).end(okOrigin ? '{"ok":true}' : '{"error":"origem recusada"}');
      return;
    }
    if (remote) {
      const pathOnly = (req.url ?? '/').split('?')[0];
      const auth = String(req.headers.authorization ?? '');
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      // Navegador: cookie de sessão (o token cru nunca fica no cookie). App: Bearer com o token.
      const sessCookie = bearer ? undefined : cookieOf(req, SESSION_COOKIE);
      viaCookie = !bearer && (!!sessCookie || !!cookieOf(req, 'ac_token'));
      const sess = sessCookie ? sessions.verify(decodeURIComponent(sessCookie)) : null;
      const fromSession = sess ? team.byId(sess.person) : null;
      const guest = bearer ? team.byToken(bearer) : null;
      if (bearer && sameSecret(bearer, remote.token)) who = OWNER;
      else if (guest) who = guest;
      else if (sess && fromSession) { who = fromSession; sessionId = sess.id; }
      else if (STATIC[pathOnly] && OPEN_STATIC.has(pathOnly)) {
        anon = true; // tela de entrar e ícones abrem sem token (e não contam como ninguém)
      } else if (pathOnly === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress ?? '?';
        const json = { ...SECURITY_HEADERS, 'Content-Type': 'application/json' };
        // Login só da própria tela de entrar: outro site não consegue logar o navegador com um token dele.
        const o = req.headers.origin;
        if (o && o.replace(/^https?:\/\//, '') !== `${remote.host}:${port}` || req.headers.host !== `${remote.host}:${port}`) { res.writeHead(403, json).end('{"error":"origem recusada"}'); return; }
        if (guard.blocked(ip)) { res.writeHead(429, { ...json, 'Retry-After': '900' }).end('{"error":"muitas tentativas; espere 15 minutos"}'); return; }
        readBody(req, 1_024).then((raw) => {
          let t = '';
          try { t = String(JSON.parse(raw).token ?? '').trim(); } catch { /* vazio */ }
          const person = t && sameSecret(t, remote.token) ? OWNER : t ? team.byToken(t) : null;
          if (!person) { guard.fail(ip); res.writeHead(401, json).end('{"error":"token não confere"}'); return; }
          guard.ok(ip);
          if (j.panic() && person.role !== 'dono') { res.writeHead(423, json).end('{"error":"o Agent Control está em modo pânico; só o dono entra"}'); return; }
          const { session, secret } = sessions.create(person.id, String(req.headers['user-agent'] ?? ''), ip);
          j.store.audit({ project: '', actor: person.id, action: 'entrou', target: session.device, detail: ip });
          res.writeHead(200, { ...json, 'Set-Cookie': [`${SESSION_COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86_400}`, CLEAR_COOKIES[1]] }).end('{"ok":true}');
        }).catch(() => res.writeHead(413, SECURITY_HEADERS).end());
        return;
      } else {
        // Cookie com token que não vale mais (pessoa removida, token trocado): apaga, para o navegador parar de mandar.
        const clear = viaCookie ? { 'Set-Cookie': CLEAR_COOKIES } : {};
        if ((req.headers.accept ?? '').includes('text/html')) res.writeHead(302, { ...SECURITY_HEADERS, ...clear, Location: '/entrar' }).end();
        else res.writeHead(401, { ...SECURITY_HEADERS, ...clear, 'WWW-Authenticate': 'Bearer' }).end('token obrigatório');
        return;
      }
    }
    if (anon && !STATIC[(req.url ?? '/').split('?')[0]]) { res.writeHead(401, SECURITY_HEADERS).end(); return; }
    if (!anon) team.touch(who, remote ? 'celular' : 'pc');
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

    if (req.method === 'GET') {
      const st = STATIC[url.pathname];
      if (st) {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': st[1] });
        res.end(staticFile(st[0]));
        return;
      }
    }

    // Pânico: quem não é dono fica de fora até o dono desligar (a página abre, a API não).
    if (who.role !== 'dono' && j.panic()) { send(423, { error: 'o Agent Control está em modo pânico; só o dono entra' }); return; }

    const route = findRoute(req.method ?? '', url.pathname);
    if (!route) {
      if (req.method !== 'GET') res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET' }).end();
      else send(404, { error: 'não encontrado' });
      return;
    }

    if (route.method === 'POST') {
      // Escritas sempre em JSON. Local (navegador): Origin da própria sala + token CSRF. Remoto (app): o Bearer já
      // validado basta — não é credencial automática do navegador, então não há CSRF. Cookie (iPhone/PWA) exige o CSRF.
      const browserOk = !!origin && req.headers['x-jarvis-csrf'] === csrf;
      if (!((remote && !viaCookie) || browserOk) || !String(req.headers['content-type']).startsWith('application/json')) {
        send(403, { error: 'requisição recusada' });
        return;
      }
    }
    // Papel mínimo declarado na própria rota (ROUTES): o teste da matriz confere que nenhuma escrita fica sem papel.
    if (!roleAllows(who.role, route.role)) {
      send(403, { error: who.role === 'leitura' ? 'seu acesso é só de leitura' : 'só o dono do time pode fazer isso' });
      return;
    }

    const ctx: Ctx = {
      j, who, sessionId, url, req, res, send, body: {}, team, sessions, plans, csrf, endSession, streams, bySession,
      project() {
        const p = j.project(route.method === 'POST' ? this.body.project as string | undefined : url.searchParams.get('project'));
        if (!p) throw new HttpError(404, 'projeto desconhecido');
        return p;
      },
    };
    const run = () => {
      let out: unknown;
      try { out = route.run(ctx); } catch (e) { fail(e); return; }
      if (out instanceof Promise) out.catch(fail);
    };
    const fail = (e: unknown) => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) send(e.code, { error: e.message });
      else send(route.fail ?? 409, { error: (e as Error).message });
    };
    if (route.method !== 'POST') { run(); return; }
    readBody(req, route.body ?? 4_096).then((raw) => {
      try { ctx.body = JSON.parse(raw) ?? {}; } catch { send(400, { error: 'JSON inválido' }); return; }
      if (typeof ctx.body !== 'object' || Array.isArray(ctx.body)) { send(400, { error: 'JSON inválido' }); return; }
      run();
    }).catch(() => send(413, { error: route.tooBig ?? 'pedido grande demais' }));
  };
  // Um erro numa requisição (ex.: OneDrive travando um arquivo, EBUSY) responde 500 em vez de derrubar o servidor.
  const server = http.createServer((req, res) => {
    try { handle(req, res); } catch (e) {
      console.error('[req]', req.url, (e as Error).message);
      if (!res.headersSent) res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'erro interno, tente de novo' }));
    }
  });
  server.on('close', () => team.off('removed', onRemoved));
  return server;
}
