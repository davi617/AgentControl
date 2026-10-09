import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writePrivate } from '../src/fsutil.ts';

test('writePrivate: grava inteiro, sem .tmp sobrando e (fora do Windows) só o dono lê', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ac-fs-'));
  const f = path.join(dir, 'sub', 'team.json');
  writePrivate(f, '{"a":1}');
  writePrivate(f, '{"a":2}');
  assert.equal(readFileSync(f, 'utf8'), '{"a":2}');
  assert.deepEqual(readdirSync(path.dirname(f)), ['team.json']);
  if (process.platform !== 'win32') assert.equal(statSync(f).mode & 0o777, 0o600);
});
