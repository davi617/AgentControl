import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceName, SESSION_DAYS, Sessions } from '../src/sessions.ts';

test('sessões: vencem, têm teto por pessoa e saem todas quando a pessoa sai do time', () => {
  const s = new Sessions('');
  const t0 = Date.UTC(2026, 9, 1);
  const { secret, session } = s.create('ANA', 'x', '100.64.0.2', t0);
  assert.equal(s.verify(secret, t0 + 1000)?.id, session.id);
  assert.equal(s.verify(secret, t0 + SESSION_DAYS * 86_400_000 + 1), null, 'venceu');
  assert.equal(s.verify('chute', t0), null);

  for (let i = 0; i < 25; i++) s.create('BETO', 'x', 'ip', t0);
  assert.equal(s.view('BETO', undefined, t0).length, 20, 'no máximo 20 por pessoa');
  assert.equal(s.revokePerson('BETO'), 20);
  assert.equal(s.view('BETO', undefined, t0).length, 0);
});

test('sessões: nome do aparelho pelo User-Agent', () => {
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/140 Mobile Safari/537.36'), 'Android · Chrome');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140 Safari/537.36 Edg/140'), 'Windows · Edge');
  assert.equal(deviceName(''), 'Aparelho · navegador');
});
