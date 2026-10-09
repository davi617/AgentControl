import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overview, taskLane } from '../src/overview.ts';
import { Store } from '../src/store.ts';
import type { Jarvis } from '../src/jarvis.ts';
import type { ProjectCfg } from '../src/config.ts';
import { Jarvis as RealJarvis } from '../src/jarvis.ts';
import { createServer } from '../src/server.ts';
import { searchAll } from '../src/search.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('quadro: revisão humana e aprovação ficam bloqueadas; estado desconhecido não vira conclusão', () => {
  assert.equal(taskLane('NEEDS_HUMAN_REVIEW'), 'blocked');
  assert.equal(taskLane('AWAITING_APPROVAL'), 'blocked');
  assert.equal(taskLane('BLOCKED_QUOTA'), 'blocked');
  assert.equal(taskLane('WORKING — tarefa atual'), 'working');
  assert.equal(taskLane('REVIEW'), 'review');
  assert.equal(taskLane('DONE'), 'done');
  assert.equal(taskLane('DONEISH'), 'waiting');
  assert.equal(taskLane(null), 'waiting');
});

const p: ProjectCfg = { id: 'p', name: 'Projeto', vault: '/vault', activeGoalFile: 'ACTIVE.md', goalsDir: 'goals', agents: [] };
const state = () => ({
  goal: 'G-1', looks: {},
  agents: [{ id: 'CODEX', name: 'Codex', worktree: '/private/worktree', model: 'modelo', statusFileMtime: '2026-10-09T10:00:00', vaultCopyStale: true, done: false, lastLog: ['log privado'], latest: { heading: 'Entrega', task: 'T-1', status: 'WORKING', model: 'modelo', ts: '2026-10-09T10:00:00' } }],
  locks: [{ name: 'slot', pid: 77, alive: false, path: '/private/lock' }],
  tasks: ['QUEUED', 'WORKING', 'BLOCKED', 'REVIEW', 'DONE'].map((status, i) => ({ id: `T-${i}`, owner: 'CODEX', task: `Trabalho ${i}`, status, gate: '', table: 'Sprint' })),
});

test('overview: números consideram o histórico inteiro, isolam projetos e usam o dia local', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 180; i++) store.addCommand({ project: 'p', code: `J-${i}`, target: 'CODEX', text: 'ação', requires_approval: 1, approval: 'pending', status: 'AWAITING_APPROVAL', updated_by: null, created_at: '2026-10-08T20:00:00', updated_at: '2026-10-08T20:00:00' });
    store.addCommand({ project: 'p', code: 'J-done', target: 'CODEX', text: 'feito', requires_approval: 0, approval: null, status: 'DONE', updated_by: 'CODEX', created_at: '2026-10-08T20:00:00', updated_at: '2026-10-09T00:01:00' });
    store.addCommand({ project: 'p', code: 'J-old', target: 'CODEX', text: 'ontem', requires_approval: 0, approval: null, status: 'DONE', updated_by: 'CODEX', created_at: '2026-10-08T20:00:00', updated_at: '2026-10-08T23:59:00' });
    store.addCommand({ project: 'other', code: 'J-other', target: 'CLAUDE', text: 'Outro projeto', requires_approval: 1, approval: 'pending', status: 'DONE', updated_by: null, created_at: '2026-10-09T00:01:00', updated_at: '2026-10-09T00:01:00' });
    const result = overview({ store, state } as Pick<Jarvis, 'state' | 'store'>, p, new Date(2026, 9, 9, 12));
    assert.equal(result.commands.counts.total, 182);
    assert.equal(result.commands.counts.pending, 180);
    assert.equal(result.commands.counts.doneToday, 1);
    assert.equal(result.commands.recent.length, 30);
    assert.equal(result.commands.pending.length, 20);
    assert.equal(result.progress.percent, 20);
    assert.equal(result.progress.blocked, 1);
    assert.equal(result.progress.review, 1);
    assert.equal(result.day, '2026-10-09');
    assert.ok(!JSON.stringify(result).includes('/private/'), 'snapshot da central não inclui paths ou logs das worktrees');
    assert.match(result.alerts[0], /77/);
  } finally { store.close(); }
});

