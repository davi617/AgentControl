// Ponta a ponta em diretório temporário: nunca toca vault/worktrees reais.
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Config } from '../src/config.ts';
import { Jarvis } from '../src/jarvis.ts';
import { createServer } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { llmSummary } from '../src/summarizer.ts';

const root = mkdtempSync(path.join(tmpdir(), 'jarvis-e2e-'));
const vault = path.join(root, 'vault');
const goal = path.join(vault, '20-Operations', 'Goals', 'GOAL-TEST');
const wt = path.join(root, 'agent-codex');
const orch = path.join(root, 'orch');
const models = path.join(root, 'models');
const statusFile = path.join(wt, '.ai-team', 'STATUS.md');

let j: Jarvis;
let server: ReturnType<typeof createServer>;
let base = '';

function cfg(port: number): Config {
  return {
    host: '127.0.0.1', port, db: ':memory:',
    summary: {
      enabled: true, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(models, 'key'),
      models: ['nvidia/z-ai/glm-5.3', 'gemini/gemini-3.8-flash', 'openai/gpt-5.5'],
      allowedPrefixes: ['nvidia/', 'gemini/'], minIntervalMinutes: 999, maxInputChars: 4000,
    },
    projects: [{
      id: 'test', name: 'Teste', vault, activeGoalFile: '00-System/ACTIVE_GOAL.md', goalsDir: '20-Operations/Goals', chatDir: 'CHAT',
      orchestratorDir: orch, modelsDir: models,
      agents: [{ id: 'CODEX', worktree: wt }, { id: 'CHATGPT' }],
    }],
  };
}

before(async () => {
  mkdirSync(path.join(vault, '00-System'), { recursive: true });
  mkdirSync(path.join(goal, 'AGENTS'), { recursive: true });
  mkdirSync(path.dirname(statusFile), { recursive: true });
  mkdirSync(orch, { recursive: true });
  mkdirSync(models, { recursive: true });
  writeFileSync(path.join(vault, '00-System', 'ACTIVE_GOAL.md'), '- status: `ACTIVE`\n- goal: `GOAL-TEST`\n');
  writeFileSync(path.join(goal, 'TASKS.md'), '﻿| ID | Owner | Status | Task | Gate |\n|---|---|---|---|---|\n| T-1 | CODEX | WORKING | RevisÃ£o | x |\n');
  writeFileSync(path.join(goal, 'EVENTS.md'), '# EVENTS\n\n## 2026-09-21 — GOAL ACTIVATED\n- ok\n');
  writeFileSync(statusFile, '# STATUS\n\n## 2026-09-22 10:00 - CODEX\n- task: T-1\n- status: ACK\n');
  writeFileSync(path.join(goal, 'AGENTS', 'CODEX-STATUS.md'), '# STATUS\n\nvelho\n');
  writeFileSync(path.join(models, 'active-model-codex.txt'), 'cx/gpt-5.6-sol\n');
  writeFileSync(path.join(orch, '.supreme-nvidia.lock'), '999999\n');

  // porta livre: sobe uma vez em 0 para descobrir, depois cria com a porta certa (host check depende dela)
  const probe = createServer(new Jarvis(cfg(1), new Store(':memory:')));
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  j = new Jarvis(cfg(port));
  await j.start();
  server = createServer(j);
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server?.closeAllConnections();
  server?.close();
  await j?.stop();
  rmSync(root, { recursive: true, force: true });
});

test('varredura inicial importa STATUS e EVENTS como histórico', async () => {
  const feed = await (await fetch(`${base}/api/feed?project=test`)).json();
  assert.ok(feed.some((e: { agent: string; status: string }) => e.agent === 'CODEX' && e.status === 'ACK'));
  assert.ok(feed.some((e: { kind: string }) => e.kind === 'events'));
  assert.ok(feed.every((e: { initial: number }) => e.initial === 1));
});

test('estado: goal, tarefas com mojibake reparado, cópia do vault atrasada, lock órfão', async () => {
  const s = await (await fetch(`${base}/api/state?project=test`)).json();
  assert.equal(s.goal, 'GOAL-TEST');
  assert.equal(s.tasks[0].task, 'Revisão');
  const codex = s.agents.find((a: { id: string }) => a.id === 'CODEX');
  assert.equal(codex.vaultCopyStale, true);
  assert.equal(codex.model, 'cx/gpt-5.6-sol');
  assert.deepEqual(s.locks, [{ name: 'nvidia', pid: 999999, alive: false }]);
});

