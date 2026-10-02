// Fila anti-429 (kimi-gate): fica entre os agentes e o 9Router.
// Todos os agentes dividem o limite de UMA conta NVIDIA; medido em 2026-09-25: até 5 pedidos
// simultâneos passam, 6+ começam a dar 429 com cooldown de 2–16 s. A fila segura no máximo
// `maxConcurrent` pedidos por vez e, se ainda vier 429, espera o tempo pedido e tenta de novo —
// o agente fica mais lento em vez de falhar. Só escuta em 127.0.0.1.
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentFromUrl, tokensFrom, Usage } from './usage.ts';

export interface GateOpts {
  port: number;
  upstream: string; // ex.: http://127.0.0.1:20128
  maxConcurrent: number;
  maxRetries: number;
  maxWaitMs: number; // teto de espera acumulada por pedido
  baseBackoffMs: number;
  reservedPriority?: number; // vagas guardadas para quem o dono espera (X-Gate-Priority: alta|voz)
  idleTimeoutMs?: number; // sem nenhum byte do 9Router por esse tempo, o pedido é cortado e a vaga liberada
  log?: (line: string) => void;
  /**
   * Segundo endereço da fila, só para agentes fora do PC (ex.: Termux no celular) — pedido do dono, 2026-09-27.
   * Escuta só nesse host (o IP do Tailscale, nunca 0.0.0.0) e exige `Authorization: Bearer <token>`; sem o
   * token certo, nem o 404 responde. Divide a MESMA cota da NVIDIA e as MESMAS vagas dos agentes do PC.
   */
  remote?: { host: string; token: string; port?: number };
  /** Arquivo do uso por agente (data/gate-usage.json). Sem ele, conta só em memória. */
  usageFile?: string;
}

export const DEFAULTS: GateOpts = {
  port: 20129,
  upstream: 'http://127.0.0.1:20128',
  maxConcurrent: 4,
  maxRetries: 10,
  maxWaitMs: 300_000, // agentes esperam até 10 min por resposta (API_TIMEOUT_MS), então 5 min de fila é aceitável
  baseBackoffMs: 2_000,
  reservedPriority: 1,
};

/**
 * Semáforo FIFO com fila expressa. Pedido prioritário (conversa ao vivo) passa na frente e tem
 * `reserved` vagas só dele: os de fundo usam no máximo `max - reserved`, então a voz não espera
 * uma resposta longa de agente terminar.
 */
export class Slots {
  private busy = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly express: Array<() => void> = [];
  private readonly max: number;
  private readonly reserved: number;
  constructor(max: number, reserved = 0) { this.max = max; this.reserved = Math.min(reserved, max - 1); }
  private boostUntil = 0;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  get inFlight() { return this.busy; }
  get queued() { return this.waiting.length + this.express.length; }
  get voiceMode() { return Date.now() < this.boostUntil; }
  /**
   * Conversa ao vivo acontecendo: por `ms`, os de fundo não começam pedido novo (a cota da conta NVIDIA
   * vai toda para a voz). Ninguém é descartado: quando o modo voz acaba, a fila de fundo anda sozinha.
   */
  boost(ms: number) {
    this.boostUntil = Math.max(this.boostUntil, Date.now() + ms);
    clearTimeout(this.drainTimer);
    this.drainTimer = setTimeout(() => this.drain(), this.boostUntil - Date.now() + 10);
    this.drainTimer.unref?.();
  }
  private free(priority: boolean) { return this.busy < (priority ? this.max : this.voiceMode ? 0 : this.max - this.reserved); }
  private drain() {
    while (this.express.length && this.free(true)) this.express.shift()!();
    while (this.waiting.length && this.free(false)) this.waiting.shift()!();
  }
  acquire(priority = false): Promise<void> {
    if (this.free(priority)) { this.busy++; return Promise.resolve(); }
    return new Promise((res) => (priority ? this.express : this.waiting).push(() => { this.busy++; res(); }));
  }
  release() {
    this.busy--;
    this.drain();
  }
}

