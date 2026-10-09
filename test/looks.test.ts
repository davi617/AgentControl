// Personagens do Modo Prédio: só cores e estilos válidos entram; a foto nunca chega ao servidor.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Jarvis } from '../src/jarvis.ts';
import { lookOwnerOk, sanitizeLook } from '../src/looks.ts';
import { createServer } from '../src/server.ts';
import { Store } from '../src/store.ts';

const ok = { skin: '#e8b894', hair: '#3B2A20', shirt: '#3B82F6', pants: '#1E3A8A', shoes: '#F4F4F5', cap: '#EF4444', style: 'cacheado', top: 'moletom', acc: 'oculos' };

test('sanitizeLook: aceita cores #RRGGBB e estilos conhecidos, recusa o resto', () => {
  assert.deepEqual(sanitizeLook(ok), { ...ok, skin: '#E8B894', hair: '#3B2A20' });
  assert.equal(sanitizeLook({ ...ok, skin: 'red' }), null);
  assert.equal(sanitizeLook({ ...ok, skin: 'url(x)' }), null);
  assert.equal(sanitizeLook({ ...ok, style: '<img onerror=1>' }), null);
  assert.equal(sanitizeLook({ ...ok, top: undefined }), null);
  assert.equal(sanitizeLook('x'), null);
  const extra = sanitizeLook({ ...ok, foto: 'data:image/png;base64,AAAA' }) as unknown as Record<string, unknown>;
  assert.equal('foto' in extra, false, 'campo a mais (foto) é jogado fora');
});

test('lookOwnerOk: só você ou um agente do projeto', () => {
  assert.equal(lookOwnerOk('VOCÊ', []), true);
  assert.equal(lookOwnerOk('CODEX', ['CODEX']), true);
  assert.equal(lookOwnerOk('INTRUSO', ['CODEX']), false);
  assert.equal(lookOwnerOk(3, ['CODEX']), false);
});

test('API: grava, aparece no /api/state e volta ao sorteado com look null', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-looks-'));
  const cfg = (port: number) => ({
    host: '127.0.0.1', port, db: ':memory:',
    summary: { enabled: false, routerUrl: 'http://127.0.0.1:9/v1', keyFile: path.join(root, 'k'), models: [], allowedPrefixes: ['nvidia/'], minIntervalMinutes: 999, maxInputChars: 4000 },
    projects: [{ id: 'p', name: 'P', vault: root, activeGoalFile: 'x.md', goalsDir: 'g', agents: [] }],
  });
  // porta livre: sobe uma vez em 0 para descobrir, depois cria com a porta certa (host check depende dela)
  const probe = createServer(new Jarvis(cfg(1), new Store(':memory:')));
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const srv = createServer(new Jarvis(cfg(port), new Store(':memory:')));
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;
  try {
    const csrf = (await (await fetch(`${base}/api/session`)).json()).csrf;
    const post = (body: object, h: Record<string, string> = {}) => fetch(`${base}/api/looks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-JARVIS-CSRF': csrf, ...h }, body: JSON.stringify({ project: 'p', ...body }) });
    assert.equal((await post({ id: 'VOCÊ', look: ok }, { 'X-JARVIS-CSRF': 'errado' })).status, 403, 'sem CSRF não grava');
    assert.equal((await post({ id: 'VOCÊ', look: { ...ok, hair: 'javascript:1' } })).status, 400);
    assert.equal((await post({ id: 'NINGUEM', look: ok })).status, 400);
    const r = await post({ id: 'VOCÊ', look: ok });
    assert.equal(r.status, 200);
    const st = await (await fetch(`${base}/api/state?project=p`)).json();
    assert.equal(st.looks['VOCÊ'].style, 'cacheado');
    assert.equal((await post({ id: 'VOCÊ', look: null })).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/looks?project=p`)).json(), {});
  } finally { srv.closeAllConnections(); await new Promise<void>((r) => srv.close(() => r())); }
});