test('CRITÉRIO FASE 1: editar STATUS aparece no SSE em < 2 s', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events?project=test`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  await reader.read(); // "retry:" inicial

  const t0 = performance.now();
  appendFileSync(statusFile, '\n## 2026-09-24 03:00 — CODEX\n- task: T-1\n- status: WORKING\n- evidence: token=abcdef123456\n');

  let buf = '';
  let got: { entries: Array<{ status: string; body: string; initial: number }> } | undefined;
  const deadline = t0 + 5000;
  while (!got && performance.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - performance.now())),
    ]);
    if (done && !value) break;
    buf += dec.decode(value, { stream: true });
    const m = /event: entries\ndata: (.+)\n\n/.exec(buf);
    if (m) got = JSON.parse(m[1]);
  }
  const ms = performance.now() - t0;
  ctrl.abort();
  assert.ok(got, 'evento entries não chegou');
  console.log(`# latência STATUS→SSE: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 2000, `latência ${ms.toFixed(0)} ms`);
  assert.equal(got!.entries.length, 1, 'só a seção nova, não o arquivo inteiro');
  assert.equal(got!.entries[0].status, 'WORKING');
  assert.equal(got!.entries[0].initial, 0);
  assert.ok(!got!.entries[0].body.includes('abcdef123456'), 'segredo vazou no SSE');
});

test('segurança HTTP: Host estranho = 403, POST = 405, headers CSP', async () => {
  const http = await import('node:http');
  const status = (opts: object) => new Promise<number>((r) => {
    const u = new URL(base);
    http.request({ host: u.hostname, port: u.port, path: '/api/projects', ...opts }, (res) => { res.resume(); r(res.statusCode!); }).end();
  });
  assert.equal(await status({ headers: { Host: 'evil.example:80' } }), 403);
  assert.equal(await status({ headers: { Origin: 'http://evil.example' } }), 403);
  assert.equal(await status({ method: 'POST' }), 405);
  assert.equal(await status({ method: 'DELETE', path: '/api/commands' }), 405);
  const r = await fetch(`${base}/`);
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
});

test('resumo determinístico cita agentes, tarefas e lock órfão', async () => {
  const s = await (await fetch(`${base}/api/summary?project=test`)).json();
  assert.match(s.deterministic, /CODEX: WORKING · T-1/);
  assert.match(s.deterministic, /Tarefas \(1\)/);
  assert.match(s.deterministic, /lock nvidia órfão/);
});

