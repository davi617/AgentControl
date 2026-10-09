import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiresApproval } from '../src/commands.ts';
import { Store } from '../src/store.ts';

test('comandos de disco e sistema ficam parados até aprovar', () => {
  for (const t of ['rode mkfs.ext4 /dev/sdb1', 'dd if=/dev/zero of=/dev/sda', 'shutdown agora', 'sudo rm arquivo']) assert.ok(requiresApproval(t), t);
  assert.equal(requiresApproval('rode os testes e me conte'), false);
});

test('commandsSince devolve só comandos do período', () => {
  const s = new Store(':memory:');
  const mk = (code: string, at: string) => s.addCommand({ project: 'p', code, target: 'LEADER', text: 'x', requires_approval: 0, approval: null, status: 'NEW', updated_by: null, created_at: at, updated_at: at });
  mk('J-001', '2026-01-01T00:00:00'); mk('J-002', '2026-02-01T00:00:00');
  assert.deepEqual(s.commandsSince('p', '2026-01-15T00:00:00').map((c) => c.code), ['J-002']);
});

test('feed: continuar de uma página segue a ordem por data, sem pular nem repetir', () => {
  const s = new Store(':memory:');
  const add = (n: string, ts: string) => s.insert({ project: 'p', source: 's', kind: 'chat', agent: 'A', heading: n, body: n, hash: n, task: null, status: null, model: null, ts, seen_at: ts, initial: 0 });
  // id 1 é o mais antigo em id mas o mais novo em data
  add('x1', '2026-03-01T00:00:00'); add('x2', '2026-01-01T00:00:00'); add('x3', '2026-02-01T00:00:00'); add('x4', '2025-12-01T00:00:00');
  const p1 = s.feed('p', { limit: 2 });
  assert.deepEqual(p1.map((e) => e.heading), ['x1', 'x3']);
  const p2 = s.feed('p', { limit: 2, before: p1.at(-1)!.id });
  assert.deepEqual(p2.map((e) => e.heading), ['x2', 'x4']);
});
