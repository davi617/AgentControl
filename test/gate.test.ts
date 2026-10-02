import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { createGate, rateLimitWait, Slots } from '../src/gate.ts';

// Upstream falso no lugar do 9Router: conta concorrência e devolve 429 quando mandado.
function fakeUpstream(plan: (n: number) => { status: number; body: string; delayMs?: number }) {
  let n = 0, live = 0, peak = 0;
  const srv = http.createServer((req, res) => {
    const i = n++; live++; peak = Math.max(peak, live);
    req.resume();
    const p = plan(i);
    setTimeout(() => { res.writeHead(p.status, { 'content-type': 'application/json' }); res.end(p.body); live--; }, p.delayMs ?? 5);
  });
  return { srv, stats: () => ({ calls: n, peak }) };
}
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
const servers: http.Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function setup(plan: Parameters<typeof fakeUpstream>[0], maxConcurrent = 2) {
  const up = fakeUpstream(plan); servers.push(up.srv);
  const upPort = await listen(up.srv);
  const g = createGate({ port: 0, upstream: `http://127.0.0.1:${upPort}`, maxConcurrent, maxRetries: 3, maxWaitMs: 5_000, baseBackoffMs: 10 });
  servers.push(g.server);
  const port = await listen(g.server);
  const call = async () => { const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{"model":"x"}' }); return { status: r.status, body: await r.text() }; };
  return { up, g, call };
}

test('rateLimitWait: 429 direto, 503 embrulhando 429 e outros erros', () => {
  assert.equal(rateLimitWait(200, '', undefined, 0, 10), null);
  assert.equal(rateLimitWait(503, '{"error":"model gone"}', undefined, 0, 10), null);
  assert.ok((rateLimitWait(429, '', undefined, 0, 10) ?? 0) >= 10);
  const wrapped = rateLimitWait(503, '[nvidia/moonshotai/kimi-k3] [429]: rate (reset after 8s)', undefined, 0, 10);
  assert.ok(wrapped !== null && wrapped >= 8000, 'respeita o "reset after" do 9Router');
  assert.ok((rateLimitWait(429, '', '3', 0, 10) ?? 0) >= 3000, 'respeita Retry-After');
  assert.ok((rateLimitWait(429, '', undefined, 20, 2000) ?? 0) <= 30_500, 'backoff tem teto de 30 s');
});

test('Slots: nunca passa do máximo e atende em ordem', async () => {
  const s = new Slots(2); const order: number[] = [];
  await s.acquire(); await s.acquire();
  const p3 = s.acquire().then(() => order.push(3));
  const p4 = s.acquire().then(() => order.push(4));
  assert.equal(s.inFlight, 2); assert.equal(s.queued, 2);
  s.release(); await p3; s.release(); await p4;
  assert.deepEqual(order, [3, 4]);
});

test('segura a concorrência no máximo configurado', async () => {
  const { up, call } = await setup(() => ({ status: 200, body: '{"ok":true}', delayMs: 40 }), 2);
  const rs = await Promise.all(Array.from({ length: 6 }, call));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(up.stats().peak, 2);
});

test('429 vira espera e nova tentativa (o agente vê 200)', async () => {
  const { up, g, call } = await setup((i) => (i < 2 ? { status: 503, body: '[nvidia/x] [429]: slow down' } : { status: 200, body: '{"ok":true}' }));
  const r = await call();
  assert.equal(r.status, 200);
  assert.equal(up.stats().calls, 3);
  assert.equal(g.stats.retried429, 2);
});

test('desiste depois do máximo de tentativas e devolve o último erro', async () => {
  const { g, call } = await setup(() => ({ status: 429, body: '{"error":"rate"}' }));
  const r = await call();
  assert.equal(r.status, 429);
  assert.equal(g.stats.gaveUp, 1);
});

test('erro que não é limite passa direto, sem tentar de novo', async () => {
  const { up, call } = await setup(() => ({ status: 410, body: '{"error":"gone"}' }));
  const r = await call();
  assert.equal(r.status, 410);
  assert.equal(up.stats().calls, 1);
});

test('Slots: pedido prioritário (chamada de voz) passa na frente dos de fundo', async () => {
  const s = new Slots(1); const order: string[] = [];
  await s.acquire();
  const a = s.acquire().then(() => { order.push('fundo-1'); s.release(); });
  const b = s.acquire().then(() => { order.push('fundo-2'); s.release(); });
  const c = s.acquire(true).then(() => { order.push('voz'); s.release(); });
  assert.equal(s.queued, 3);
  s.release();
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['voz', 'fundo-1', 'fundo-2']);
});