test('resumo IA: pula NVIDIA com slot ocupado, nunca usa modelo fora da lista, aceita SSE', async () => {
  writeFileSync(path.join(models, 'key'), 'chave-de-teste-123456');
  const called: string[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model;
    called.push(model);
    const sse = 'data: {"choices":[{"delta":{"content":"Pedido: x. "}}]}\n\ndata: {"choices":[{"delta":{"content":"password=vazou123"}}]}\n\ndata: [DONE]\n';
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
  const r = await llmSummary(cfg(1).summary, 'dados', true, fake);
  assert.deepEqual(called, ['gemini/gemini-3.8-flash']);
  assert.equal(r.status, 'OK');
  assert.equal(r.model, 'gemini/gemini-3.8-flash');
  assert.ok(!r.text.includes('vazou123'));
});

test('resumo IA: 9Router desligado = NOT_RUN (nunca PASS inventado)', async () => {
  const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  const r = await llmSummary(cfg(1).summary, 'dados', false, down);
  assert.equal(r.status, 'NOT_RUN');
});

test('resumo IA: erro HTTP em todos = FAILED com motivo', async () => {
  const gone = (async () => new Response('{"error":"gone"}', { status: 410 })) as typeof fetch;
  const r = await llmSummary(cfg(1).summary, 'dados', false, gone);
  assert.equal(r.status, 'FAILED');
  assert.match(r.text, /HTTP 410/);
});

// ---------- Fase 2: comandos ----------
async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
const csrfOf = async () => (await (await fetch(`${base}/api/session`)).json()).csrf as string;

test('comando: sem CSRF ou sem Origin é recusado', async () => {
  const csrf = await csrfOf();
  assert.equal((await post({ project: 'test', text: 'oi' }, { Origin: base })).status, 403);
  assert.equal((await post({ project: 'test', text: 'oi' }, { 'X-JARVIS-CSRF': csrf })).status, 403);
  assert.equal((await post({ project: 'test', text: 'oi' }, { Origin: 'http://evil.example', 'X-JARVIS-CSRF': csrf })).status, 403);
});

test('comando: registra na hora, escreve JARVIS-INBOX.md, espelha na worktree e aparece na sala', async () => {
  const csrf = await csrfOf();
  const h = { Origin: base, 'X-JARVIS-CSRF': csrf };
  assert.equal((await post({ project: 'test', text: '', to: 'LEADER' }, h)).status, 400);
  assert.equal((await post({ project: 'test', text: 'x', to: 'NINGUEM' }, h)).status, 400);

  const t0 = performance.now();
  const r = await post({ project: 'test', text: 'Codex, rode os testes da T-1. senha=abc12345', to: 'LEADER' }, h);
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.ok(performance.now() - t0 < 1000, 'resposta imediata');
  assert.equal(data.command.code, 'J-001');
  assert.equal(data.command.status, 'NEW');
  assert.match(data.reply, /J-001 registrado/);

  const inbox = readFileSync(path.join(goal, 'JARVIS-INBOX.md'), 'utf8');
  assert.match(inbox, /- jarvis: J-001\n- to: LEADER\n- status: NEW/);
  assert.ok(!inbox.includes('abc12345'), 'segredo gravado no inbox');
  assert.equal(readFileSync(path.join(wt, '.ai-team', 'JARVIS-INBOX.md'), 'utf8'), inbox);

  // o watcher traz a entrada do inbox para a sala
  let feed: Array<{ kind: string; agent: string }> = [];
  for (let i = 0; i < 40 && !feed.some((e) => e.kind === 'command'); i++) {
    await new Promise((res) => setTimeout(res, 100));
    feed = await (await fetch(`${base}/api/feed?project=test`)).json();
  }
  assert.ok(feed.some((e) => e.kind === 'command' && e.agent === 'DONO'), 'comando não apareceu na sala');
});

test('comando com deploy fica AWAITING_APPROVAL', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf() };
  const data = await (await post({ project: 'test', text: 'faça deploy da API', to: 'CODEX' }, h)).json();
  assert.equal(data.command.code, 'J-002');
  assert.equal(data.command.requires_approval, 1);
  assert.equal(data.command.status, 'AWAITING_APPROVAL');
  assert.match(data.reply, /PARADO até você aprovar/);
});

test('acompanhamento: ACK do agente citando J-001 atualiza o comando; J-002 executado sem aprovação vira VIOLATION', async () => {
  appendFileSync(statusFile, '\n## 2026-09-24 04:00 — CODEX\n- task: T-1\n- jarvis: J-001\n- status: ACK\n');
  await new Promise((res) => setTimeout(res, 50));
  appendFileSync(statusFile, '\n## 2026-09-24 04:01 — CODEX\n- jarvis: J-002\n- status: WORKING\n');
  let cmds: Array<{ code: string; status: string; updated_by: string }> = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 100));
    cmds = await (await fetch(`${base}/api/commands?project=test`)).json();
    if (cmds.find((c) => c.code === 'J-002')?.status === 'VIOLATION' && cmds.find((c) => c.code === 'J-001')?.status === 'ACK') break;
  }
  const j1 = cmds.find((c) => c.code === 'J-001')!;
  assert.equal(j1.status, 'ACK');
  assert.equal(j1.updated_by, 'CODEX');
  assert.equal(cmds.find((c) => c.code === 'J-002')!.status, 'VIOLATION');
});

// ---------- Sala central (chat) ----------
async function waitChat(pred: (msgs: Array<{ agent: string; body: string }>) => boolean) {
  let msgs: Array<{ agent: string; body: string }> = [];
  for (let i = 0; i < 50; i++) {
    msgs = await (await fetch(`${base}/api/chat?project=test`)).json();
    if (pred(msgs)) return msgs;
    await new Promise((r) => setTimeout(r, 100));
  }
  return msgs;
}

