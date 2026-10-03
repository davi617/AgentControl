import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { localDay } from '../src/date.ts';

test('calendar keys remain ISO-shaped without locale data', () => {
  const original = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = () => { throw new Error('locale unavailable'); };
  try {
    assert.equal(localDay(new Date(2026, 0, 2, 12)), '2026-01-02');
    assert.equal(localDay(new Date(2024, 1, 29, 12)), '2024-02-29');
  } finally { Date.prototype.toLocaleDateString = original; }
});

test('calendar keys use the computer timezone rather than UTC', () => {
  const source = `import { localDay } from ${JSON.stringify(new URL('../src/date.ts', import.meta.url).href)}; console.log(localDay(new Date('2026-09-27T01:00:00Z')));`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, TZ: 'America/Sao_Paulo' }, encoding: 'utf8',
  });
  assert.equal(output.trim(), '2026-09-26');
});
