// Aprovação em dupla de ponta a ponta com uma licença Time de verdade (chave de teste, gerada aqui).
// A chave pública do vendedor é lida quando plans.ts carrega: por isso a variável vem antes dos imports dinâmicos.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.AGENT_CONTROL_LICENSE_PUBKEY = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

test('plano Time: dono liga a dupla; dono + sócia (papel dono) liberam; membro não vota', async () => {
  const { encodeLicense } = await import('../src/plans.ts');
  const { Jarvis } = await import('../src/jarvis.ts');
  const { Store } = await import('../src/store.ts');
  const { createServer } = await import('../src/server.ts');

  const root = mkdtempSync(path.join(tmpdir(), 'ac-dupla-'));
  const vault = path.join(root, 'vault');
  mkdirSync(path.join(vault, '00-System'), { recursive: true });
  mkdirSync(path.join(vault, 'Goals', 'G1'), { recursive: true });
  writeFileSync(path.join(vault, '00-System', 'ACTIVE_GOAL.md'), '- goal: `G1`\n');
  const TOKEN = 'token-dono-dupla-0123456789abcdef';
  const mk = (port: number) => ({
    host: '127.0.0.1', port, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(root, 'k'), models: [], allowedPrefixes: ['nvidia/'], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault, activeGoalFile: '00-System/ACTIVE_GOAL.md', goalsDir: 'Goals', agents: [] }],
  });
  const probe = createServer(new Jarvis(mk(1), new Store(':memory:')), { host: '127.0.0.1', token: TOKEN });
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const j = new Jarvis(mk(port), new Store(':memory:'));
  const srv = createServer(j, { host: '127.0.0.1', token: TOKEN, port });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  const post = (auth: string, p: string, body: unknown) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const lic = encodeLicense({ plan: 'time', cliente: 'Teste', validaAte: '2099-01-01', emitida: '2026-10-09' }, (d) => sign(null, d, privateKey));
    assert.equal((await post(TOKEN, '/api/plan/license', { license: lic })).status, 200);
    const on = await (await post(TOKEN, '/api/settings', { project: 'p', aprovacaoDupla: true })).json();
    assert.equal(on.aprovacaoDupla, true);

    const socia = (await (await post(TOKEN, '/api/team/invite', { name: 'Sócia', role: 'dono' })).json()).token;
    const membro = (await (await post(TOKEN, '/api/team/invite', { name: 'Mia', role: 'membro' })).json()).token;
    const cmd = (await (await post(TOKEN, '/api/commands', { project: 'p', text: 'deploy em produção', to: 'LEADER' })).json()).command;

    const first = await (await post(TOKEN, '/api/commands/decide', { project: 'p', code: cmd.code, decision: 'approve' })).json();
    assert.equal(first.command.approval, 'pending');
    assert.match(first.reply, /Falta mais uma pessoa/);
    assert.equal((await post(TOKEN, '/api/commands/decide', { project: 'p', code: cmd.code, decision: 'approve' })).status, 409, 'o mesmo dono não conta duas vezes');
    assert.equal((await post(membro, '/api/commands/decide', { project: 'p', code: cmd.code, decision: 'approve' })).status, 403);
    const second = await (await post(socia, '/api/commands/decide', { project: 'p', code: cmd.code, decision: 'approve' })).json();
    assert.equal(second.command.approval, 'approved');
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