test('Slots: vaga reservada para a voz, os de fundo não ocupam', async () => {
  const s = new Slots(2, 1);
  await s.acquire();                       // fundo pega 1 (máx. de fundo = 1)
  let fundo = false; void s.acquire().then(() => { fundo = true; });
  let voz = false; void s.acquire(true).then(() => { voz = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(voz, true, 'voz entra na vaga reservada na hora');
  assert.equal(fundo, false, 'fundo espera');
  s.release(); s.release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fundo, true);
});

test('Slots: em modo voz os de fundo esperam e voltam sozinhos quando acaba', async () => {
  const s = new Slots(4, 1);
  s.boost(400); // folga para PC carregado (60 ms falhava com os agentes rodando)
  assert.equal(s.voiceMode, true);
  let fundo = false; void s.acquire().then(() => { fundo = true; });
  let voz = 0; for (let i = 0; i < 3; i++) void s.acquire(true).then(() => { voz++; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fundo, false, 'fundo não começa pedido novo');
  assert.equal(voz, 3, 'voz usa as vagas');
  s.release(); s.release(); s.release(); // as falas terminaram, ainda em modo voz
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fundo, false, 'vaga livre, mas modo voz ainda segura o fundo');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(s.voiceMode, false);
  assert.equal(fundo, true, 'acabou o modo voz: fundo anda sozinho, sem ninguém liberar vaga');
});

test('9Router pendurado: pedido é cortado e a vaga volta (bug de 2026-09-26 que parou todos os agentes)', async () => {
  // Um upstream que aceita e nunca responde; outro que para no meio do stream.
  const hung = http.createServer((req) => { req.resume(); });
  const half = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"a":1}\n\n'); });
  servers.push(hung, half);
  for (const srv of [hung, half]) {
    const upPort = await listen(srv);
    const g = createGate({ port: 0, upstream: `http://127.0.0.1:${upPort}`, maxConcurrent: 1, maxRetries: 0, maxWaitMs: 1_000, baseBackoffMs: 10, idleTimeoutMs: 150 });
    servers.push(g.server);
    const port = await listen(g.server);
    const t = Date.now();
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{"model":"nvidia/x"}' }).then((x) => x.text()).catch(() => 'cortado');
    assert.ok(Date.now() - t < 2_000, 'não fica esperando para sempre');
    assert.ok(r.length >= 0);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(g.slots.inFlight, 0, 'vaga liberada');
    assert.equal(g.stats.cut, 1);
    const st = await (await fetch(`http://127.0.0.1:${port}/gate/status`)).json();
    assert.deepEqual(st.ativos, [], 'status mostra quem ocupa as vagas');
  }
});

test('prioridade: "alta" (chat) fura a fila sem ligar o modo voz; "voz" (chamada) liga', async () => {
  const up = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":1}'); });
  servers.push(up);
  const upPort = await listen(up);
  const g = createGate({ port: 0, upstream: `http://127.0.0.1:${upPort}`, maxConcurrent: 2, maxRetries: 0, maxWaitMs: 1_000, baseBackoffMs: 10 });
  servers.push(g.server);
  const port = await listen(g.server);
  const post = (pr: string) => fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'X-Gate-Priority': pr }, body: '{"model":"nvidia/x"}' }).then((r) => r.text());
  await post('alta');
  assert.equal(g.slots.voiceMode, false, 'resposta do chat não pausa os agentes');
  await post('voz');
  assert.equal(g.slots.voiceMode, true);
});
test('cliente desiste com o 9Router pendurado: vaga solta na hora, não depois de 5 min (chamada "morria")', async () => {
  const hung = http.createServer((req) => { req.resume(); });
  servers.push(hung);
  const upPort = await listen(hung);
  const g = createGate({ port: 0, upstream: `http://127.0.0.1:${upPort}`, maxConcurrent: 1, maxRetries: 0, maxWaitMs: 1_000, baseBackoffMs: 10, idleTimeoutMs: 60_000 });
  servers.push(g.server);
  const port = await listen(g.server);
  await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', body: '{"model":"nvidia/z-ai/glm-5.3"}', signal: AbortSignal.timeout(150) }).catch(() => null);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(g.slots.inFlight, 0, 'vaga liberada logo que o cliente desistiu');
  assert.equal(g.stats.abandoned, 1);
  assert.equal(g.stats.cut, 0, 'não precisou esperar o corte de 60 s');
});