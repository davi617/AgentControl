// v4.0: matriz de permissões das rotas, migrações do banco, auditoria encadeada, aprovação em dupla e pânico.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { decideCommand, createCommand } from '../src/commands.ts';
import type { Config } from '../src/config.ts';
import { Jarvis } from '../src/jarvis.ts';
import { ROUTES, roleAllows } from '../src/routes.ts';
import { createServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const root = mkdtempSync(path.join(tmpdir(), 'ac-v4-'));
const vault = path.join(root, 'vault');
const models = path.join(root, 'models');
const TOKEN = 'token-dono-v4-0123456789abcdef0123';

function cfg(port: number): Config {
  return {
    host: '127.0.0.1', port, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(root, 'k'), models: [], allowedPrefixes: ['nvidia/'], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault, activeGoalFile: '00-System/ACTIVE_GOAL.md', goalsDir: '20-Operations/Goals', chatDir: 'CHAT', modelsDir: models, agents: [{ id: 'CODEX' }] }],
  };
}

let j: Jarvis;
let base = '';
let srv: ReturnType<typeof createServer>;
const tokens: Record<string, string> = {};

const call = (method: string, p: string, auth?: string, body?: unknown, extra: Record<string, string> = {}) => fetch(`${base}${p}`, {
  method,
  headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

before(async () => {
  mkdirSync(path.join(vault, '00-System'), { recursive: true });
  mkdirSync(path.join(vault, '20-Operations', 'Goals', 'G1'), { recursive: true });
  mkdirSync(models, { recursive: true });
  writeFileSync(path.join(vault, '00-System', 'ACTIVE_GOAL.md'), '- status: `ACTIVE`\n- goal: `G1`\n');
  const probe = createServer(new Jarvis(cfg(1), new Store(':memory:')), { host: '127.0.0.1', token: TOKEN });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  j = new Jarvis(cfg(port), new Store(':memory:'));
  srv = createServer(j, { host: '127.0.0.1', token: TOKEN, port });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
  tokens.dono = TOKEN;
  tokens.membro = (await (await call('POST', '/api/team/invite', TOKEN, { name: 'Mia', role: 'membro' })).json()).token;
  tokens.leitura = (await (await call('POST', '/api/team/invite', TOKEN, { name: 'Leo', role: 'leitura' })).json()).token;
});

after(async () => {
  srv?.closeAllConnections();
  await new Promise<void>((r) => srv.close(() => r()));
});

test('toda escrita pede pelo menos "membro" e nenhuma rota se repete', () => {
  const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
  assert.equal(new Set(keys).size, keys.length, 'rota duplicada na tabela');
  for (const r of ROUTES) if (r.method === 'POST') assert.ok(roleAllows(r.role, 'membro'), `${r.path} sem papel de escrita`);
});

test('matriz: cada rota × papel (anônimo/leitura/membro/dono) só passa com o papel certo', async () => {
  // Ações que mudam o estado de quem testa (pânico, sair do time) ficam fora da parte "permitido"; a parte "negado" testa todas.
  const sideEffects = new Set(['/api/panic', '/api/team/remove', '/api/team/role', '/api/sessions/revoke']);
  for (const r of ROUTES) {
    if (r.path === '/events') continue; // stream aberto; coberto no e2e
    const qs = r.method === 'GET' ? '?project=p' : '';
    const body = r.method === 'POST' ? { project: 'p' } : undefined;
    assert.equal((await call(r.method, r.path + qs, undefined, body)).status, 401, `${r.method} ${r.path} sem token`);
    for (const role of ['leitura', 'membro', 'dono'] as const) {
      if (roleAllows(role, r.role) && sideEffects.has(r.path)) continue;
      const res = await call(r.method, r.path + qs, tokens[role], body);
      await res.arrayBuffer();
      if (!roleAllows(role, r.role)) assert.equal(res.status, 403, `${role} não deveria passar em ${r.method} ${r.path}`);
      else assert.notEqual(res.status, 403, `${role} deveria passar em ${r.method} ${r.path}`);
    }
  }
});

test('local: nenhuma escrita passa sem o CSRF do navegador', async () => {
  const lj = new Jarvis(cfg(1), new Store(':memory:'));
  const probe = createServer(lj);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  lj.cfg.port = port;
  const ls = createServer(lj);
  await new Promise<void>((r) => ls.listen(port, '127.0.0.1', r));
  try {
    for (const r of ROUTES.filter((x) => x.method === 'POST')) {
      const res = await fetch(`http://127.0.0.1:${port}${r.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: '{"project":"p"}' });
      assert.equal(res.status, 403, `${r.path} aceitou escrita sem CSRF`);
    }
  } finally { ls.closeAllConnections(); await new Promise<void>((r) => ls.close(() => r())); }
});

test('migração: banco da Fase 2 (sem approval, sem created_by, user_version 0) sobe até a versão atual', () => {
  const file = path.join(root, 'velho.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE commands (id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, code TEXT NOT NULL UNIQUE, target TEXT NOT NULL, text TEXT NOT NULL,
    requires_approval INTEGER NOT NULL, status TEXT NOT NULL, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  old.exec(`INSERT INTO commands(project, code, target, text, requires_approval, status, created_at, updated_at) VALUES
    ('p','J-001','LEADER','deploy',1,'AWAITING_APPROVAL','2026-01-01T00:00:00','2026-01-01T00:00:00'),
    ('p','J-002','LEADER','[Ana] testes',0,'NEW','2026-01-01T00:00:00','2026-01-01T00:00:00')`);
  old.close();
  const s = new Store(file);
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.command('J-001')!.approval, 'pending');
  assert.equal(s.command('J-001')!.created_by, 'DONO');
  assert.equal(s.command('J-002')!.created_by, null, 'comando de outra pessoa não vira do dono');
  s.close();
  const again = new Store(file); // abrir de novo não roda nada outra vez
  assert.equal(again.schemaVersion, 2);
  again.close();
});

test('auditoria: corrente confere, banco recusa editar/apagar e adulteração é achada', () => {
  const s = new Store(':memory:');
  s.audit({ project: 'p', actor: 'DONO', action: 'comando', target: 'J-001' });
  s.audit({ project: 'p', actor: 'MIA', action: 'aprovou', target: 'J-001' });
  s.audit({ project: '', actor: 'DONO', action: 'convidou', target: 'LEO' });
  assert.deepEqual(s.verifyAudit(), { ok: true, total: 3, brokenAt: null });
  assert.equal(s.auditLog('p').length, 3, 'linhas sem projeto (time) aparecem em todo projeto');
  assert.throws(() => s.db.exec("UPDATE audit SET actor = 'X' WHERE id = 2"), /só aceita acréscimo/);
  assert.throws(() => s.db.exec('DELETE FROM audit WHERE id = 2'), /só aceita acréscimo/);
  s.db.exec('DROP TRIGGER audit_no_update');
  s.db.exec("UPDATE audit SET actor = 'X' WHERE id = 2");
  assert.deepEqual(s.verifyAudit(), { ok: false, total: 2, brokenAt: 2 });
});

test('aprovação em dupla: um "sim" não libera, a mesma pessoa não vota duas vezes, o segundo libera', () => {
  const s = new Store(':memory:');
  const p = cfg(1).projects[0];
  const c = createCommand(s, p, 'faça deploy em produção', 'LEADER');
  const inbox = path.join(vault, '20-Operations', 'Goals', 'G1', 'JARVIS-INBOX.md');
  assert.equal(decideCommand(s, p, c.code, 'approve', 'DONO', 2).approval, 'pending');
  assert.doesNotMatch(readFileSync(inbox, 'utf8'), new RegExp(`approved: ${c.code}`), 'meio aprovado não chega aos agentes');
  assert.throws(() => decideCommand(s, p, c.code, 'approve', 'DONO', 2), /já decidiu/);
  const ok = decideCommand(s, p, c.code, 'approve', 'SOCIA', 2);
  assert.equal(ok.approval, 'approved');
  assert.match(readFileSync(inbox, 'utf8'), new RegExp(`approved: ${c.code}[\\s\\S]*por DONO e SOCIA`));

  const c2 = createCommand(s, p, 'git push --force', 'LEADER');
  assert.equal(decideCommand(s, p, c2.code, 'reject', 'SOCIA', 2).approval, 'rejected', 'um "não" basta');
});

test('aprovação em dupla não liga no plano Grátis', async () => {
  const off = await call('POST', '/api/settings', TOKEN, { project: 'p', aprovacaoDupla: true });
  assert.equal(off.status, 402);
  assert.match((await off.json()).error, /plano Time/);
});

test('auditoria pela API: só o dono vê; CSV neutraliza fórmula', async () => {
  const cmd = await (await call('POST', '/api/commands', tokens.membro, { project: 'p', text: '=HYPERLINK("http://x")', to: 'LEADER' })).json();
  assert.equal(cmd.command.created_by, 'MIA');
  assert.equal((await call('GET', '/api/audit?project=p', tokens.membro)).status, 403);
  const log = await (await call('GET', '/api/audit?project=p', TOKEN)).json();
  assert.equal(log.verificacao.ok, true);
  assert.ok(log.linhas.some((l: { actor: string; action: string }) => l.actor === 'MIA' && l.action === 'comando'));
  const bytes = Buffer.from(await (await call('GET', '/api/audit?project=p&formato=csv', TOKEN)).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para o Excel abrir os acentos certo');
  const csv = bytes.subarray(3).toString('utf8');
  assert.match(csv, /^id,quando,projeto,quem,acao,alvo,detalhe,hash\r\n/);
  assert.doesNotMatch(csv, /,=HYPERLINK|,"=HYPERLINK/, 'célula começando com = viraria fórmula');
});

test('pânico: para os agentes, fecha o acesso de quem não é dono e desfaz', async () => {
  const r = await (await call('POST', '/api/panic', TOKEN, {})).json();
  assert.deepEqual(r.pausados, ['p']);
  assert.ok(existsSync(path.join(models, 'PAUSE')));
  assert.match(readFileSync(path.join(models, 'PAUSE'), 'utf8'), /^agora/);
  assert.equal((await call('GET', '/api/projects', tokens.membro)).status, 423);
  assert.equal((await call('GET', '/api/projects', TOKEN)).status, 200, 'o dono segue entrando');
  const login = await call('POST', '/api/login', undefined, { token: tokens.membro }, { Origin: base });
  assert.equal(login.status, 423, 'nem entra de novo pelo navegador');
  assert.ok((await (await call('GET', '/api/settings?project=p', TOKEN)).json()).panico);

  await call('POST', '/api/panic', TOKEN, { on: false });
  assert.equal(existsSync(path.join(models, 'PAUSE')), false);
  assert.equal((await call('GET', '/api/projects', tokens.membro)).status, 200);
  const acts = j.store.auditLog(null).map((a) => a.action);
  assert.ok(acts.includes('pânico') && acts.includes('fim do pânico'));
});

test('versão única: package.json e .csproj batem com version.json', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [path.join(import.meta.dirname, '..', 'tools', 'versao.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /^ok: tudo em \d+\.\d+\.\d+/);
});
