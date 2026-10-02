// Uso por agente na fila (2026-09-27): quem gastou quantos pedidos e tokens da NVIDIA.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGate } from '../src/gate.ts';
import { agentFromUrl, tokensFrom, Usage } from '../src/usage.ts';

test('agentFromUrl: prefixo /a/<agente> identifica e sai do endereço; sem prefixo decide pela prioridade', () => {
  assert.deepEqual(agentFromUrl('/a/hermes/v1/chat/completions', ''), { agent: 'HERMES', url: '/v1/chat/completions' });
  assert.deepEqual(agentFromUrl('/v1/chat/completions', 'voz'), { agent: 'CHAMADA', url: '/v1/chat/completions' });
  assert.deepEqual(agentFromUrl('/v1/chat/completions', 'alta'), { agent: 'JARVIS', url: '/v1/chat/completions' });
  assert.equal(agentFromUrl('/v1/models', '').agent, 'OUTRO');
});

test('tokensFrom: formato OpenAI (JSON e stream) e Anthropic; o último valor vence', () => {
  assert.deepEqual(tokensFrom('{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}'), { pin: 120, pout: 30 });
  assert.deepEqual(tokensFrom('data: {"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":44}}\n\ndata: [DONE]'), { pin: 5, pout: 44 });
  assert.deepEqual(tokensFrom('event: message_delta\ndata: {"usage":{"input_tokens":900,"output_tokens":77}}'), { pin: 900, pout: 77 });
  assert.deepEqual(tokensFrom('sem uso nenhum'), { pin: 0, pout: 0 });
});

test('Usage: soma por agente e por dia, média de tempo, modelos; grava e relê do arquivo', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'jarvis-usage-')), 'u.json');
  const u = new Usage(file);
  const hoje = new Date('2026-09-27T12:00:00');
  u.record('HERMES', 'nvidia/moonshotai/kimi-k3', { status: 200, ms: 1000, pin: 100, pout: 10 }, hoje);
  u.record('HERMES', 'nvidia/moonshotai/kimi-k3', { status: 500, ms: 3000, pin: 0, pout: 0 }, hoje);
  u.hit429('HERMES', hoje);
  u.record('CLAUDE', 'nvidia/z-ai/glm-5.3', { status: 200, ms: 500, pin: 50, pout: 5 }, new Date('2026-09-26T12:00:00'));
  const s = u.snapshot(7, hoje);
  const h = s.agentes.find((a) => a.agent === 'HERMES')!;
  assert.equal(h.req, 2); assert.equal(h.ok, 1); assert.equal(h.err, 1); assert.equal(h.r429, 1);
  assert.equal(h.pin + h.pout, 110); assert.equal(h.msMedio, 2000);
  assert.equal(s.agentes[0].agent, 'HERMES', 'quem usou mais vem primeiro');
  assert.equal(s.porDia.length, 7);
  assert.equal(s.porDia.at(-1)!.req, 2, 'hoje');
  assert.equal(s.porDia.at(-2)!.req, 1, 'ontem');
  u.flush();
  assert.equal(new Usage(file).snapshot(7, hoje).agentes.length, 2, 'relê do arquivo');
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).days);
});

test('fila: pedido por /a/qwen/… chega ao 9Router sem o prefixo e conta tokens para o QWEN', async () => {
  let seenPath = '';
  const up = http.createServer((req, res) => { seenPath = req.url ?? ''; req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"usage":{"prompt_tokens":12,"completion_tokens":3}}'); });
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', r));
  const g = createGate({ port: 0, upstream: `http://127.0.0.1:${(up.address() as AddressInfo).port}`, maxConcurrent: 1, maxRetries: 0, maxWaitMs: 1000, baseBackoffMs: 10 });
  await new Promise<void>((r) => g.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
  await (await fetch(`${base}/a/qwen/v1/chat/completions`, { method: 'POST', body: '{"model":"nvidia/moonshotai/kimi-k3"}' })).text();
  assert.equal(seenPath, '/v1/chat/completions', '9Router não vê o prefixo');
  const u = await (await fetch(`${base}/gate/usage?dias=1`)).json();
  assert.equal(u.agentes[0].agent, 'QWEN');
  assert.equal(u.agentes[0].pin, 12);
  assert.equal(u.agentes[0].pout, 3);
  assert.deepEqual(u.agentes[0].models, { 'nvidia/moonshotai/kimi-k3': 1 });
  g.server.close(); up.close();
});
