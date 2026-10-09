import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, repairMojibake } from '../src/normalize.ts';
import { redact } from '../src/redact.ts';

test('remove BOM e converte `r`n literal (bug real do goal-sync.ps1)', () => {
  assert.equal(normalize('﻿# STATUS`r`n`r`nAguardando ACK.'), '# STATUS\n\nAguardando ACK.');
});

test('CRLF vira LF', () => {
  assert.equal(normalize('a\r\nb\rc'), 'a\nb\nc');
});

test('repara mojibake real do TASKS.md', () => {
  assert.equal(repairMojibake('Tornar E2E local reproduzÃ­vel sem esconder testes que nÃ£o dependem de DB'),
    'Tornar E2E local reproduzível sem esconder testes que não dependem de DB');
  assert.equal(repairMojibake('RevisÃ£o QA/security'), 'Revisão QA/security');
  assert.equal(repairMojibake('Desktopâ†”API'), 'Desktop↔API');
  assert.equal(repairMojibake('SÃ³ o owner edita'), 'Só o owner edita');
});

test('não mexe em texto UTF-8 correto (inclusive com travessão e acentos)', () => {
  const ok = '## 2026-09-23 00:20 — CLAUDE\n- status: DONE\nevidência: não há';
  assert.equal(normalize(ok), ok);
});

test('linha mista: só a linha com mojibake é reparada', () => {
  const t = 'ação correta\nfalha de autenticaÃ§Ã£o';
  assert.equal(repairMojibake(t), 'ação correta\nfalha de autenticação');
});

test('redact: cabeçalho Bearer, JWT, chaves conhecidas', () => {
  const s = [
    'Authorization: Bearer abcdefghijklmnop1234',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlX3Rlc3Q',
    'sk-proj-AAAAAAAAAAAAAAAAAAAAAA',
    'nvapi-ZZZZZZZZZZZZZZZZZZZZZZZZ',
    'AIzaSyA1234567890abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
  ].join('\n');
  const r = redact(s);
  for (const leak of ['abcdefghijklmnop1234', 'eyJzdWIi', 'AAAAAAAAAAAA', 'ZZZZZZZZ', 'SyA1234567890', 'ghp_abcdef']) {
    assert.ok(!r.includes(leak), `vazou: ${leak}`);
  }
});

test('redact: atribuições de senha/token/cookie e URL com credencial', () => {
  const r = redact('password=hunter2secret\napi_key: "k-123456789"\nsenha: minhasenha1\ncookie: sid=abc12345\npostgres://dw:SuperSecreta@localhost:5432/db');
  for (const leak of ['hunter2secret', 'k-123456789', 'minhasenha1', 'sid=abc12345', 'SuperSecreta']) assert.ok(!r.includes(leak), `vazou: ${leak}`);
  assert.ok(r.includes('postgres://[REDACTED]@localhost:5432/db'));
});

test('redact: conta NVIDIA em mensagem de erro de provider', () => {
  const r = redact("Function '23d4': Not found for account 'j-gvFud4Jz_qa9j0c3'");
  assert.ok(!r.includes('j-gvFud4Jz'));
});

test('redact: não estraga texto normal do bus', () => {
  const t = '- tokens_remaining_estimate: UNKNOWN\n- task: T-010\n- evidence: 22/22 PASS\nToken budget estimate: ~50000';
  assert.equal(redact(t), t);
});

test('redact: Stripe, GitLab, HuggingFace, npm, Telegram, webhooks do Slack/Discord e .npmrc', () => {
  // Montados por partes para o gitleaks do CI não confundir com segredo de verdade.
  const x = (n: number) => 'a1B2c3D4e5'.repeat(5).slice(0, n);
  const casos = [
    'sk' + '_live_' + x(24), 'rk' + '_test_' + x(24), 'glpat' + '-' + x(20), 'hf' + '_' + x(34), 'npm' + '_' + x(36),
    '123456789' + ':AA' + x(33),
    'https://hooks.slack' + '.com/services/T000/B000/' + x(24),
    'https://discord' + '.com/api/webhooks/123456789012/' + x(40),
  ];
  for (const c of casos) {
    const r = redact(`erro ao chamar ${c} agora`);
    assert.ok(!r.includes(c), c);
    assert.match(r, /\[REDACTED\]/);
  }
  assert.equal(redact('//registry.npmjs.org/:_authToken=' + x(30)), '//registry.npmjs.org/:_authToken=[REDACTED]');
});
