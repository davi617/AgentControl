// 2026-10-01: o servidor morria quando o OneDrive travava um STATUS.md durante a sincronização (EBUSY).
// Aqui um "arquivo" que não dá para ler (é uma pasta) faz o mesmo papel: agents() tem que seguir de pé.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ProjectCfg } from '../src/config.ts';
import { agents } from '../src/sources.ts';
import { Store } from '../src/store.ts';

test('agents(): STATUS ilegível (OneDrive travado) não derruba o servidor', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jarvis-locked-'));
  const vault = path.join(root, 'vault');
  const goal = path.join(vault, 'Goals', 'GOAL-X');
  mkdirSync(path.join(goal, 'AGENTS', 'HERMES-STATUS.md'), { recursive: true }); // pasta no lugar do arquivo = leitura falha
  mkdirSync(path.join(vault, '00-System'), { recursive: true });
  writeFileSync(path.join(vault, '00-System', 'ACTIVE_GOAL.md'), '- goal: GOAL-X\n');
  const wt = path.join(root, 'wt-hermes');
  mkdirSync(path.join(wt, '.ai-team'), { recursive: true });
  writeFileSync(path.join(wt, '.ai-team', 'STATUS.md'), '## 2026-10-01 10:00 — HERMES\n- status: DONE\n');
  const models = path.join(root, 'models');
  mkdirSync(path.join(models, 'active-model-hermes.txt'), { recursive: true }); // modelo também ilegível
  const p: ProjectCfg = { id: 'x', name: 'x', vault, activeGoalFile: '00-System/ACTIVE_GOAL.md', goalsDir: 'Goals', modelsDir: models, agents: [{ id: 'HERMES', worktree: wt } as never] };
  const store = new Store(path.join(root, 'db.sqlite'));
  const list = agents(store, p);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'HERMES');
  assert.equal(list[0].model, null);
});
