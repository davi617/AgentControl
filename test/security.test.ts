// Segurança do acesso de fora (iPhone/PWA): freio no login, origem conferida, sair apaga o cookie, cabeçalhos.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Jarvis } from '../src/jarvis.ts';
import { createServer, LoginGuard } from '../src/server.ts';
import { Store } from '../src/store.ts';

test('LoginGuard: bloqueia o IP depois de 8 erros e libera quando acerta ou o tempo passa', () => {
  const g = new LoginGuard(8, 1000);
  for (let i = 0; i < 7; i++) g.fail('1.1.1.1', 0);
  assert.equal(g.blocked('1.1.1.1', 1), false);
  g.fail('1.1.1.1', 2);
  assert.equal(g.blocked('1.1.1.1', 3), true);
  assert.equal(g.blocked('2.2.2.2', 3), false, 'outro IP segue livre');
  assert.equal(g.blocked('1.1.1.1', 2000), false, 'passou o tempo, libera');
  g.fail('3.3.3.3', 0); g.ok('3.3.3.3');
  assert.equal(g.blocked('3.3.3.3', 1), false);
});

async function remote() {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-sec-'));
  const cfg = {
    host: '127.0.0.1', port: 1, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(root, 'k'), models: [], allowedPrefixes: ['nvidia/'], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault: root, activeGoalFile: 'x.md', goalsDir: 'g', agents: [] }],
  };
  const j = new Jarvis(cfg, new Store(':memory:'));
  const token = 'token-seguro-0123456789abcdef0123';
  const probe = createServer(j, { host: '127.0.0.1', token });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const rs = createServer(j, { host: '127.0.0.1', token, port });
  await new Promise<void>((r) => rs.listen(port, '127.0.0.1', r));
  return { rs, token, base: `http://127.0.0.1:${port}`, close: async () => { rs.closeAllConnections(); await new Promise<void>((r) => rs.close(() => r())); } };
}

test('remoto: login de outra origem é recusado, chute demais vira 429, sair apaga o cookie', async () => {
  const r = await remote();
  try {
    const login = (token: string, h: Record<string, string> = {}) => fetch(`${r.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ token }) });
    assert.equal((await login(r.token, { Origin: 'https://site-malicioso.example' })).status, 403);
    for (let i = 0; i < 8; i++) assert.equal((await login('errado' + i)).status, 401);
    const blocked = await login(r.token);
    assert.equal(blocked.status, 429, 'depois de 8 erros nem o token certo entra por 15 min');
    assert.equal(blocked.headers.get('retry-after'), '900');

    const out = await fetch(`${r.base}/api/logout`, { method: 'POST' });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') ?? '', /ac_token=;.*Max-Age=0/);
    assert.equal((await fetch(`${r.base}/api/logout`, { method: 'POST', headers: { Origin: 'https://site-malicioso.example' } })).status, 403);
  } finally { await r.close(); }
});

test('remoto: cabeçalhos de segurança e ícones do app abrem sem token; a sala não', async () => {
  const r = await remote();
  try {
    const icon = await fetch(`${r.base}/icon-192.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.match(icon.headers.get('permissions-policy') ?? '', /camera=\(\)/);
    assert.equal(icon.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(icon.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal((await fetch(`${r.base}/app.js`)).status, 401);
    assert.equal((await fetch(`${r.base}/sw.js`)).status, 401);
    const ok = await fetch(`${r.base}/app.js`, { headers: { Authorization: `Bearer ${r.token}` } });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /loadCode/);
  } finally { await r.close(); }
});

test('LoginGuard: muitos IPs não soltam quem já estava bloqueado', () => {
  const g = new LoginGuard(2, 60_000);
  for (let i = 0; i < 10_050; i++) { g.fail(`10.0.${i >> 8}.${i & 255}`, 1); g.fail(`10.0.${i >> 8}.${i & 255}`, 1); }
  assert.equal(g.blocked('10.0.39.0', 2), true, 'recente segue bloqueado');
});

test('remoto: cookie com token que não vale mais é apagado; /events tem limite por pessoa', async () => {
  const r = await remote();
  try {
    const stale = await fetch(`${r.base}/api/projects`, { headers: { Cookie: 'ac_token=velho' } });
    assert.equal(stale.status, 401);
    assert.match(stale.headers.get('set-cookie') ?? '', /ac_token=;.*Max-Age=0/);
    assert.equal((await fetch(`${r.base}/api/projects`, { headers: { Authorization: 'Bearer velho' } })).headers.get('set-cookie'), null, 'Bearer não mexe em cookie');

    const { MAX_STREAMS } = await import('../src/server.ts');
    const ctrl = new AbortController();
    const open = () => fetch(`${r.base}/events?project=p`, { headers: { Authorization: `Bearer ${r.token}` }, signal: ctrl.signal });
    const keep: Response[] = []; // guarda as respostas: o fetch fecha stream de resposta que ninguém referencia
    for (let i = 0; i < MAX_STREAMS; i++) { keep.push(await open()); assert.equal(keep[i].status, 200); }
    assert.equal((await open()).status, 429, 'passou do limite');
    ctrl.abort();
  } finally { await r.close(); }
});
