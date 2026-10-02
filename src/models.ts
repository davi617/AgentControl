// Modelo e força (raciocínio) de cada agente, escolhidos pelo dono no JARVIS/app (2026-09-26).
// Só opções da lista. Grava só na pasta dos agentes (dw-agents): o Claude e o Codex pessoais do dono não mudam.
//   model-choice.json { agente: { model, effort } } → provider-ring-manager.js aplica na config de cada CLI
//   effort-<agente>.txt → o launcher passa na linha de comando (--effort, --reasoning, --thinking)
//   claude-route.txt  → "nvidia" (9Router) ou o modelo Claude da assinatura do dono
//   codex-model.txt / codex-effort.txt → launcher do Codex (-m, -c model_reasoning_effort)

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ModelOption { id: string; label: string; note?: string; efforts?: string[] }
export interface AgentModels { id: string; route: string; current: string | null; effort?: string | null; efforts: string[]; options: ModelOption[]; note?: string }

/** Respondendo na NVIDIA pelo 9Router (teste de 1 pedido em 2026-09-26). DeepSeek/MiniMax/Qwen 3.5 deram 410 (desligados). */
export const NVIDIA_OPTIONS: ModelOption[] = [
  { id: 'nvidia/moonshotai/kimi-k3', label: 'Kimi K3', note: 'o melhor em ferramentas e código; padrão do time' },
  { id: 'nvidia/z-ai/glm-5.3', label: 'GLM 5.3', note: 'forte em código' },
  { id: 'nvidia/z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', note: 'versão leve do GLM' },
  { id: 'nvidia/nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', note: 'grande, mais lento' },
  { id: 'nvidia/nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning', note: 'leve e rápido' },
];
/** Assinatura do Claude do dono (sem 9Router). O você precisa fazer login uma vez no home isolado do agente. */
export const CLAUDE_SUB_OPTIONS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'o mais forte; gasta mais da sua assinatura' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'equilíbrio entre força e cota' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'rápido' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'o mais leve e barato' },
];

interface AgentDef { route: string; options: () => ModelOption[]; efforts: string[]; defModel: string; defEffort: string; note?: string }
const KIMI = NVIDIA_OPTIONS[0].id;
export const AGENTS: Record<string, AgentDef> = {
  CLAUDE: {
    route: 'assinatura do Claude ou NVIDIA', options: () => [...CLAUDE_SUB_OPTIONS, ...NVIDIA_OPTIONS],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defModel: KIMI, defEffort: 'max',
    note: 'Modelos "Claude …" usam a SUA assinatura (mesma cota do seu Claude) e precisam de login uma vez no agente (runbook "Modelos dos agentes"). A força só vale nos modelos Claude.',
  },
  CODEX: { route: 'sua conta OpenAI', options: () => codexOptions(), efforts: [], defModel: 'gpt-6-sol', defEffort: 'medium' },
  HERMES: { route: 'NVIDIA pelo 9Router', options: () => NVIDIA_OPTIONS, efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defModel: KIMI, defEffort: 'ultra' },
  OPENCODE: { route: 'NVIDIA pelo 9Router', options: () => NVIDIA_OPTIONS, efforts: ['low', 'medium', 'high', 'max'], defModel: KIMI, defEffort: 'max' },
  OPENCLAW: { route: 'NVIDIA pelo 9Router', options: () => NVIDIA_OPTIONS, efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defModel: KIMI, defEffort: 'medium' },
  QWEN: { route: 'NVIDIA pelo 9Router', options: () => NVIDIA_OPTIONS, efforts: ['low', 'medium', 'high', 'max'], defModel: KIMI, defEffort: 'max' },
};

let codexCache = path.join(os.homedir(), '.codex', 'models_cache.json');
/** Só para teste: aponta o cache do Codex para um arquivo falso. */
export function useCodexCache(file: string) { codexCache = file; }