test('chat: você fala pela tela → CHAT/DONO.md → volta na sala e no SALA.md espelhado', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf(), 'Content-Type': 'application/json' };
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: h, body: JSON.stringify({ project: 'test', text: 'Bom dia time. token=segredo12345', to: 'TODOS', assunto: 'teste' }) });
  assert.equal(r.status, 201);
  const dono = readFileSync(path.join(vault, 'CHAT', 'DONO.md'), 'utf8');
  assert.match(dono, /— DONO\n- para: TODOS\n- assunto: teste/);
  assert.ok(!dono.includes('segredo12345'));
  const msgs = await waitChat((m) => m.some((x) => x.agent === 'DONO'));
  assert.ok(msgs.some((x) => x.agent === 'DONO' && /Bom dia time/.test(x.body)));
  const sala = readFileSync(path.join(vault, 'CHAT', 'SALA.md'), 'utf8');
  assert.match(sala, /Não edite este arquivo/);
  assert.match(sala, /— DONO\n/);
  assert.equal(readFileSync(path.join(wt, '.ai-team', 'SALA.md'), 'utf8'), sala);
});

test('chat: agente em worktree responde no próprio .ai-team/CHAT.md', async () => {
  writeFileSync(path.join(wt, '.ai-team', 'CHAT.md'), '# CHAT\n\n## 2026-09-24 05:00 — CODEX\n- para: DONO\n\nBom dia! Rodando T-1.\n');
  const msgs = await waitChat((m) => m.some((x) => x.agent === 'CODEX'));
  assert.ok(msgs.some((x) => x.agent === 'CODEX' && /Rodando T-1/.test(x.body)));
});

test('chat: agente fora do launcher entra só criando CHAT/<NOME>.md', async () => {
  writeFileSync(path.join(vault, 'CHAT', 'GEMINI.md'), '## 2026-09-24 05:01 — GEMINI\n- para: TODOS\n\nOi, também estou aqui.\n');
  const msgs = await waitChat((m) => m.some((x) => x.agent === 'GEMINI'));
  assert.ok(msgs.some((x) => x.agent === 'GEMINI'));
  assert.ok(!msgs.some((x) => x.agent === 'SALA'), 'SALA.md não pode virar agente');
});

test('chat: resposta colada do app do ChatGPT vai para CHAT/CHATGPT.md marcada', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf(), 'Content-Type': 'application/json' };
  const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: h, body: JSON.stringify({ project: 'test', as: 'CHATGPT', text: 'Concordo com o plano.', to: 'CLAUDE' }) });
  assert.equal(r.status, 201);
  assert.match(readFileSync(path.join(vault, 'CHAT', 'CHATGPT.md'), 'utf8'), /- para: CLAUDE\n- via: app do ChatGPT, colado por você no Agent Control/);
  const bad = await fetch(`${base}/api/chat`, { method: 'POST', headers: h, body: JSON.stringify({ project: 'test', text: 'x', to: '../../etc' }) });
  assert.equal(bad.status, 400);
});

// ---------- Fase 3: aprovações ----------
test('aprovação: ACK antes de aprovar não libera WORKING (continua VIOLATION)', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf() };
  const c = (await (await post({ project: 'test', text: 'faça merge na main', to: 'LEADER' }, h)).json()).command;
  assert.equal(c.approval, 'pending');
  appendFileSync(statusFile, `\n## 2026-09-24 06:00 — CODEX\n- jarvis: ${c.code}\n- status: ACK\n`);
  await new Promise((r) => setTimeout(r, 60));
  appendFileSync(statusFile, `\n## 2026-09-24 06:01 — CODEX\n- jarvis: ${c.code}\n- status: WORKING\n`);
  let st = '';
  for (let i = 0; i < 40 && st !== 'VIOLATION'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    st = (await (await fetch(`${base}/api/commands?project=test`)).json()).find((x: { code: string }) => x.code === c.code).status;
  }
  assert.equal(st, 'VIOLATION');
});

