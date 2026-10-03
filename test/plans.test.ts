// Planos e licença (freemium): assinatura Ed25519 conferida offline, vencimento, troca e limite de pessoas.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PLANS, PlanStore, checkLicense, encodeLicense, publicPlan, type License } from '../src/plans.ts';

const vendor = generateKeyPairSync('ed25519');
const pub = vendor.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const issue = (l: License, key = vendor.privateKey) => encodeLicense(l, (data) => sign(null, data, key));
const future = new Date(Date.now() + 30 * 86_400_000).toISOString();

test('plano: sem licença é Grátis com 3 pessoas', () => {
  const s = new PlanStore(null, pub).state();
  assert.equal(s.plan.id, 'gratis');
  assert.equal(s.pessoas, 3);
  assert.equal(PLANS.time.pessoas, Infinity);
});

test('licença: assinatura certa vale; alterada, de outro vendedor ou vencida é recusada', () => {
  const lic: License = { plan: 'pro', cliente: 'cliente-1', validaAte: future, emitida: new Date().toISOString() };
  const text = issue(lic);
  const ok = checkLicense(text, pub);
  assert.ok(ok.ok && ok.license.plan === 'pro');

  // trocar o plano no texto sem reassinar
  const [h, body, sig] = text.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.plan = 'empresa';
  const r1 = checkLicense(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`, pub);
  assert.ok(!r1.ok && /assinatura/.test(r1.motivo));

  const other = generateKeyPairSync('ed25519');
  const r2 = checkLicense(issue(lic, other.privateKey), pub);
  assert.ok(!r2.ok && /assinatura/.test(r2.motivo));

  const r3 = checkLicense(issue({ ...lic, validaAte: '2020-01-01T00:00:00Z' }), pub);
  assert.ok(!r3.ok && /venceu/.test(r3.motivo));

  assert.ok(!checkLicense('qualquer coisa', pub).ok);
  const r4 = checkLicense(text, '');
  assert.ok(!r4.ok && /chave do vendedor/.test(r4.motivo), 'app compilado sem chave não aceita licença paga');
});

test('licença: instalar grava só a válida, não troca a boa por uma ruim, e o limite de pessoas segue a licença', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plano-'));
  const store = new PlanStore(dir, pub);
  const st = store.install(issue({ plan: 'time', cliente: 'cliente-2', pessoas: 12, validaAte: future, emitida: new Date().toISOString() }));
  assert.equal(st.plan.id, 'time');
  assert.equal(st.pessoas, 12);
  assert.match(readFileSync(path.join(dir, 'license.txt'), 'utf8'), /^AC1\./);
  assert.throws(() => store.install('AC1.xxx.yyy'), /assinatura|formato|ilegível/);
  assert.equal(store.state().plan.id, 'time', 'a licença boa continua');

  const pp = publicPlan(store.state());
  assert.equal(pp.plano, 'time');
  assert.equal(pp.planos.find((p) => p.id === 'time')!.pessoas, null, 'Infinity vira null no JSON');
});
