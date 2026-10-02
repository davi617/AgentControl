import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexLimit, readCodexLimits } from '../src/limits.ts';

test('cotas: múltiplos buckets, janelas distintas e valores ausentes', () => {
  const q = codexLimit({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 }, secondary: { usedPercent: 64, windowDurationMins: 10080 }
  } }, accountId: 'privado', credits: { balance: 'privado' } });
  assert.equal(q.remainingPercent, 36); assert.equal(q.windows[0].name, '5 horas'); assert.equal(q.windows[1].name, '7 dias');
  assert.equal(JSON.stringify(q).includes('privado'), false);
  assert.equal(codexLimit({ rateLimits: { primary: null } }).remainingPercent, null);
  assert.equal(codexLimit({ rateLimits: { primary: { usedPercent: null } } }).status, 'unavailable');
  assert.equal(codexLimit({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 5 } } }).status, 'limited');
});

test('cotas: handshake real, consulta somente leitura, erro e timeout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quota-rpc-'));
  try {
    const f = path.join(dir, 'fake.cjs');
    writeFileSync(f, `const rl=require('readline').createInterface({input:process.stdin}); let init=false; rl.on('line',s=>{const m=JSON.parse(s); if(m.method==='initialize'){init=true;console.log(JSON.stringify({id:1,result:{}}));}else if(m.method==='initialized'){}else if(m.method==='account/rateLimits/read'&&init){console.log(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:30,windowDurationMins:300}}}}));}else process.exit(2);});`);
    const q = await readCodexLimits([process.execPath, [f]], 3000); assert.equal(q.remainingPercent, 70);
    writeFileSync(f, `process.stdin.resume();setInterval(()=>{},1000);`);
    const timed = await readCodexLimits([process.execPath, [f]], 100); assert.equal(timed.remainingPercent, null); assert.equal(timed.status, 'unavailable');
    const missing = await readCodexLimits([path.join(dir, 'missing'), []], 100); assert.equal(missing.remainingPercent, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