test('aprovação: aprovar libera só aquele comando e grava approved no inbox', async () => {
  const csrf = await csrfOf();
  const h = { Origin: base, 'X-JARVIS-CSRF': csrf };
  const c = (await (await post({ project: 'test', text: 'dá push na branch', to: 'CODEX' }, h)).json()).command;
  const decide = (body: unknown, hh: Record<string, string> = { ...h, 'Content-Type': 'application/json' }) =>
    fetch(`${base}/api/commands/decide`, { method: 'POST', headers: hh, body: JSON.stringify(body) });
  assert.equal((await decide({ project: 'test', code: c.code, decision: 'approve' }, { 'Content-Type': 'application/json', Origin: base })).status, 403, 'sem CSRF');
  const r = await decide({ project: 'test', code: c.code, decision: 'approve' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.command.approval, 'approved');
  assert.equal(d.command.status, 'APPROVED');
  assert.match(readFileSync(path.join(goal, 'JARVIS-INBOX.md'), 'utf8'), new RegExp(`- approved: ${c.code}\n- status: APPROVED`));
  assert.equal((await decide({ project: 'test', code: c.code, decision: 'reject' })).status, 409, 'decisão dupla');
  assert.equal((await decide({ project: 'test', code: 'J-001', decision: 'approve' })).status, 409, 'comando comum não se aprova');

  appendFileSync(statusFile, `\n## 2026-09-24 06:10 — CODEX\n- jarvis: ${c.code}\n- status: WORKING\n`);
  let st = '';
  for (let i = 0; i < 40 && st !== 'WORKING'; i++) {
    await new Promise((res) => setTimeout(res, 100));
    st = (await (await fetch(`${base}/api/commands?project=test`)).json()).find((x: { code: string }) => x.code === c.code).status;
  }
  assert.equal(st, 'WORKING', 'aprovado pode andar');
});

// ---------- Fase 4: modo remoto (app do celular) ----------
test('remoto: só Tailscale na config, token obrigatório, app escreve sem CSRF', async () => {
  const { isTailscaleIp } = await import('../src/config.ts');
  assert.ok(isTailscaleIp('100.101.102.103'));
  for (const bad of ['0.0.0.0', '192.168.0.10', '100.63.0.1', '100.128.0.1', '8.8.8.8', '127.0.0.1']) assert.ok(!isTailscaleIp(bad), bad);

  // Servidor remoto de teste preso ao loopback (a validação de IP fica na config, testada acima).
  const token = 'token-de-teste-remoto-0123456789';
  const probe = createServer(j, { host: '127.0.0.1', token });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const rport = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  // Porta remota diferente da local: o Host aceito tem que ser o da porta remota.
  assert.notEqual(rport, j.cfg.port);
  const rs = createServer(j, { host: '127.0.0.1', token, port: rport });
  await new Promise<void>((r) => rs.listen(rport, '127.0.0.1', r));
  const rb = `http://127.0.0.1:${rport}`;
  try {
    assert.equal((await fetch(`${rb}/api/projects`)).status, 401, 'sem token');
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Authorization: 'Bearer errado' } })).status, 401, 'token errado');
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${rb}/api/projects`, { headers: auth })).status, 200);
    const r = await fetch(`${rb}/api/chat`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'test', text: 'oi do celular' }) });
    assert.equal(r.status, 201, 'app com token escreve sem CSRF');
    const bad = await fetch(`${rb}/api/chat`, { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(bad.status, 403, 'só JSON');
  } finally {
    rs.closeAllConnections();
    await new Promise<void>((r) => rs.close(() => r()));
  }
});

// ---------- Modo Time: várias pessoas com acesso próprio ----------
test('time: dono convida, pessoa entra com token próprio, fala com o nome dela, papel limita o que pode', async () => {
  const token = 'token-dono-remoto-0123456789abcdef';
  const probe = createServer(j, { host: '127.0.0.1', token });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const rport = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const rs = createServer(j, { host: '127.0.0.1', token, port: rport });
  await new Promise<void>((r) => rs.listen(rport, '127.0.0.1', r));
  const rb = `http://127.0.0.1:${rport}`;
  const post = (auth: string, p: string, body: unknown) => fetch(`${rb}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // dono convida uma membro e uma pessoa só leitura
    const inv = await (await post(token, '/api/team/invite', { name: 'Ana Júlia', role: 'membro' })).json();
    assert.equal(inv.person.id, 'ANA_JULIA');
    assert.equal(inv.person.tokenHash, undefined, 'hash não sai na resposta');
    assert.match(inv.token, /^[0-9a-f]{48}$/);
    const ro = await (await post(token, '/api/team/invite', { name: 'Beto', role: 'leitura' })).json();

    // a membro entra com o token dela, se vê e vê o time
    const me = await (await fetch(`${rb}/api/team`, { headers: { Authorization: `Bearer ${inv.token}` } })).json();
    assert.equal(me.me.id, 'ANA_JULIA');
    assert.equal(me.me.role, 'membro');
    assert.ok(me.people.find((x: { id: string; online: boolean }) => x.id === 'ANA_JULIA').online, 'presença: online');

    // fala na sala com o nome dela (arquivo próprio) e @menção é reconhecida
    const said = await post(inv.token, '/api/chat', { project: 'test', text: 'oi @CODEX, eu revisei o login' });
    assert.equal(said.status, 201);
    assert.deepEqual((await said.json()).mentions, ['CODEX']);
    assert.match(readFileSync(path.join(vault, 'CHAT', 'ANA_JULIA.md'), 'utf8'), /— ANA_JULIA[\s\S]*eu revisei o login/);

    // ordem leva o nome; aprovar e convidar só o dono
    const cmd = await (await post(inv.token, '/api/commands', { project: 'test', text: 'rode os testes', to: 'CODEX' })).json();
    assert.match(cmd.command.text, /^\[Ana Júlia\] rode os testes/);
    assert.equal((await post(inv.token, '/api/commands/decide', { project: 'test', code: cmd.command.code, decision: 'approve' })).status, 403);
    assert.equal((await post(inv.token, '/api/team/invite', { name: 'Intruso', role: 'dono' })).status, 403);

    // atalho rodado pela membro também leva o nome dela (antes saía como se fosse do dono)
    const sc = await (await post(inv.token, '/api/shortcuts', { project: 'test', label: 'testes', text: 'rode a suíte', target: 'CODEX' })).json();
    const viaAtalho = await (await post(inv.token, '/api/shortcuts/run', { project: 'test', id: sc.id })).json();
    assert.match(viaAtalho.command.text, /^\[Ana Júlia\] rode a suíte/);
    const doDono = await (await post(token, '/api/shortcuts/run', { project: 'test', id: sc.id })).json();
    assert.equal(doDono.command.text, 'rode a suíte', 'do dono sai sem prefixo');

    // só leitura não escreve nada
    assert.equal((await post(ro.token, '/api/chat', { project: 'test', text: 'oi' })).status, 403);
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Authorization: `Bearer ${ro.token}` } })).status, 200, 'mas lê');

    // dono remove: o token para de valer E o /events que a pessoa já tinha aberto é fechado
    const ctrl = new AbortController();
    const live = await fetch(`${rb}/events?project=test`, { headers: { Authorization: `Bearer ${ro.token}` }, signal: ctrl.signal });
    assert.equal(live.status, 200);
    const reader = live.body!.getReader();
    await reader.read(); // "retry: 2000"
    assert.equal((await post(token, '/api/team/remove', { id: 'BETO' })).status, 200);
    const fim = await Promise.race([
      (async () => { for (;;) { const r = await reader.read(); if (r.done) return 'fechou'; } })(),
      new Promise((r) => setTimeout(() => r('continua aberto'), 2000)),
    ]);
    ctrl.abort();
    assert.equal(fim, 'fechou');
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Authorization: `Bearer ${ro.token}` } })).status, 401);

    // freemium: o Grátis cabe 3 pessoas contando o dono (dono + Ana + Carla); a 4ª é recusada com 402
    assert.equal((await post(token, '/api/team/invite', { name: 'Carla', role: 'membro' })).status, 201);
    const full = await post(token, '/api/team/invite', { name: 'Edu', role: 'membro' });
    assert.equal(full.status, 402);
    assert.match((await full.json()).error, /Grátis permite 3 pessoas/);
    const plano = await (await fetch(`${rb}/api/plan`, { headers: { Authorization: `Bearer ${inv.token}` } })).json();
    assert.equal(plano.plano, 'gratis');
    assert.equal((await post(inv.token, '/api/plan/license', { license: 'AC1.a.b' })).status, 403, 'licença só o dono instala');
    assert.equal((await post(token, '/api/plan/license', { license: 'AC1.a.b' })).status, 400, 'licença inválida é recusada');
  } finally {
    rs.closeAllConnections();
    await new Promise<void>((r) => rs.close(() => r()));
  }
});

test('navegador (iPhone/PWA): entrar guarda o token em cookie HttpOnly; escrita por cookie exige CSRF', async () => {
  const token = 'token-dono-web-0123456789abcdef';
  const probe = createServer(j, { host: '127.0.0.1', token });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const rport = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const rs = createServer(j, { host: '127.0.0.1', token, port: rport });
  await new Promise<void>((r) => rs.listen(rport, '127.0.0.1', r));
  const rb = `http://127.0.0.1:${rport}`;
  try {
    const home = await fetch(`${rb}/`, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    assert.equal(home.status, 302, 'sem login vai para /entrar');
    assert.equal(home.headers.get('location'), '/entrar');
    assert.equal((await fetch(`${rb}/entrar`)).status, 200);
    assert.equal((await fetch(`${rb}/manifest.webmanifest`)).status, 200);
    assert.equal((await fetch(`${rb}/api/projects`)).status, 401, 'API continua fechada');

    const bad = await fetch(`${rb}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'errado' }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${rb}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: cookie } })).status, 200, 'cookie vale para ler');
    const chat = (h: Record<string, string>) => fetch(`${rb}/api/chat`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ project: 'test', text: 'oi do iPhone' }) });
    assert.equal((await chat({})).status, 403, 'escrita só com cookie (sem CSRF) é recusada');
    const { csrf } = await (await fetch(`${rb}/api/session`, { headers: { Cookie: cookie } })).json();
    assert.equal((await chat({ Origin: rb, 'X-Jarvis-Csrf': csrf })).status, 201, 'com CSRF e Origin a escrita passa');

    // sessão: o cookie NÃO é o token; o token cru em cookie (formato antigo) não entra mais
    assert.match(cookie, /^ac_session=/);
    assert.ok(!cookie.includes(token), 'token não vai para o cookie');
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: `ac_token=${token}` } })).status, 401, 'cookie antigo com token cru não vale');

    // aparelhos conectados: aparece com nome do aparelho; desconectar pelo dono derruba aquele cookie
    const ua = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' };
    const login2 = await fetch(`${rb}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ua }, body: JSON.stringify({ token }) });
    const cookie2 = (login2.headers.get('set-cookie') ?? '').split(';')[0];
    const list = await (await fetch(`${rb}/api/sessions`, { headers: { Cookie: cookie2 } })).json();
    const iphone = list.find((x: { atual: boolean }) => x.atual);
    assert.equal(iphone.device, 'iPhone · Safari');
    assert.equal(iphone.nome, 'Você');
    assert.equal(iphone.hash, undefined, 'hash não sai');
    const revoke = await fetch(`${rb}/api/sessions/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: iphone.id }) });
    assert.equal(revoke.status, 200);
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: cookie2 } })).status, 401, 'desconectado');
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: cookie } })).status, 200, 'o outro aparelho segue');

    // sair encerra a sessão no servidor: o mesmo cookie, copiado, para de valer
    assert.equal((await fetch(`${rb}/api/logout`, { method: 'POST', headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: cookie } })).status, 401);

    // convidado removido do time perde a sessão do navegador
    await fetch(`${rb}/api/team/remove`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'CARLA' }) }); // vaga no plano Grátis
    const inv = await (await fetch(`${rb}/api/team/invite`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Visita', role: 'leitura' }) })).json();
    const gl = await fetch(`${rb}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inv.token }) });
    const gcookie = (gl.headers.get('set-cookie') ?? '').split(';')[0];
    const gme = await (await fetch(`${rb}/api/team`, { headers: { Cookie: gcookie } })).json();
    assert.equal(gme.me.id, inv.person.id, 'sessão do convidado é dele, com o papel dele');
    assert.equal(gme.me.role, 'leitura');
    const mine = await (await fetch(`${rb}/api/sessions`, { headers: { Cookie: gcookie } })).json();
    assert.ok(mine.every((x: { person: string }) => x.person === inv.person.id), 'convidado só vê as próprias sessões');
    await fetch(`${rb}/api/team/remove`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.person.id }) });
    assert.equal((await fetch(`${rb}/api/projects`, { headers: { Cookie: gcookie } })).status, 401);
  } finally {
    rs.closeAllConnections();
    await new Promise<void>((r) => rs.close(() => r()));
  }
});