/** Cabeçalho que o JARVIS manda nas falas da chamada de voz (só quem está em 127.0.0.1 alcança a fila). */
export const PRIORITY_HEADER = 'x-gate-priority';
/** Quanto tempo depois da última fala da chamada os agentes de fundo continuam segurados. */
export const VOICE_MODE_MS = 120_000;

const MAX_BACKOFF_MS = 30_000;
/** Pedido grande sem stream pode levar alguns minutos para começar a responder; 5 min sem nada = pendurado. */
export const IDLE_TIMEOUT_MS = 300_000;

function modelOf(body: Buffer): string {
  try { return String(JSON.parse(body.toString('utf8')).model ?? ''); } catch { return ''; }
}

/** 429 direto, ou 503 do 9Router embrulhando um 429 do provider ("[429] … reset after 8s"). */
export function rateLimitWait(status: number, body: string, retryAfter: string | undefined, attempt: number, base: number): number | null {
  const wrapped = status === 503 && /\[429\]|reset after/i.test(body);
  if (status !== 429 && !wrapped) return null;
  const secs = Number(retryAfter) || Number(/reset after (\d+)\s*s/i.exec(body)?.[1]);
  const hinted = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
  // O tempo que o provider informa manda; sem ele, backoff exponencial com teto de 30 s
  // (sem teto a pausa global chegou a 4 min no teste de carga).
  const wait = hinted || Math.min(base * 2 ** attempt, MAX_BACKOFF_MS);
  return wait + Math.floor(Math.random() * 500); // jitter: não voltam todos juntos
}

const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive']);

