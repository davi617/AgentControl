import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact } from '../src/redact.ts';
import { about } from '../src/extras.ts';
test('personal contact and home directory are removed from app text', () => {
  assert.equal(redact('Contact person@example.test at C:\\Users\\person\\Documents\\file.md'), 'Contact [REDACTED] at [HOME]\\Documents\\file.md');
  assert.equal(redact('/home/person/work /Users/person/work'), '[HOME]/work [HOME]/work');
});
test('about uses a generic computer label', () => {
  assert.equal(about(':memory:').pc.nome, 'Computador');
});
