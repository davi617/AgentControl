import assert from 'node:assert/strict';
import test from 'node:test';
import { missionReport } from '../public/missions.js';

test('relatório para outros agentes preserva bloqueios e aprovações sem conceder autorização', () => {
  const report = missionReport({ project: { name: 'Projeto' }, generatedAt: '2026-10-09T12:00:00Z', day: '2026-10-09', goal: 'G-1', progress: { done: 1, total: 2, percent: 50 }, agents: [{ id: 'CLAUDE', status: 'BLOCKED', task: 'T-2', updatedAt: null }], tasks: [{ id: 'T-2', owner: 'CLAUDE', status: 'BLOCKED', task: 'Revisão', gate: 'revisor' }], commands: { counts: { pending: 1, doneToday: 0 }, recent: [{ code: 'J-1', target: 'CODEX', status: 'AWAITING_APPROVAL', approval: 'pending', text: 'Publicar\nConfirmar antes' }] } });
  assert.match(report, /1\/2 tarefas concluídas/);
  assert.match(report, /CLAUDE: BLOCKED/);
  assert.match(report, /aprovação: pending/);
  assert.match(report, /Publicar\n  Confirmar antes/);
  assert.match(report, /não novas autorizações/);
});
