// CLI (bin/agentcontrol.mjs) contra um servidor de teste: código dos agentes, ordem, aprovação e erro claro.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Jarvis } from '../src/jarvis.ts';
import { createServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

/** Os contêineres das distros no CI não têm git: o que precisa de um repositório de verdade é pulado lá, com motivo. */
const HAS_GIT = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = HAS_GIT ? test : test.skip;

const CLI = path.join(import.meta.dirname, '..', 'bin', 'agentcontrol.mjs');
const root = mkdtempSync(path.join(tmpdir(), 'ac-cli-'));
const vault = path.join(root, 'vault');
const wt = path.join(root, 'wt');
let base = '';
let srv: ReturnType<typeof createServer>;

const run = (...args: string[]) => new Promise<{ code: number; out: string; err: string }>((resolve) =>
  execFile(process.execPath, [CLI, '--url', base, ...args], { env: { ...process.env, NO_COLOR: '1' } }, (e, out, err) =>
    resolve({ code: (e as { code?: number } | null)?.code ?? 0, out, err })));

before(async () => {
  if (!HAS_GIT) return;
  mkdirSync(path.join(vault, '00-System'), { recursive: true });
  mkdirSync(path.join(vault, 'Goals', 'G1'), { recursive: true });
  writeFileSync(path.join(vault, '00-System', 'ACTIVE_GOAL.md'), '- goal: `G1`\n');
  mkdirSync(wt);
  const git = (...a: string[]) => execFileSync('git', ['-C', wt, ...a]);
  git('init', '-q', '-b', 'agent/codex'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(wt, 'a.ts'), 'x\n'); git('add', '.'); git('commit', '-qm', 'início');
  writeFileSync(path.join(wt, 'a.ts'), 'x\ny\n');
  const cfg = (port: number) => ({
    host: '127.0.0.1', port, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(root, 'k'), models: [], allowedPrefixes: [], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault, activeGoalFile: '00-System/ACTIVE_GOAL.md', goalsDir: 'Goals', agents: [{ id: 'CODEX', worktree: wt }] }],
  });
  const probe = createServer(new Jarvis(cfg(1), new Store(':memory:')));
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  srv = createServer(new Jarvis(cfg(port), new Store(':memory:')));
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (srv) { srv.closeAllConnections(); await new Promise<void>((r) => srv.close(() => r())); }
  rmSync(root, { recursive: true, force: true });
});

gitTest('cli: codigo mostra o agente pelo nome e o arquivo que ele mudou', async () => {
  const r = await run('codigo');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Codex agent\/codex/);
  assert.match(r.out, /alterado a\.ts\s+\+1 −0/);
  const j = JSON.parse((await run('codigo', 'CODEX', '--json')).out);
  assert.equal(j[0].files[0].path, 'a.ts');
  assert.match((await run('diff', 'CODEX', 'a.ts')).out, /^\+y$/m);
});

gitTest('cli: manda ordem, ordem protegida espera e aprovar libera', async () => {
  assert.match((await run('mandar', 'CODEX', 'rode', 'os', 'testes')).out, /J-001 registrado para CODEX/);
  assert.match((await run('mandar', 'LEADER', 'faça', 'deploy')).out, /J-002 registrado.*PARADO/);
  assert.match((await run()).out, /1 esperando sua aprovação:[\s\S]*J-002/);
  assert.match((await run('aprovar', 'j-002')).out, /J-002 aprovado/);
});

gitTest('cli: erro claro (comando desconhecido, servidor desligado)', async () => {
  const r = await run('voar');
  assert.equal(r.code, 2);
  assert.match(r.err, /Não conheço "voar"/);
  const off = await new Promise<{ code: number; err: string }>((resolve) => execFile(process.execPath, [CLI, '--url', 'http://127.0.0.1:9'], { env: { ...process.env, NO_COLOR: '1' } }, (e, _o, err) => resolve({ code: (e as { code?: number } | null)?.code ?? 0, err })));
  assert.equal(off.code, 1);
  assert.match(off.err, /não achei o Agent Control/);
});