export function createGate(o: GateOpts = DEFAULTS) {
  const slots = new Slots(o.maxConcurrent, o.reservedPriority ?? 0);
  const stats = { requests: 0, retried429: 0, gaveUp: 0, cut: 0, abandoned: 0, last429: null as string | null, cooldownUntil: null as string | null };
  const active = new Map<number, { since: number; priority: boolean; model: string }>();
  let seq = 0;
  // Pausa global: um 429 é limite da CONTA, então ninguém manda nada até ele passar
  // (evita que cada pedido tente sozinho e piore o limite).
  let cooldownUntil = 0;
  const waitCooldown = async () => { for (let d = cooldownUntil - Date.now(); d > 0; d = cooldownUntil - Date.now()) await sleep(d); };
  const up = new URL(o.upstream);
  const log = o.log ?? (() => {});
  const usage = new Usage(o.usageFile);

  const listener: http.RequestListener = (req, res) => {
    if (req.url === '/gate/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      // `ativos`: quem ocupa cada vaga e há quanto tempo (pedido pendurado aparece aqui).
      const ativos = [...active.values()].map((a) => ({ segundos: Math.round((Date.now() - a.since) / 1000), voz: a.priority, modelo: a.model }));
      res.end(JSON.stringify({ inFlight: slots.inFlight, queued: slots.queued, maxConcurrent: o.maxConcurrent, voiceMode: slots.voiceMode, ...stats, ativos }));
      return;
    }
    if (req.url?.startsWith('/gate/usage')) {
      const dias = Math.min(Math.max(Number(new URL(req.url, 'http://x').searchParams.get('dias')) || 7, 1), 30);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(usage.snapshot(dias)));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    // Quem é: /a/<agente>/… no endereço (tirado antes de mandar ao 9Router) ou o cabeçalho de prioridade.
    const who = agentFromUrl(req.url ?? '/', String(req.headers[PRIORITY_HEADER] ?? ''));
    req.url = who.url;
    req.on('end', () => { void handle(req, res, Buffer.concat(chunks), who.agent); });
  };
  const server = http.createServer(listener);

  // Endereço do Tailscale para agentes fora do PC: mesmo handler, só que atrás de token e checando o Host
  // (o mesmo truque anti DNS-rebinding do server.ts) — sem isso, um site poderia apontar um domínio para
  // o IP do Tailscale e usar a fila como se fosse o próprio celular.
  let remoteServer: http.Server | undefined;
  if (o.remote) {
    const { host, token } = o.remote;
    const rport = o.remote.port ?? o.port;
    const allowedHost = `${host}:${rport}`;
    remoteServer = http.createServer((req, res) => {
      const given = Buffer.from(String(req.headers.authorization ?? ''));
      const want = Buffer.from(`Bearer ${token}`);
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        res.writeHead(401, { 'content-type': 'application/json', 'WWW-Authenticate': 'Bearer' }).end('{"error":"token obrigatório"}');
        return;
      }
      if ((req.headers.host ?? '') !== allowedHost) {
        res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"host recusado"}');
        return;
      }
      listener(req, res);
    });
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, agent = 'OUTRO') {
    stats.requests++;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== PRIORITY_HEADER && typeof v === 'string') headers[k] = v;
    // GET (lista de modelos etc.) não gasta cota: passa direto, sem vaga.
    const limited = req.method === 'POST';
    // 'alta' fura a fila (você esperando resposta no chat); 'voz' também liga o modo voz, que segura os agentes
    // de fundo por 2 min. Antes toda resposta do chat pausava os agentes.
    const pr = String(req.headers[PRIORITY_HEADER] ?? '');
    const priority = pr === 'alta' || pr === 'voz';
    if (pr === 'voz') slots.boost(VOICE_MODE_MS);
    // Cliente desistiu (timeout do JARVIS, agente fechado): cancela o pedido no 9Router e solta a vaga NA HORA.
    // Antes a fila só percebia quando a NVIDIA começava a responder; pedidos do GLM ficavam 5 min prendendo vagas
    // e a chamada de voz "morria" (2026-09-26: 3 de 4 vagas presas, uma há 355 s).
    const gone = new AbortController();
    res.on('close', () => { if (!res.writableEnded) gone.abort(); });
    if (limited) await slots.acquire(priority);
    let released = false;
    const id = ++seq;
    const release = () => { active.delete(id); if (limited && !released) { released = true; slots.release(); } };
    if (limited) active.set(id, { since: Date.now(), priority, model: modelOf(body) });
    let waited = 0;
    try {
      // O agente desistiu enquanto esperava na fila: não gasta cota com quem não vai ler a resposta.
      // (req.destroyed não serve: fica true assim que o corpo acaba de chegar; res.destroyed = cliente fechou.)
      if (res.destroyed || gone.signal.aborted) { stats.abandoned++; return; }
      for (let attempt = 0; ; attempt++) {
        if (limited) await waitCooldown();
        if (gone.signal.aborted) { stats.abandoned++; return; }
        const upRes = await send(req.method ?? 'GET', req.url ?? '/', headers, body, gone.signal);
        const status = upRes.statusCode ?? 502;
        if (status === 429 || status === 503) {
          const text = await readAll(upRes);
          const wait = rateLimitWait(status, text, header(upRes, 'retry-after'), attempt, o.baseBackoffMs);
          if (wait !== null) usage.hit429(agent);
          if (wait !== null && attempt < o.maxRetries && waited + wait <= o.maxWaitMs) {
            stats.retried429++; stats.last429 = new Date().toISOString();
            cooldownUntil = Math.max(cooldownUntil, Date.now() + wait);
            stats.cooldownUntil = new Date(cooldownUntil).toISOString();
            log(`429 → fila pausada ${Math.round((cooldownUntil - Date.now()) / 1000)}s (tentativa ${attempt + 1}/${o.maxRetries})`);
            const before = Date.now();
            await waitCooldown(); waited += Date.now() - before;
            continue;
          }
          if (wait !== null) { stats.gaveUp++; log(`429 → desisti após ${attempt} tentativas`); }
          res.writeHead(status, filterHeaders(upRes.headers));
          res.end(text);
          return;
        }
        // Sucesso ou outro erro: repassa como veio (inclusive stream SSE), vaga presa até acabar.
        res.writeHead(status, filterHeaders(upRes.headers));
        const t0 = Date.now();
        // Guarda só o fim da resposta: é lá que vem o "usage" (tokens), no JSON normal e no stream.
        let tail = '';
        upRes.on('data', (c: Buffer) => { tail = (tail + c.toString('utf8')).slice(-8_192); });
        upRes.pipe(res);
        await new Promise<void>((done) => {
          upRes.on('end', done); upRes.on('error', done); upRes.on('close', done); res.on('close', done);
          if (res.destroyed) done(); // o cliente já tinha ido embora antes de ouvirmos o 'close'
        });
        if (limited) usage.record(agent, modelOf(body), { status, ms: Date.now() - t0, ...tokensFrom(tail) });
        if (!upRes.complete) res.destroy(); // corte no meio: o cliente vê erro e tenta de novo, não fica esperando
        return;
      }
    } catch (e) {
      if (gone.signal.aborted) { stats.abandoned++; return; }
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `kimi-gate: 9Router indisponível (${(e as Error).message})` } }));
    } finally {
      release();
    }
  }

  function send(method: string, path: string, headers: Record<string, string>, body: Buffer, signal?: AbortSignal): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('cliente desistiu')); return; }
      const r = http.request({ hostname: up.hostname, port: up.port, method, path, headers: { ...headers, 'content-length': String(body.length) } }, resolve);
      // Sem nenhum byte do 9Router por idleTimeoutMs (esperando resposta OU no meio do stream): corta e libera a vaga.
      // Em 2026-09-26 três pedidos ficaram pendurados ~45 min, prenderam as vagas e pararam todos os agentes.
      r.setTimeout(o.idleTimeoutMs ?? IDLE_TIMEOUT_MS, () => { stats.cut++; log('9Router parado: pedido cortado para liberar a vaga'); r.destroy(new Error('9Router sem resposta')); });
      r.on('error', reject);
      signal?.addEventListener('abort', () => r.destroy(new Error('cliente desistiu')), { once: true });
      r.end(body);
    });
  }

  return { server, remoteServer, slots, stats, usage };
}

