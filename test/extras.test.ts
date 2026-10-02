// Pacote de funções (2026-09-27): histórico de chamadas, diário do dia, comandos por dia, "Sobre".
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { about, commandsPerDay, listCalls, writeDiary } from '../src/extras.ts';
import { Store } from '../src/store.ts';

function setup() {
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-extras-'));
  const calls = path.join(vault, '20-Operations', 'Calls');
  mkdirSync(calls, { recursive: true });
  writeFileSync(path.join(calls, 'CALL-2026-09-27-10-00-05.md'), '---\ndata: 2026-09-27\n---\n# CALL-2026-09-27-10-00-05 · plano da beta\n\n**DONO** (10:00): oi\n\n**HERMES** (10:01): bora\n\n## Resumo da chamada\n\n### Tarefas\n- [ ] **HERMES**: rodar testes\n');
  writeFileSync(path.join(calls, 'CALL-2026-09-26-09-00-00.md'), '# CALL-2026-09-26-09-00-00 · ontem\n\n**DONO** (09:00): oi\n');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = { id: 'dw', vault, agents: [] } as any;
  return { p, vault };
}

test('listCalls: mais nova primeiro, com assunto, falas e tarefas do resumo', () => {
  const { p } = setup();
  const c = listCalls(p);
  assert.deepEqual(c.map((x) => x.id), ['CALL-2026-09-27-10-00-05', 'CALL-2026-09-26-09-00-00']);
  assert.equal(c[0].topic, 'plano da beta');
  assert.equal(c[0].falas, 2);
  assert.equal(c[0].tarefas, 1);
  assert.equal(c[0].path, '20-Operations/Calls/CALL-2026-09-27-10-00-05.md');
});

test('writeDiary: nota do dia com comandos, chamadas, notas e uso da fila; fila fora do ar não quebra', async () => {
  const { p, vault } = setup();
  const s = new Store(':memory:');
  s.addCommand({ project: 'dw', code: 'J-001', target: 'HERMES', text: 'rodar testes', requires_approval: 0, approval: null, status: 'DONE', updated_by: 'HERMES', created_at: '2026-09-27T09:00:00', updated_at: '2026-09-27T09:30:00' });
  s.addCommand({ project: 'dw', code: 'J-002', target: 'CLAUDE', text: 'de ontem', requires_approval: 0, approval: null, status: 'NEW', updated_by: null, created_at: '2026-09-26T09:00:00', updated_at: '2026-09-26T09:00:00' });
  const fake = (async () => new Response(JSON.stringify({ agentes: [{ agent: 'HERMES', req: 3, pin: 100, pout: 20, r429: 1 }] }))) as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = await writeDiary(s, p, { routerUrl: 'http://127.0.0.1:20129/v1' } as any, new Date('2026-09-27T12:00:00'), fake);
  const md = readFileSync(file, 'utf8');
  assert.ok(file.endsWith(path.join('Diario', '2026-09-27.md')));
  assert.match(md, /J-001\*\* → HERMES · DONE/);
  assert.doesNotMatch(md, /J-002/, 'comando de outro dia fica fora');
  assert.match(md, /\[\[CALL-2026-09-27-10-00-05\]\] · plano da beta · 2 falas · 1 tarefas/);
  assert.match(md, /\| HERMES \| 3 \| 120 \| 1 \|/);
  const off = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeDiary(s, p, { routerUrl: 'http://127.0.0.1:20129/v1' } as any, new Date('2026-09-27T13:00:00'), off);
  assert.match(readFileSync(file, 'utf8'), /sem dados/);
  assert.ok(existsSync(path.join(vault, '20-Operations', 'Diario')));
});

test('commandsPerDay: um ponto por dia, com total e concluídos', () => {
  const { p } = setup();
  const s = new Store(':memory:');
  s.addCommand({ project: 'dw', code: 'J-001', target: 'X', text: 'a', requires_approval: 0, approval: null, status: 'DONE', updated_by: null, created_at: '2026-09-27T09:00:00', updated_at: '' });
  s.addCommand({ project: 'dw', code: 'J-002', target: 'X', text: 'b', requires_approval: 0, approval: null, status: 'NEW', updated_by: null, created_at: '2026-09-27T10:00:00', updated_at: '' });
  const d = commandsPerDay(s, p, 3, new Date('2026-09-27T12:00:00'));
  assert.equal(d.length, 3);
  assert.deepEqual(d.at(-1), { dia: '2026-09-27', total: 2, done: 1 });
  assert.deepEqual(d[0], { dia: '2026-09-25', total: 0, done: 0 });
});

test('about: versão do node, tempo ligado do PC e do JARVIS', () => {
  const a = about(path.join(tmpdir(), 'nao-existe', 'jarvis.sqlite'));
  assert.equal(a.jarvis.node, process.version);
  assert.ok(a.pc.ligadoHaMin >= 0 && a.pc.nucleos > 0);
  assert.equal(a.app, null, 'sem app publicado');
});
