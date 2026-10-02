import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalStatus, parseTasks, readKey, splitSections, statusInText } from '../src/parser.ts';

// Trechos reduzidos dos 4 formatos reais encontrados na Fase 0 (F4).

test('contrato com travessão (CLAUDE/DROID)', () => {
  const s = splitSections(`# STATUS

## 2026-09-23 00:20 — CLAUDE (TECHNICAL_ORCHESTRATOR)
- task: T-026 (+ Wave 2 technical orchestration)
- status: DONE
- model: \`claude-opus-5\` (Claude Code, native authentication)
- evidence: 17 PASS / 0 FAIL`);
  assert.equal(s.length, 1);
  assert.equal(s[0].date, '2026-09-23');
  assert.equal(s[0].time, '00:20');
  assert.equal(s[0].agent, 'CLAUDE');
  assert.equal(s[0].fields.task, 'T-026 (+ Wave 2 technical orchestration)');
  assert.equal(canonicalStatus(s[0].fields.status), 'DONE');
});

test('contrato com hífen (CODEX) e várias entradas', () => {
  const s = splitSections(`# STATUS

## 2026-09-22 19:45 - CODEX
- task: T-010 + T-021
- status: DONE

## 2026-09-21 22:09 — CODEX
- task: T-010
- status: BLOCKED
- blocker: index.lock Permission denied`);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => [x.date, x.time, x.agent]), [['2026-09-22', '19:45', 'CODEX'], ['2026-09-21', '22:09', 'CODEX']]);
  assert.equal(canonicalStatus(s[1].fields.status), 'BLOCKED');
});

test('relatório livre por seções (HERMES/OPENCODE/OPENCLAW): ### fica dentro da seção-mãe', () => {
  const s = splitSections(`# STATUS — T-003 AND T-008 EXECUTION

## T-003 Summary

### Ack
- Task: T-003
- Model: kr/qwen3-coder-next-agentic

### Evidence
- Results: 22/22 tests passed

## Next
Awaiting coordination update.`);
  assert.deepEqual(s.map((x) => x.heading), ['T-003 Summary', 'Next']);
  assert.equal(s[0].date, undefined);
  assert.equal(s[0].fields.task, 'T-003');
  assert.equal(s[0].fields.model, 'kr/qwen3-coder-next-agentic');
  assert.match(s[0].body, /22\/22 tests passed/);
});

test('placeholder sem ## (QWEN) vira uma seção com o título do #', () => {
  const s = splitSections('# STATUS\n\nAguardando ACK.');
  assert.equal(s.length, 1);
  assert.equal(s[0].heading, 'STATUS');
  assert.equal(s[0].body, 'Aguardando ACK.');
});

test('arquivo vazio não gera seção', () => {
  assert.deepEqual(splitSections('  \n'), []);
});

test('## dentro de bloco de código não quebra a seção', () => {
  const s = splitSections('## 2026-09-21 10:20 — Reunião\n```md\n## 2026-09-21 HH:mm — <AGENTE>\n- task: <T-xxx>\n```\nfim');
  assert.equal(s.length, 1);
  assert.match(s[0].body, /fim$/);
});

test('modelo de formato (``` ou placeholders) não vira status real — caso do LEADER.md', () => {
  const s = splitSections('## Formato obrigatório de resposta\n\n```md\n- task: <T-xxx>\n- status: ACK | WORKING | BLOCKED\n```\n- status: ACK | WORKING\n- task: <T-xxx>');
  assert.deepEqual(s[0].fields, {});
});

test('hash muda quando o conteúdo muda e é estável quando não muda', () => {
  const a = splitSections('## X\nabc')[0].hash;
  assert.equal(splitSections('## X\nabc')[0].hash, a);
  assert.notEqual(splitSections('## X\nabd')[0].hash, a);
});

test('canonicalStatus', () => {
  assert.equal(canonicalStatus('BLOCKED_QUOTA'), 'BLOCKED');
  assert.equal(canonicalStatus('`WORKING`'), 'WORKING');
  assert.equal(canonicalStatus('IDLE_NO_SAFE_TASK'), 'IDLE_NO_SAFE_TASK');
  assert.equal(canonicalStatus(undefined), undefined);
});

test('parseTasks lê as duas tabelas reais (ID|Owner|Status|Task|Gate e …|Target)', () => {
  const rows = parseTasks(`# TASKS

| ID | Owner | Status | Task | Gate |
|---|---|---|---|---|
| T-001 | CHATGPT | DONE | Tornar E2E local reproduzível | e2e 3 pass |
| T-010 | CODEX | WORKING | Juiz final | revisão |

## Regra de claim

- Só o owner edita.

## Wave 2 follow-up tasks — 2026-09-22

| ID | Owner | Status | Task | Target |
|---|---|---|---|---|
| T-022 | CODEX | DONE | Close API/security gaps | 17/17 PASS |`);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], { id: 'T-010', owner: 'CODEX', status: 'WORKING', task: 'Juiz final', gate: 'revisão', table: 'TASKS' });
  assert.equal(rows[2].gate, '17/17 PASS');
  assert.equal(rows[2].table, 'Wave 2 follow-up tasks — 2026-09-22');
});

test('readKey lê ACTIVE_GOAL.md', () => {
  assert.equal(readKey('- status: `ACTIVE`\n- goal: `GOAL-2026-09-21-PROJETO-BETA-READINESS`', 'goal'), 'GOAL-2026-09-21-PROJETO-BETA-READINESS');
});

test('requiresApproval: ações protegidas', async () => {
  const { requiresApproval } = await import('../src/commands.ts');
  for (const t of ['faça deploy', 'dá push na branch', 'merge na main', 'publica o release', 'apaga os logs', 'compra créditos']) assert.ok(requiresApproval(t), t);
  for (const t of ['rode os testes da T-022', 'me dá um resumo', 'revise o STATUS do Hermes']) assert.ok(!requiresApproval(t), t);
});

test('statusInText: status dentro do texto da tarefa quando não há campo status', () => {
  assert.equal(statusInText('T-007 (DONE desde 19:13:35Z; regressões #1…)'), 'DONE');
  assert.equal(statusInText('T-019 BLOCKED_AUTH na Factory'), undefined, 'BLOCKED_AUTH não é BLOCKED solto');
  assert.equal(statusInText('T-012 working'), 'WORKING');
  assert.equal(statusInText('T-003'), undefined);
});