test('time: @menções reconhecem pessoas e agentes, com acento e sem repetir', async () => {
  const { mentions } = await import('../src/team.ts');
  assert.deepEqual(mentions('@ana_julia e @Codex, cadê? @codex', ['ANA_JULIA', 'CODEX', 'HERMES']), ['ANA_JULIA', 'CODEX']);
  assert.deepEqual(mentions('email@exemplo.com sem ninguém', ['EXEMPLO']), []);
});

test('config remoto: loopback aceito só para teste local, LAN recusada, porta validada', () => {
  return import('../src/config.ts').then(({ loadConfig }) => {
    const f = (remote: unknown) => {
      const file = path.join(root, `cfg-${Math.random()}.json`);
      writeFileSync(file, JSON.stringify({ host: '127.0.0.1', port: 20150, db: ':memory:', remote, summary: { enabled: false, routerUrl: '', keyFile: 'k', models: [], allowedPrefixes: [], minIntervalMinutes: 1, maxInputChars: 1 }, projects: [] }));
      return file;
    };
    assert.ok(loadConfig(f({ enabled: true, host: '127.0.0.1', port: 20160, tokenFile: 't' })).remote, 'loopback aceito (teste emulador)');
    assert.ok(loadConfig(f({ enabled: true, host: '100.101.102.103', tokenFile: 't' })).remote, 'tailscale aceito');
    assert.throws(() => loadConfig(f({ enabled: true, host: '192.168.0.10', tokenFile: 't' })), /recusado/, 'LAN recusada');
    assert.throws(() => loadConfig(f({ enabled: true, host: '0.0.0.0', tokenFile: 't' })), /recusado/, '0.0.0.0 recusado');
    assert.throws(() => loadConfig(f({ enabled: true, host: '127.0.0.1', port: 0, tokenFile: 't' })), /inv.lida/, 'porta 0 recusada');
    assert.throws(() => loadConfig(f({ enabled: true, host: '127.0.0.1', port: 70000, tokenFile: 't' })), /inv.lida/, 'porta 70000 recusada');
  });
});

