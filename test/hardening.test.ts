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