test('overview: projeto sem Goal, agentes ou comandos devolve zeros e listas vazias', () => {
  const store = new Store(':memory:');
  try {
    const result = overview({ store, state: () => ({ goal: null, looks: {}, agents: [], tasks: [], locks: [] }) }, p);
    assert.equal(result.progress.percent, 0);
    assert.equal(result.commands.counts.pending, 0);
    assert.equal(result.commands.counts.doneToday, 0);
    assert.deepEqual(result.tasks, []);
    assert.deepEqual(result.commands.pending, []);
  } finally { store.close(); }
});

test('rota overview: exige autenticação no remoto, aceita o dono e responde 503 em falha de leitura', () => {
  const store = new Store(':memory:');
  const j = new RealJarvis({ host: '127.0.0.1', port: 20150, db: ':memory:', summary: { enabled: false, routerUrl: 'http://127.0.0.1:9', keyFile: '', models: [], allowedPrefixes: [], minIntervalMinutes: 1, maxInputChars: 1000 }, projects: [p] }, store);
  const server = createServer(j, { host: '127.0.0.1', port: 20150, token: 'test-token-for-owner' });
  // Exercita o handler real sem abrir sockets (ambiente de desenvolvimento restrito).
  const get = (url: string, authenticated: boolean) => {
    let status = 0, body = '';
    const req = { method: 'GET', url, headers: { host: '127.0.0.1:20150', ...(authenticated ? { authorization: 'Bearer test-token-for-owner' } : {}) }, socket: { remoteAddress: '127.0.0.1' } };
    const res = { writeHead(code: number) { status = code; return this; }, end(text: string) { body = text; } };
    server.emit('request', req, res);
    return { status, body };
  };
  try {
    assert.equal(get('/api/overview?project=p', false).status, 401);
    assert.equal(get('/missions.js', false).status, 401);
    assert.equal(get('/api/overview?project=p', true).status, 200);
    assert.equal(get('/missions.js', true).status, 200);
    assert.equal(get('/api/overview?project=unknown', true).status, 404);
    j.state = () => { throw new Error('arquivo indisponível'); };
    const failed = get('/api/overview?project=p', true);
    assert.equal(failed.status, 503);
    assert.doesNotMatch(failed.body, /arquivo indisponível/);
  } finally { server.emit('close'); store.close(); }
});

test('busca: mensagens da sala não escondem tarefas, comandos e notas', () => {
  const store = new Store(':memory:');
  const vault = mkdtempSync(path.join(tmpdir(), 'agentcontrol-search-'));
  try {
    mkdirSync(path.join(vault, 'notes'));
    writeFileSync(path.join(vault, 'notes', 'missao.md'), '# Missão\nPlano da missão');
    for (let i = 0; i < 40; i++) store.insert({ project: 'p', source: 'chat', kind: 'chat', agent: 'CODEX', heading: 'Missão', body: 'Atualização da missão', hash: `chat-${i}`, task: null, status: null, model: null, ts: '2026-10-09T10:00:00', seen_at: '2026-10-09T10:00:00', initial: 0 });
    store.addCommand({ project: 'p', code: 'J-search', target: 'CODEX', text: 'missão', requires_approval: 0, approval: null, status: 'NEW', updated_by: null, created_at: '2026-10-09T10:00:00', updated_at: '2026-10-09T10:00:00' });
    const hits = searchAll({ store, state: () => ({ ...state(), tasks: [{ id: 'T-search', owner: 'CLAUDE', status: 'QUEUED', task: 'Missão nova', gate: '', table: 'Sprint' }] }) }, { ...p, vault }, 'missao');
    assert.equal(hits.length, 30);
    assert.deepEqual(hits.slice(0, 4).map((h) => h.kind), ['sala', 'comando', 'tarefa', 'nota']);
  } finally { store.close(); rmSync(vault, { recursive: true, force: true }); }
});
