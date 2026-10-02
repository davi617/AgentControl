// Modelo e força de cada agente: só da lista, grava só na pasta dos agentes.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CLAUDE_SUB_OPTIONS, NVIDIA_OPTIONS, modelChoices, setModel, useCodexCache } from '../src/models.ts';

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'jarvis-models-'));
  const cache = path.join(dir, 'models_cache.json');
  writeFileSync(cache, JSON.stringify({ models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }, { effort: 'ultra' }] },
    { slug: 'gpt-reserve', visibility: 'hide', supported_reasoning_levels: [] },
  ] }));
  useCodexCache(cache);
  const runs: string[][] = [];
  const run = async (_f: string, args: string[]) => { runs.push(args); };
  return { dir, runs, run };
}
const read = (dir: string, f: string) => readFileSync(path.join(dir, f), 'utf8');

test('modelos: todo agente tem lista e força; Claude tem os modelos do Claude e os da NVIDIA', () => {
  const { dir } = setup();
  const all = modelChoices(dir);
  assert.deepEqual(all.map((a) => a.id), ['CLAUDE', 'CODEX', 'HERMES', 'OPENCODE', 'OPENCLAW', 'QWEN']);
  const claude = all[0];
  assert.ok(claude.options.some((o) => o.id === CLAUDE_SUB_OPTIONS[0].id) && claude.options.some((o) => o.id === NVIDIA_OPTIONS[0].id));
  assert.equal(claude.effort, 'max', 'padrão do Claude: força máxima');
  assert.deepEqual(all[1].options.map((o) => o.id), ['gpt-6-sol'], 'Codex: escondido fica fora');
});

test('modelos: Claude na assinatura grava a rota e a força; ring manager aplica; fora da lista é recusado', async () => {
  const { dir, runs, run } = setup();
  const r = await setModel(dir, 'claude', 'claude-opus-5-5', 'max', run);
  assert.equal(r.current, 'claude-opus-5-5');
  assert.equal(read(dir, 'claude-route.txt'), 'claude-opus-5-5');
  assert.equal(read(dir, 'effort-claude.txt'), 'max');
  assert.deepEqual(runs, [['ensure', 'claude']]);
  await setModel(dir, 'CLAUDE', NVIDIA_OPTIONS[1].id, undefined, run);
  assert.equal(read(dir, 'claude-route.txt'), 'nvidia', 'modelo NVIDIA volta a rota para o 9Router');
  assert.equal(read(dir, 'effort-claude.txt'), 'max', 'sem força nova, mantém a atual');
  await assert.rejects(setModel(dir, 'CLAUDE', 'openai/gpt-pago', undefined, run), /fora da lista/);
  await assert.rejects(setModel(dir, 'HERMES', NVIDIA_OPTIONS[0].id, 'turbo', run), /não aceita a força/);
  await assert.rejects(setModel(dir, 'DROID', NVIDIA_OPTIONS[0].id, undefined, run), /não dá para escolher/);
});

test('modelos: Hermes leve; Codex valida a força pelo modelo e não chama o ring manager', async () => {
  const { dir, runs, run } = setup();
  const h = await setModel(dir, 'HERMES', NVIDIA_OPTIONS[2].id, 'low', run);
  assert.equal(h.effort, 'low');
  assert.equal(JSON.parse(read(dir, 'model-choice.json')).hermes.model, NVIDIA_OPTIONS[2].id);
  const c = await setModel(dir, 'CODEX', 'gpt-6-sol', 'ultra', run);
  assert.equal(c.effort, 'ultra');
  assert.equal(read(dir, 'codex-effort.txt'), 'ultra');
  assert.equal(existsSync(path.join(dir, 'effort-codex.txt')), false);
  await assert.rejects(setModel(dir, 'CODEX', 'gpt-reserve', 'high', run), /fora da lista/);
  assert.deepEqual(runs, [['ensure', 'hermes']]);
});
