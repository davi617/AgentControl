// Fila para agentes fora do PC (Termux no celular, 2026-09-27): só no host do Tailscale, exige token,
// e continua dividindo a MESMA cota (Slots) com os agentes locais.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createGate } from '../src/gate.ts';

const listen = (s: http.Server): Promise<number> => new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const servers: http.Server[] = [];

test.afterEach(() => { for (const s of servers.splice(0)) s.close(); });

test('fila remota: sem token nem host certo, recusa; com os dois, atende e usa as mesmas vagas', async () => {
  const up = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":1}'); });
  servers.push(up);
  const upPort = await listen(up);
  // Porta livre reservada de antemão: o "Host" checado dentro do gate precisa bater com a porta real do listen().
  const probe = http.createServer();
  const rport = await listen(probe);
  probe.close();
  const g = createGate({ port: 0, upstream: `http://127.0.0.1:${upPort}`, maxConcurrent: 1, maxRetries: 0, maxWaitMs: 1_000, baseBackoffMs: 10, remote: { host: '127.0.0.1', token: 'segredo-do-celular', port: rport } });
  servers.push(g.server, g.remoteServer!);
  await new Promise<void>((r) => g.remoteServer!.listen(rport, '127.0.0.1', r));
  // fetch() não deixa forjar o header Host (o Fetch spec bloqueia); http.request deixa — é o único jeito de testar
  // o "host de fora" de verdade, do mesmo jeito que test/e2e.test.ts testa o anti-DNS-rebinding do server.ts.
  const call = (headers: Record<string, string>) => new Promise<number>((resolve) => {
    http.request({ host: '127.0.0.1', port: rport, path: '/v1/chat/completions', method: 'POST', headers }, (res) => { res.resume(); resolve(res.statusCode!); }).end('{"model":"nvidia/x"}');
  });

  assert.equal(await call({}), 401, 'sem token');
  assert.equal(await call({ Authorization: 'Bearer errado' }), 401, 'token errado');
  assert.equal(await call({ Authorization: 'Bearer segredo-do-celular', Host: 'outro-host:9999' }), 403, 'host de fora');

  const status = await call({ Authorization: 'Bearer segredo-do-celular', Host: `127.0.0.1:${rport}` });
  assert.equal(status, 200);
  assert.equal(g.stats.requests, 1, 'só a chamada válida consumiu cota');
  assert.equal(g.slots.inFlight, 0, 'vaga devolvida');
});

test('sem opts.remote, não abre segunda porta nenhuma (comportamento de hoje continua igual)', () => {
  const g = createGate({ port: 0, upstream: 'http://127.0.0.1:1', maxConcurrent: 1, maxRetries: 0, maxWaitMs: 1000, baseBackoffMs: 10 });
  servers.push(g.server);
  assert.equal(g.remoteServer, undefined);
});