/** Modelos visíveis da conta OpenAI, do cache que o próprio Codex mantém (sem rede, sem segredo). */
export function codexOptions(): ModelOption[] {
  try {
    const j = JSON.parse(readFileSync(codexCache, 'utf8')) as { models?: { slug: string; display_name?: string; visibility?: string; supported_reasoning_levels?: ({ effort: string } | string)[] }[] };
    return (j.models ?? []).filter((m) => m.visibility !== 'hide' && m.slug).map((m) => ({
      id: m.slug, label: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels ?? []).map((e) => (typeof e === 'string' ? e : e.effort)),
    }));
  } catch { return []; }
}

type Choice = Record<string, { model?: string; effort?: string } | string>;
const choiceFile = (dir: string) => path.join(dir, 'model-choice.json');
function readChoice(dir: string): Choice { try { return JSON.parse(readFileSync(choiceFile(dir), 'utf8')); } catch { return {}; } }
const readTxt = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').replace(/^﻿/, '').trim() || null : null);

function current(dir: string, id: string): { model: string | null; effort: string | null } {
  const def = AGENTS[id];
  if (id === 'CODEX') return { model: readTxt(path.join(dir, 'codex-model.txt')) ?? def.defModel, effort: readTxt(path.join(dir, 'codex-effort.txt')) ?? def.defEffort };
  const c = readChoice(dir)[id.toLowerCase()];
  const model = (typeof c === 'string' ? c : c?.model) ?? readTxt(path.join(dir, `active-model-${id.toLowerCase()}.txt`)) ?? def.defModel;
  return { model, effort: readTxt(path.join(dir, `effort-${id.toLowerCase()}.txt`)) ?? def.defEffort };
}

export function modelChoices(dir: string): AgentModels[] {
  return Object.entries(AGENTS).map(([id, def]) => {
    const cur = current(dir, id);
    const options = def.options();
    // Codex: a força depende do modelo; os outros têm uma lista fixa.
    const efforts = id === 'CODEX' ? options.find((o) => o.id === cur.model)?.efforts ?? [] : def.efforts;
    return { id, route: def.route, current: cur.model, effort: cur.effort, efforts, options, note: def.note };
  });
}

type Run = (file: string, args: string[]) => Promise<void>;
const runNode: Run = (file, args) => new Promise((res, rej) =>
  execFile(process.execPath, [file, ...args], { timeout: 60_000, windowsHide: true }, (e) => (e ? rej(e) : res())));

/** Troca modelo e/ou força de um agente. Vale a partir da próxima rodada dele. */
export async function setModel(dir: string, agent: string, model: string, effort?: string, run: Run = runNode): Promise<AgentModels> {
  const id = agent.toUpperCase();
  const def = AGENTS[id];
  if (!def) throw new Error(`não dá para escolher o modelo do ${id}`);
  const opt = def.options().find((o) => o.id === model);
  if (!opt) throw new Error(`modelo fora da lista do ${id}`);
  const efforts = id === 'CODEX' ? opt.efforts ?? [] : def.efforts;
  const eff = effort || current(dir, id).effort || def.defEffort;
  if (!efforts.includes(eff)) throw new Error(`${opt.label} não aceita a força "${eff}"`);
  if (id === 'CODEX') {
    writeFileSync(path.join(dir, 'codex-model.txt'), model);
    writeFileSync(path.join(dir, 'codex-effort.txt'), eff);
  } else {
    const a = id.toLowerCase();
    writeFileSync(choiceFile(dir), JSON.stringify({ ...readChoice(dir), [a]: { model, effort: eff }, updatedAt: new Date().toISOString() }, null, 2));
    writeFileSync(path.join(dir, `effort-${a}.txt`), eff);
    if (id === 'CLAUDE') writeFileSync(path.join(dir, 'claude-route.txt'), model.startsWith('claude-') ? model : 'nvidia');
    await run(path.join(dir, 'provider-ring-manager.js'), ['ensure', a]);
  }
  return modelChoices(dir).find((m) => m.id === id)!;
}