function header(r: http.IncomingMessage, name: string): string | undefined {
  const v = r.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
function filterHeaders(h: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined && !HOP.has(k)) out[k] = v;
  return out;
}
function readAll(r: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); r.on('error', () => resolve('')); });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `node src/gate.ts` → sobe a fila com os padrões (só 127.0.0.1).
// Com jarvis.config.json:remote.enabled, também abre para agentes fora do PC (ex.: Termux no celular),
// só no IP do Tailscale e com um token PRÓPRIO da fila (não é o token do JARVIS) — pedido do dono, 2026-09-27.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const opts: GateOpts = {
    ...DEFAULTS,
    log: (l) => console.log(`[gate] ${new Date().toISOString().slice(11, 19)} ${l}`),
    usageFile: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'gate-usage.json'),
  };
  try {
    const { loadConfig } = await import('./config.ts');
    const cfg = loadConfig(process.env.JARVIS_CONFIG ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'jarvis.config.json'));
    if (cfg.remote?.enabled) {
      const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
      const { randomBytes } = await import('node:crypto');
      const tf = path.join(path.dirname(cfg.remote.tokenFile), 'gate-remote-token.txt');
      if (!existsSync(tf)) { mkdirSync(path.dirname(tf), { recursive: true }); writeFileSync(tf, randomBytes(32).toString('hex'), { mode: 0o600 }); }
      opts.remote = { host: cfg.remote.host, token: readFileSync(tf, 'utf8').trim() };
    }
  } catch (e) { console.error('[gate] sem acesso remoto (config ausente ou inválida):', (e as Error).message); }
  const g = createGate(opts);
  // Desligando a fila: grava o uso que ainda estava só em memória.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { g.usage.flush(); process.exit(0); });
  g.server.listen(DEFAULTS.port, '127.0.0.1', () => console.log(`kimi-gate: http://127.0.0.1:${DEFAULTS.port} → ${DEFAULTS.upstream} (máx. ${DEFAULTS.maxConcurrent} simultâneos)`));
  if (g.remoteServer && opts.remote) {
    g.remoteServer.listen(opts.remote.port ?? DEFAULTS.port, opts.remote.host, () => console.log(`kimi-gate remoto: http://${opts.remote!.host}:${opts.remote!.port ?? DEFAULTS.port} (só Tailscale, exige token — veja data/gate-remote-token.txt)`));
  }
}
