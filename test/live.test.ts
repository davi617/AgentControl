// Código ao vivo: lê o git da worktree de cada agente, gera a linha do tempo e mostra o diff (filtrado).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentName } from '../src/agents.ts';
import { Jarvis } from '../src/jarvis.ts';
import { diffSnapshots, LiveCode, readWorktree } from '../src/live.ts';
import { Store } from '../src/store.ts';

function repo() {
  const wt = mkdtempSync(path.join(tmpdir(), 'ac-live-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', wt, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'agent/claude');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(wt, 'src'));
  writeFileSync(path.join(wt, 'src', 'a.ts'), 'um\ndois\ntrês\n');
  writeFileSync(path.join(wt, 'velho.md'), 'x\n');
  git('add', '.'); git('commit', '-qm', 'início');
  return { wt, git };
}

test('nomes dos agentes', () => {
  assert.equal(agentName('CLAUDE'), 'Claude Code');
  assert.equal(agentName('qwen'), 'Qwen Code');
  assert.equal(agentName('MEU_AGENTE'), 'Meu agente');
});

test('lê arquivos alterados, novos e apagados com +/- contra o HEAD', async () => {
  const { wt } = repo();
  try {
    writeFileSync(path.join(wt, 'src', 'a.ts'), 'um\nDOIS\ntrês\nquatro\n');
    writeFileSync(path.join(wt, 'src', 'novo.ts'), 'a\nb\n');
    rmSync(path.join(wt, 'velho.md'));
    const r = await readWorktree('CLAUDE', wt);
    assert.equal(r.name, 'Claude Code');
    assert.equal(r.branch, 'agent/claude');
    assert.equal(r.headMsg, 'início');
    assert.deepEqual(r.files.map((f) => [f.path, f.status, f.adds, f.dels]), [
      ['src/a.ts', 'alterado', 2, 1], ['src/novo.ts', 'novo', 2, 0], ['velho.md', 'apagado', 0, 1],
    ]);
    assert.equal(r.adds, 4);
    assert.equal(r.dels, 2);
  } finally { rmSync(wt, { recursive: true, force: true }); }
});

test('pasta sem git não quebra: devolve o erro e nenhuma mudança', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ac-semgit-'));
  const r = await readWorktree('CODEX', path.join(dir, 'nao-existe'));
  assert.ok(r.error);
  assert.deepEqual(r.files, []);
});

test('linha do tempo: edição, desfazer e commit viram eventos com o nome do agente', () => {
  const base = { agent: 'CODEX', name: 'Codex', worktree: '/x', branch: 'b', headMsg: 'm', headAt: null, adds: 0, dels: 0 };
  const a = { ...base, head: 'aaa', files: [{ path: 'x.ts', status: 'alterado', adds: 1, dels: 0 }], changedAt: null };
  const b = { ...base, head: 'aaa', files: [{ path: 'x.ts', status: 'alterado', adds: 3, dels: 0 }, { path: 'y.ts', status: 'novo', adds: 1, dels: 0 }] };
  assert.deepEqual(diffSnapshots(undefined, b), [], 'primeira leitura não é novidade');
  const e1 = diffSnapshots(a, b, 't');
  assert.deepEqual(e1.map((e) => [e.kind, e.path, e.adds]), [['edit', 'x.ts', 3], ['edit', 'y.ts', 1]]);
  assert.equal(e1[0].name, 'Codex');
  const c = { ...base, head: 'aaa', files: [] };
  assert.deepEqual(diffSnapshots({ ...b, changedAt: null }, c, 't').map((e) => [e.kind, e.path]), [['reverted', 'x.ts'], ['reverted', 'y.ts']]);
  const d = { ...base, head: 'bbb', headMsg: 'feat: login', files: [] };
  assert.deepEqual(diffSnapshots({ ...b, changedAt: null }, d, 't').map((e) => [e.kind, e.msg]), [['commit', 'feat: login']], 'commit não conta como desfazer');
});

test('LiveCode: emite "code" no SSE, mostra o diff filtrado e recusa arquivo fora da lista', async () => {
  const { wt, git } = repo();
  const cfg = {
    host: '127.0.0.1', port: 1, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: '/x', models: [], allowedPrefixes: [], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault: wt, activeGoalFile: 'x', goalsDir: 'g', agents: [{ id: 'CLAUDE', worktree: wt }, { id: 'CHATGPT' }] }],
  };
  const j = new Jarvis(cfg, new Store(':memory:'));
  const live = new LiveCode(j);
  const seen: { agent: { name: string; files: unknown[] }; events: { kind: string }[] }[] = [];
  j.on('code', (ev) => seen.push(ev));
  try {
    const first = await live.state(cfg.projects[0]);
    live.stop();
    assert.equal(first.agents.length, 1, 'só agente com worktree');
    assert.equal(first.agents[0].files.length, 0);

    writeFileSync(path.join(wt, 'src', 'a.ts'), 'um\ndois\ntrês\nconst key = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";\n');
    await live.refresh(cfg.projects[0]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].agent.name, 'Claude Code');
    assert.equal(seen[0].events[0].kind, 'edit');

    const d = await live.diff(cfg.projects[0], 'claude', 'src/a.ts');
    assert.match(d.diff, /^\+const key/m);
    assert.doesNotMatch(d.diff, /sk-ant-api03-A{20}/, 'segredo não sai no diff');
    await assert.rejects(live.diff(cfg.projects[0], 'CLAUDE', 'velho.md'), /não está entre as mudanças/);
    await assert.rejects(live.diff(cfg.projects[0], 'CLAUDE', '../../etc/passwd'), /não está entre as mudanças/);

    writeFileSync(path.join(wt, 'novo.txt'), 'linha\n');
    await live.refresh(cfg.projects[0]);
    assert.match((await live.diff(cfg.projects[0], 'CLAUDE', 'novo.txt')).diff, /^\+linha/m, 'arquivo novo mostra o conteúdo');

    git('add', '.'); git('commit', '-qm', 'feat: chave');
    await live.refresh(cfg.projects[0]);
    const st = await live.state(cfg.projects[0]);
    assert.equal(st.agents[0].files.length, 0);
    assert.equal(st.feed[0].kind, 'commit', 'linha do tempo: mais novo primeiro');
    assert.equal(st.feed[0].msg, 'feat: chave');
  } finally { live.stop(); rmSync(wt, { recursive: true, force: true }); }
});
