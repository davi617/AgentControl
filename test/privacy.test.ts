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

test('source cache does not store the absolute account path', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { Store } = await import('../src/store.ts');
  const { ingest } = await import('../src/sources.ts');
  const vault = mkdtempSync(path.join(tmpdir(), 'privacy-cache-'));
  const store = new Store(':memory:');
  try {
    const file = path.join(vault, 'STATUS.md');
    writeFileSync(file, '# STATUS\n\n- status: DONE\n- task: generic task\n');
    const p = { id: 'workspace', name: 'Project', vault, activeGoalFile: 'ACTIVE.md', goalsDir: 'Goals', agents: [{ id: 'CLAUDE' }] };
    const source = { path: file, kind: 'status' as const, agent: 'CLAUDE' };
    const entries = ingest(store, p, source, true);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'STATUS.md');
    const keys = store.db.prepare('SELECT path FROM files').all();
    assert.equal(keys[0].path, 'workspace::status::CLAUDE::STATUS.md');
    assert.equal(ingest(store, p, source, false).length, 0);
  } finally { store.db.close(); rmSync(vault, { recursive: true, force: true }); }
});
