// JARVIS responde o dono na sala; cérebro do vault no celular (busca e leitura, só dentro do vault).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replyToDono, routeCommand } from '../src/reply.ts';
import { readNote, searchNotes } from '../src/vault.ts';

function setup(content: (n: number) => string | Promise<string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-reply-'));
  const vault = path.join(root, 'vault');
  mkdirSync(path.join(vault, 'CHAT'), { recursive: true });
  const key = path.join(root, 'k'); writeFileSync(key, 'chave-falsa');
  const bodies: { headers: Record<string, string>; body: { messages: { content: string }[] } }[] = [];
  let n = 0;
  const fakeFetch = (async (_u: string, init: { body: string; headers: Record<string, string> }) => {
    bodies.push({ headers: init.headers, body: JSON.parse(init.body) });
    const c = await content(++n);
    return new Response(JSON.stringify({ choices: [{ message: { content: c } }] }));
  }) as unknown as typeof fetch;
  const j = {
    cfg: { summary: { routerUrl: 'http://fila', keyFile: key, models: ['nvidia/x'], allowedPrefixes: ['nvidia/'] } },
    state: () => ({ goal: 'GOAL-T', agents: [{ id: 'HERMES', latest: { status: 'DONE', task: 'T-007' } }], tasks: [{ id: 'T-016', status: 'QUEUED', owner: 'HERMES', task: 'revisar' }] }),
    store: { lastSummary: () => undefined, chat: () => [{ agent: 'DONO', body: '- para: TODOS\n\noi' }] },
    fetchImpl: fakeFetch,
  };
  const p = { id: 'dw', vault, chatDir: 'CHAT', agents: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { j: j as any, p: p as any, vault, bodies };
}

test('resposta: JARVIS responde o dono em CHAT/JARVIS.md com o estado real, na frente da fila', async () => {
  const { j, p, vault, bodies } = setup(() => 'JARVIS: Hermes terminou a T-007.');
  await replyToDono(j, p, 'como está o hermes?');
  const md = readFileSync(path.join(vault, 'CHAT', 'JARVIS.md'), 'utf8');
  assert.match(md, /## \d{4}-\d\d-\d\d \d\d:\d\d — JARVIS\n- para: DONO\n\nHermes terminou a T-007\./);
  assert.equal(bodies[0].headers['X-Gate-Priority'], 'alta');
  assert.match(bodies[0].body.messages[0].content, /HERMES: DONE \(T-007\)/);
  assert.match(bodies[0].body.messages[0].content, /T-016 QUEUED HERMES revisar/);
  assert.equal(bodies[0].body.messages[1].content, 'como está o hermes?');
});

test('resposta: fila fora do ar vira aviso na sala (o dono não fica sem resposta)', async () => {
  const { j, p, vault } = setup(() => Promise.reject(new Error('ECONNREFUSED')));
  await replyToDono(j, p, 'oi');
  assert.match(readFileSync(path.join(vault, 'CHAT', 'JARVIS.md'), 'utf8'), /Recebi sua mensagem, mas não consegui pensar agora/);
});

test('resposta: duas mensagens seguidas → uma resposta por vez, a segunda cobre o que chegou', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { j, p, vault, bodies } = setup(async (n) => { if (n === 1) await gate; return `resposta ${n}`; });
  const a = replyToDono(j, p, 'primeira');
  const b = replyToDono(j, p, 'segunda');
  release();
  await Promise.all([a, b]);
  assert.equal(bodies.length, 2);
  const md = readFileSync(path.join(vault, 'CHAT', 'JARVIS.md'), 'utf8');
  assert.ok(md.indexOf('resposta 1') < md.indexOf('resposta 2'));
});

test('cérebro: busca por título e conteúdo, sem acento, pastas ocultas fora, segredo mascarado', () => {
  const vault = mkdtempSync(path.join(tmpdir(), 'jarvis-vault-'));
  mkdirSync(path.join(vault, '05-Mapas'));
  mkdirSync(path.join(vault, '.obsidian'));
  writeFileSync(path.join(vault, '05-Mapas', 'Segurança.md'), '---\ntags: [x]\n---\n# Segurança\nVer [[Rede]] e [[Nao existe]].\n');
  writeFileSync(path.join(vault, 'Rede.md'), 'Tailscale liga o celular. token=abcdefghijklmnop123456\n');
  writeFileSync(path.join(vault, '.obsidian', 'seguranca.md'), 'oculto');
  const r = searchNotes(vault, 'seguranca');
  assert.equal(r.total, 2);
  assert.deepEqual(r.hits.map((h) => h.path), ['05-Mapas/Segurança.md']);
  const c = searchNotes(vault, 'tailscale');
  assert.equal(c.hits[0].path, 'Rede.md');
  assert.doesNotMatch(c.hits[0].snippet, /abcdefghijklmnop123456/);
  assert.equal(searchNotes(vault, '').hits.length, 2, 'sem busca: as recentes');

  const n = readNote(vault, '05-Mapas/Segurança.md')!;
  assert.equal(n.title, 'Segurança');
  assert.deepEqual(n.links, ['Rede.md']);
  assert.doesNotMatch(readNote(vault, 'Rede.md')!.text, /abcdefghijklmnop123456/);
  assert.equal(readNote(vault, '../fora.md'), undefined);
  assert.equal(readNote(vault, '.obsidian/seguranca.md'), undefined);
  assert.equal(readNote(vault, 'Rede.txt'), undefined);
});

test('comando pelo chat: "COMANDO: CLAUDE" vira J-xxx com as palavras do dono; destino inventado não vira nada', () => {
  const made: { text: string; to: string }[] = [];
  const j = { command: (_p: unknown, text: string, to: string) => { made.push({ text, to }); return { code: 'J-009', requires_approval: /push/.test(text) ? 1 : 0 }; } };
  const p = { agents: [{ id: 'CLAUDE' }, { id: 'CHATGPT' }] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (dono: string, ans: string) => routeCommand(j as any, p as any, dono, ans);
  const out = r('claude, roda os testes da api', 'Beleza, o Claude cuida disso.\nCOMANDO: CLAUDE');
  assert.deepEqual(made, [{ text: 'claude, roda os testes da api', to: 'CLAUDE' }], 'texto do dono, não do modelo');
  assert.doesNotMatch(out, /COMANDO:/);
  assert.match(out, /Registrei como comando J-009 para CLAUDE/);
  assert.match(r('faz push', 'Ok.\n**COMANDO:** LEADER'), /protegido: fica parado até você aprovar/);
  assert.equal(r('oi', 'Oi, você!'), 'Oi, você!', 'conversa não vira comando');
  made.length = 0;
  assert.equal(r('x', 'Certo.\nCOMANDO: CHATGPT'), 'Certo.', 'ChatGPT não roda sozinho: não recebe');
  assert.equal(r('x', 'Certo.\nCOMANDO: HACKER'), 'Certo.');
  assert.equal(made.length, 0);
});