// 10 funcionalidades novas (pedido do dono, 2026-09-26): notas rápidas, favoritos, atalhos, alertas
// configuráveis, estatísticas do time, busca única e o widget de CPU/disco na Saúde.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cpuPercent, diskFree } from '../src/health.ts';
import { addNote, readNotesFile, syncNotesFile } from '../src/notes.ts';
import { searchAll } from '../src/search.ts';
import { Store } from '../src/store.ts';

function vault() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jarvis-feat-'));
  mkdirSync(path.join(dir, '20-Operations'), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = { id: 'dw', vault: dir, chatDir: undefined, agents: [{ id: 'HERMES' }] } as any;
  return { dir, p };
}

test('store: notas rápidas — adiciona, marca feito, apaga; segredo mascarado no arquivo do vault', () => {
  const s = new Store(':memory:');
  const { p } = vault();
  const n = addNote(s, p, 'ligar pro suporte da NVIDIA, token=abcdefghijklmnop123456');
  assert.equal(s.notes('dw').length, 1);
  assert.doesNotMatch(readNotesFile(p) ?? '', /abcdefghijklmnop123456/);
  s.setNoteDone('dw', n.id, true);
  syncNotesFile(s, p);
  assert.match(readNotesFile(p) ?? '', /- \[x\]/);
  s.deleteNote('dw', n.id);
  assert.equal(s.notes('dw').length, 0);
  assert.throws(() => addNote(s, p, '   '), /vazia/);
});

test('store: favoritos do cérebro — marca, some da lista ao desmarcar, não duplica', () => {
  const s = new Store(':memory:');
  s.addFavorite('dw', '05-Mapas/Painel.md', 'Painel');
  s.addFavorite('dw', '05-Mapas/Painel.md', 'Painel'); // repetido não duplica
  assert.equal(s.favorites('dw').length, 1);
  assert.equal(s.isFavorite('dw', '05-Mapas/Painel.md'), true);
  s.removeFavorite('dw', '05-Mapas/Painel.md');
  assert.equal(s.favorites('dw').length, 0);
});

test('store: atalhos de comando — cria, lista na ordem, apaga', () => {
  const s = new Store(':memory:');
  s.addShortcut('dw', 'Rodar testes', 'roda a suíte de testes da API', 'HERMES');
  s.addShortcut('dw', 'Status geral', 'me dá o status de todo mundo', 'LEADER');
  const list = s.shortcuts('dw');
  assert.deepEqual(list.map((x) => x.label), ['Rodar testes', 'Status geral']);
  s.deleteShortcut('dw', list[0].id);
  assert.equal(s.shortcuts('dw').length, 1);
});

test('store: preferências de alerta — grava e lê por projeto, projeto sem prefs vem vazio', () => {
  const s = new Store(':memory:');
  assert.deepEqual(s.alertPrefs('dw'), {});
  s.setAlertPrefs('dw', { ramBaixa: false, aprovacao: true });
  assert.deepEqual(s.alertPrefs('dw'), { ramBaixa: false, aprovacao: true });
  s.setAlertPrefs('dw', { aprovacao: true });
  assert.deepEqual(s.alertPrefs('dw'), { aprovacao: true }, 'grava por cima, não mescla');
});

test('store: estatísticas do time — conta registros, done e travado por agente, só no período', () => {
  const s = new Store(':memory:');
  const row = (agent: string, status: string, ts: string) => s.insert({ project: 'dw', source: `s-${agent}-${ts}`, kind: 'status', agent, heading: 'h', body: 'b', hash: `${agent}${ts}${status}`, task: null, status, model: null, ts, seen_at: ts, initial: 0 });
  row('HERMES', 'DONE', '2026-09-26T10:00:00');
  row('HERMES', 'BLOCKED_AUTH', '2026-09-26T11:00:00');
  row('HERMES', 'WORKING', '2026-09-20T10:00:00'); // fora do período
  row('CLAUDE', 'DONE', '2026-09-26T12:00:00');
  const stats = s.agentStats('dw', '2026-09-25T00:00:00');
  assert.deepEqual({ ...stats.find((x) => x.agent === 'HERMES') }, { agent: 'HERMES', registros: 2, done: 1, travado: 1 });
  assert.deepEqual({ ...stats.find((x) => x.agent === 'CLAUDE') }, { agent: 'CLAUDE', registros: 1, done: 1, travado: 0 });
});

test('busca única: acha na sala, nos comandos, nas tarefas e no cérebro, sem repetir por engano', () => {
  const s = new Store(':memory:');
  const { p, dir } = vault();
  s.insert({ project: 'dw', source: 's1', kind: 'chat', agent: 'HERMES', heading: 'h', body: '- para: TODOS\n\nprecisamos revisar o deploy de sexta', hash: 'h1', task: null, status: null, model: null, ts: '2026-09-26T10:00', seen_at: '2026-09-26T10:00', initial: 0 });
  s.addCommand({ project: 'dw', code: 'J-001', target: 'HERMES', text: 'revisar o deploy de sexta', requires_approval: 0, approval: null, status: 'NEW', updated_by: null, created_at: '2026-09-26T10:00', updated_at: '2026-09-26T10:00' });
  writeFileSync(path.join(dir, 'deploy.md'), 'Notas sobre o deploy de sexta-feira.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = { store: s, state: () => ({ tasks: [{ id: 'T-030', owner: 'HERMES', status: 'ASSIGNED', task: 'revisar o deploy de sexta', gate: '' }] }) } as any;
  const hits = searchAll(j, p, 'deploy de sexta');
  assert.deepEqual(hits.map((h) => h.kind).sort(), ['comando', 'nota', 'sala', 'tarefa']);
  assert.equal(searchAll(j, p, '').length, 0, 'busca vazia não retorna tudo');
});

test('saúde: CPU vem entre 0 e 100; disco de uma pasta que existe vem preenchido, inexistente vem null', async () => {
  const cpu = await cpuPercent(30);
  assert.ok(cpu >= 0 && cpu <= 100, `cpu=${cpu}`);
  const { dir } = vault();
  const d = diskFree(dir);
  assert.ok(d && d.totalMb > 0 && d.livreMb >= 0);
  assert.equal(diskFree('Z:/nao-existe-de-jeito-nenhum'), null);
});