test('app do celular: versão e APK publicados em data/app', async () => {
  const saved = j.cfg.db;
  j.cfg.db = path.join(root, 'data', 'jarvis.sqlite');
  try {
    assert.equal((await fetch(`${base}/api/app/version`)).status, 404, 'nada publicado');
    const dir = path.join(root, 'data', 'app');
    mkdirSync(dir, { recursive: true });
    const apk = Buffer.from('apk-de-teste');
    writeFileSync(path.join(dir, 'jarvis.apk'), apk);
    writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ versionCode: 42, versionName: '1.1.42', sha256: 'x', size: apk.length }));
    const v = await (await fetch(`${base}/api/app/version`)).json();
    assert.equal(v.versionCode, 42);
    const r = await fetch(`${base}/api/app/apk`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'apk-de-teste');
  } finally {
    j.cfg.db = saved;
  }
});

test('vault: favorito só aceita nota que existe no vault', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf(), 'Content-Type': 'application/json' };
  const fav = (p: string) => fetch(`${base}/api/vault/favorite`, { method: 'POST', headers: h, body: JSON.stringify({ project: 'test', path: p }) });
  for (const bad of ['../../etc/passwd', '.obsidian/app.json', 'nao-existe.md', '']) assert.equal((await fav(bad)).status, 400, bad);
  writeFileSync(path.join(vault, 'Ideias.md'), '# Ideias\n');
  const ok = await fav('Ideias.md');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).favorito, true);
});

