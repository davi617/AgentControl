// Saúde: log dos loops, fila travada e fila desligada viram alertas claros. Sem rede real.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { health, parseLoopLog } from '../src/health.ts';

test('parseLoopLog: rodadas, timeouts e estado atual', () => {
  const log = ['[2026-09-26T16:00:00] START end=x', '[2026-09-26T16:00:01] RUN a.cmd', '[2026-09-26T16:45:01] TIMEOUT pid=1',
    '[2026-09-26T16:45:40] RUN a.cmd', '[2026-09-26T16:50:00] EXIT code=0', '[2026-09-26T16:50:30] RUN a.cmd'].join('\r\n');
  const l = parseLoopLog('CLAUDE', log, new Date('2026-09-26T17:00:30'));
  assert.equal(l.rodadas, 3);
  assert.equal(l.timeouts, 1);
  assert.equal(l.estado, 'rodando');
  assert.equal(l.minutos, 10);
  assert.equal(parseLoopLog('X', '[2026-09-26T16:00:00] RUN a\n[2026-09-26T16:01:00] WAIT_RAM').estado, 'esperando RAM');
  assert.equal(parseLoopLog('X', '').estado, 'parado');
  // loop sem ordem nova no INBOX/TASKS não roda (não gasta cota): estado próprio, não é erro
  assert.equal(parseLoopLog('X', '[2026-09-26T16:00:00] RUN a\n[2026-09-26T16:05:00] EXIT code=0\n[2026-09-26T16:05:30] IDLE sem ordem nova').estado, 'esperando ordem');
});

const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jarvis-health-'));
  mkdirSync(path.join(dir, 'night-logs'));
  writeFileSync(path.join(dir, 'night-logs', 'hermes.log'), '[2026-09-26T16:00:00] RUN h.cmd\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = { modelsDir: dir } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = { routerUrl: 'http://127.0.0.1:20129/v1' } as any;
  return { p, s };
};

test('health: log ilegível mantém saúde e alerta de estado desconhecido', async (t) => {
  const { p, s } = setup();
  t.after(() => rmSync(p.modelsDir, { recursive: true, force: true }));
  mkdirSync(path.join(p.modelsDir, 'night-logs', 'claude.log'));
  const h = await health(p, s, (async () => { throw new Error('offline'); }) as typeof fetch);
  assert.ok(h.ram.totalMb > 0);
  assert.ok(h.loops.some(l => l.agent === 'HERMES'));
  assert.match(h.alertas.join('\n'), /Não consegui ler o estado de CLAUDE/);
});

test('health: fila travada (pedido preso > 10 min com fila) vira alerta', async () => {
  const { p, s } = setup();
  const fake = (async (u: string) => {
    assert.equal(u, 'http://127.0.0.1:20129/gate/status');
    return new Response(JSON.stringify({ inFlight: 3, queued: 47, voiceMode: false, ativos: [{ segundos: 2700, voz: false }] }));
  }) as unknown as typeof fetch;
  const h = await health(p, s, fake);
  assert.equal(h.gate.travada, true);
  assert.match(h.alertas.join('\n'), /Fila travada/);
  assert.equal(h.loops[0].agent, 'HERMES');
  assert.ok(h.ram.totalMb > 0);
});

test('health: fila desligada vira alerta, sem quebrar', async () => {
  const { p, s } = setup();
  const h = await health(p, s, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
  assert.equal(h.gate.ok, false);
  assert.match(h.alertas.join('\n'), /não responde/);
});

test('health: erro HTTP com JSON não vira fila saudável', async (t) => {
  const { p, s } = setup();
  t.after(() => rmSync(p.modelsDir, { recursive: true, force: true }));
  for (const status of [401, 503]) {
    const fake = (async () => new Response(JSON.stringify({ error: 'unavailable' }), { status })) as typeof fetch;
    const h = await health(p, s, fake);
    assert.equal(h.gate.ok, false, `HTTP ${status}`);
    assert.match(h.alertas.join('\n'), /não responde/);
    assert.ok(h.ram.totalMb > 0);
    assert.equal(h.loops[0].agent, 'HERMES');
  }
});

test('pausa: PAUSE para os agentes; "agora" corta a rodada; retomar apaga; saúde mostra', async () => {
  const { setPause, pauseState } = await import('../src/control.ts');
  const dir = mkdtempSync(path.join(tmpdir(), 'jarvis-pause-'));
  assert.equal(pauseState(dir).paused, false);
  assert.deepEqual({ ...setPause(dir, true, true), desde: null }, { paused: true, agora: true, desde: null });
  assert.equal(setPause(dir, true).agora, false, 'pausar sem "agora" deixa a rodada terminar');
  assert.equal(setPause(dir, false).paused, false);
  assert.equal(parseLoopLog('X', '[2026-09-26T16:00:00] RUN a\n[2026-09-26T16:01:00] STOPPED pelo dono pid=1\n[2026-09-26T16:01:30] PAUSED pelo dono').estado, 'pausado');
});