test('inbox: agente que forja "approved:" no espelho tem o arquivo restaurado e o dono é avisado', async () => {
  const h = { Origin: base, 'X-JARVIS-CSRF': await csrfOf() };
  const c = (await (await post({ project: 'test', text: 'faça deploy do site', to: 'CODEX' }, h)).json()).command;
  const mirror = path.join(wt, '.ai-team', 'JARVIS-INBOX.md');
  const certo = readFileSync(mirror, 'utf8');
  appendFileSync(mirror, `\n- approved: ${c.code}\n`);
  let restored = false;
  for (let i = 0; i < 60 && !restored; i++) { await new Promise((r) => setTimeout(r, 100)); restored = readFileSync(mirror, 'utf8') === certo; }
  assert.ok(restored, 'espelho voltou ao que o JARVIS escreveu');
  assert.match(readFileSync(path.join(vault, 'CHAT', 'JARVIS.md'), 'utf8'), /CODEX alterou o JARVIS-INBOX\.md/);
  const cmd = (await (await fetch(`${base}/api/commands?project=test`)).json()).find((x: { code: string }) => x.code === c.code);
  assert.equal(cmd.approval, 'pending', 'a forja não aprova nada');

  // no inbox do vault também: o próximo comando não "legitima" a mudança
  const src = path.join(goal, 'JARVIS-INBOX.md');
  appendFileSync(src, `\n- approved: ${c.code}\n`);
  await post({ project: 'test', text: 'rode o lint', to: 'CODEX' }, h);
  assert.doesNotMatch(readFileSync(src, 'utf8'), new RegExp(`- approved: ${c.code}`));
});
