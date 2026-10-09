// Chamada de voz: vez de cada um, persona, ata no vault e freio sem o dono. Modelo falso, nada de rede.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CallManager, FALLBACK_MODEL, MAX_ATTACH_BYTES, MAX_AUTO_TURNS, VISION_MODEL, callPriority, isQuotaError, nextSpeaker } from '../src/call.ts';

const P = [{ id: 'HERMES', papel: 'revisor' }, { id: 'QWEN', papel: 'desktop' }, { id: 'CLAUDE', papel: 'arquiteto' }];
const t = (speaker: string, text: string, n = 1) => ({ n, speaker, text, ts: '' });

test('nextSpeaker: quem foi chamado pelo nome fala; senão a roda, sem repetir quem acabou de falar', () => {
  assert.equal(nextSpeaker(P, [t('DONO', 'Qwen, o desktop compila?')], 0).id, 'QWEN');
  assert.equal(nextSpeaker(P, [t('HERMES', 'Concordo. CLAUDE, e a arquitetura?')], 0).id, 'CLAUDE');
  assert.equal(nextSpeaker(P, [t('HERMES', 'Eu, HERMES, acho que sim')], 0).id, 'QWEN', 'citar a si mesmo não conta');
  assert.equal(nextSpeaker(P, [t('DONO', 'bora debater')], 0).id, 'HERMES');
  assert.equal(nextSpeaker(P, [t('HERMES', 'sem nome aqui')], 0).id, 'QWEN', 'não repete quem falou');
});

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'jarvis-call-'));
  const vault = path.join(root, 'vault');
  mkdirSync(path.join(vault, '10-Agents', 'Time'), { recursive: true });
  writeFileSync(path.join(vault, '10-Agents', 'Time', 'HERMES.md'), '---\npapel: Revisor / deputy\n---\n');
  const key = path.join(root, 'k'); writeFileSync(key, 'chave-falsa');
  const events: unknown[] = [];
  const j = {
    cfg: { summary: { enabled: true, routerUrl: 'http://fila', keyFile: key, models: ['nvidia/x'], allowedPrefixes: ['nvidia/'], minIntervalMinutes: 1, maxInputChars: 1000 } },
    state: () => ({ goal: 'GOAL-T', agents: [{ id: 'HERMES', latest: { status: 'WORKING', task: 'T-007' } }] }),
    emit: (_k: string, e: unknown) => events.push(e),
  };
  const prompts: string[] = [];
  const fakeFetch = (async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    prompts.push(b.messages[0].content);
    const who = /Você é (\w+)/.exec(b.messages[0].content)![1];
    return new Response(JSON.stringify({ choices: [{ message: { content: `${who}: fala de ${who}` } }] }));
  }) as unknown as typeof fetch;
  const p = { id: 'dw', name: 'DW', vault, activeGoalFile: '', goalsDir: '', agents: [{ id: 'HERMES' }, { id: 'QWEN' }, { id: 'CHATGPT' }] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new CallManager(j as any, fakeFetch);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { m, p: p as any, vault, prompts, events };
}

test('chamada: você abre, agentes respondem com persona real, ata no vault, CHATGPT fora', async () => {
  const { m, p, vault, prompts, events } = setup();
  const c = m.start(p, 'Vamos lançar a beta?');
  assert.deepEqual(c.participants.map((x) => x.id), ['HERMES', 'QWEN'], 'CHATGPT não entra');
  const a = await m.next(p);
  assert.equal(a?.speaker, 'HERMES');
  assert.equal(a?.text, 'fala de HERMES', 'tira o "HERMES:" do começo');
  assert.match(prompts[0], /Revisor \/ deputy/, 'papel vem do vault');
  assert.match(prompts[0], /WORKING, tarefa T-007/, 'status real entra no contexto');
  assert.equal((await m.next(p))?.speaker, 'QWEN');
  m.say(p, 'Hermes, e os testes?');
  assert.equal((await m.next(p))?.speaker, 'HERMES', 'você chamou pelo nome');
  m.end(p);
  const ata = readFileSync(path.join(vault, '20-Operations', 'Calls', readdirSync(path.join(vault, '20-Operations', 'Calls'))[0]), 'utf8');
  assert.match(ata, /\*\*DONO\*\* \(\d\d:\d\d\): Vamos lançar a beta\?/);
  assert.match(ata, /\*\*QWEN\*\* \(\d\d:\d\d\): fala de QWEN/);
  assert.match(ata, /Chamada encerrada/);
  assert.equal(await m.next(p), null, 'encerrada não gera mais');
  assert.ok(events.length >= 5, 'emite eventos para o SSE');
});

test('chamada: sem o dono falar, para depois do limite e espera ele', async () => {
  const { m, p } = setup();
  m.start(p, 'debate livre');
  for (let i = 0; i < MAX_AUTO_TURNS; i++) assert.ok(await m.next(p));
  assert.equal(await m.next(p), null);
  assert.equal(m.get(p.id)?.status, 'AGUARDANDO_DONO');
  m.say(p, 'continuem');
  assert.ok(await m.next(p), 'volta depois que o dono fala');
});

test('chamada: modo goal não para no limite normal (trabalham sem parar)', async () => {
  const { m, p } = setup();
  m.start(p, 'entregar a fase 1', [], 'goal');
  for (let i = 0; i < MAX_AUTO_TURNS + 3; i++) assert.ok(await m.next(p), `fala ${i + 1} não deveria parar no modo goal`);
  assert.equal(m.get(p.id)?.status, 'ATIVA', 'continua ativa depois do limite normal de 10 falas');
});

test('chamada: modo goal não segura os agentes de fundo (prioridade alta, não voz)', () => {
  assert.equal(callPriority('goal'), 'alta');
  assert.equal(callPriority('debate'), 'voz');
  assert.equal(callPriority(undefined), 'voz');
});

test('chamada: dois pedidos de próxima fala ao mesmo tempo geram uma fala só', async () => {
  const { m, p, prompts } = setup();
  m.start(p, 'x');
  const [a, b] = await Promise.all([m.next(p), m.next(p)]);
  assert.equal(a, b);
  assert.equal(prompts.length, 1);
});

test('chamada: resposta vazia do modelo tenta de novo uma vez', async () => {
  const { m, p } = setup();
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: ++calls === 1 ? '' : 'agora sim' } }] }));
  m.start(p, 'x');
  assert.equal((await m.next(p))?.text, 'agora sim');
  assert.equal(calls, 2);
});

test('chamada: modelo principal falha → a fala sai pelo modelo reserva (a chamada não fica muda)', async () => {
  const { m, p } = setup();
  const models: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body); models.push(b.model);
    if (models.length <= 2) return new Response('{"error":"429"}', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'voltei pelo reserva' } }] }));
  };
  m.start(p, 'x');
  assert.equal((await m.next(p))?.text, 'voltei pelo reserva');
  assert.deepEqual(models, ['nvidia/x', 'nvidia/x', FALLBACK_MODEL], 'Kimi 2 vezes, depois a reserva');
});

test('chamada: anexos — texto entra direto, imagem vira descrição, tudo vai para os agentes e fica na ata', async () => {
  const { m, p, vault } = setup();
  const sent: { model: string; content: unknown }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    sent.push({ model: b.model, content: b.messages.at(-1).content });
    const vision = Array.isArray(b.messages[0].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: vision ? 'Print com erro 500 no /login.' : 'Vi o anexo.' } }] }));
  };
  m.start(p, 'olhem isso');
  await m.attach(p, 'erro.log', 'text/plain', Buffer.from('TypeError: x is undefined\ntoken=abcdefghijklmnop123456'));
  const s = await m.attach(p, 'tela.png', 'image/png', Buffer.from([137, 80, 78, 71]));
  assert.deepEqual(s.attachments?.map((a) => [a.name, a.kind]), [['erro.log', 'arquivo'], ['tela.png', 'imagem']]);
  assert.equal(s.attachments?.[0].text, '', 'texto do anexo não vai para o app');
  assert.equal(sent[0].model, VISION_MODEL, 'imagem descrita pelo modelo com visão');
  await m.next(p);
  const prompt = String(sent.at(-1)!.content);
  assert.match(prompt, /Print com erro 500 no \/login/);
  assert.match(prompt, /TypeError: x is undefined/);
  assert.doesNotMatch(prompt, /abcdefghijklmnop123456/, 'segredo do anexo mascarado');
  const ata = readFileSync(path.join(vault, '20-Operations', 'Calls', readdirSync(path.join(vault, '20-Operations', 'Calls')).find((f) => f.endsWith('.md'))!), 'utf8');
  assert.match(ata, /\*\*DONO\*\* anexou \[\[CALL-.+-anexos\/tela\.png\]\] \(imagem\): _Print com erro 500/);
  await assert.rejects(m.attach(p, 'virus.exe', 'application/octet-stream', Buffer.from('MZ')), /tipo não suportado/);
  await assert.rejects(m.attach(p, 'grande.txt', 'text/plain', Buffer.alloc(MAX_ATTACH_BYTES + 1)), /maior que 5 MB/);

  // o log gravado no vault já sai sem o segredo; imagem falsa é recusada; ".." e nome repetido não estragam nada
  const calls = path.join(vault, '20-Operations', 'Calls');
  const dir = path.join(calls, readdirSync(calls).find((f) => f.endsWith('-anexos'))!);
  assert.doesNotMatch(readFileSync(path.join(dir, 'erro.log'), 'utf8'), /abcdefghijklmnop123456/, 'segredo não fica no vault');
  await assert.rejects(m.attach(p, 'x.png', 'image/png', Buffer.from('<svg onload=1>')), /não é png/);
  const dots = await m.attach(p, '..', 'text/plain', Buffer.from('oi'));
  assert.equal(dots.attachments!.at(-1)!.name, 'anexo');
  const again = await m.attach(p, 'erro.log', 'text/plain', Buffer.from('outro'));
  assert.equal(again.attachments!.at(-1)!.name, '2-erro.log');
  assert.match(readFileSync(path.join(dir, 'erro.log'), 'utf8'), /TypeError/, 'o primeiro erro.log continua lá');
});
test('chamada: escolher quem entra e o modo; tocar no agente passa a vez; fim gera resumo com tarefas', async () => {
  const { m, p, vault } = setup();
  const c = m.start(p, 'plano da beta', ['qwen'], 'brainstorm');
  assert.deepEqual(c.participants.map((x) => x.id), ['QWEN']);
  assert.equal(c.modo, 'brainstorm');
  assert.throws(() => m.start(p, 'x', ['NINGUEM']), /pelo menos um agente/);
  const d = m.start(p, 'plano da beta');
  assert.equal(d.participants.length, 2);
  m.passTurn(p, 'qwen');
  assert.equal((await m.next(p))?.speaker, 'QWEN', 'tocou no QWEN, ele fala');
  assert.throws(() => m.passTurn(p, 'CHATGPT'), /não está na chamada/);
  await m.next(p);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Aqui: {"decisoes":["Beta sai sexta"],"tarefas":[{"agente":"hermes","tarefa":"rodar os testes de segurança"},{"agente":"HACKER","tarefa":"x"}],"pendencias":["login do Droid"]}' } }] }));
  m.end(p);
  await new Promise((r) => setTimeout(r, 20));
  const s = m.get(p.id)!.resumo!;
  assert.equal(s.status, 'ok');
  assert.deepEqual(s.tarefas, [{ agente: 'HERMES', tarefa: 'rodar os testes de segurança' }], 'agente fora da chamada é descartado');
  const files = readdirSync(path.join(vault, '20-Operations', 'Calls')).filter((f) => f.endsWith('.md'));
  const ata = files.map((f) => readFileSync(path.join(vault, '20-Operations', 'Calls', f), 'utf8')).join('\n');
  assert.match(ata, /## Resumo da chamada[\s\S]*- \[ \] \*\*HERMES\*\*: rodar os testes de segurança/);
});
test('chamada: especialistas virtuais entram quando escolhidos; "Rodada" faz todos opinarem na ordem', async () => {
  const { m, p, vault, prompts } = setup();
  writeFileSync(path.join(vault, '10-Agents', 'Time', 'QA.md'), '---\npapel: QA / testes e qualidade\n---\n');
  const d = m.start(p, 'sem escolha');
  assert.ok(!d.participants.some((x) => x.id === 'QA'), 'sem escolha: só o time');
  const c = m.start(p, 'revisão do app', ['HERMES', 'QA', 'DESIGNER']);
  assert.deepEqual(c.participants.map((x) => x.id), ['HERMES', 'DESIGNER', 'QA'], 'time primeiro, depois especialistas na ordem fixa');
  assert.equal(c.participants[2].papel, 'QA / testes e qualidade');
  m.roundAll(p);
  const falas = [await m.next(p), await m.next(p), await m.next(p)].map((t) => t?.speaker);
  assert.deepEqual(falas, ['HERMES', 'DESIGNER', 'QA'], 'rodada: cada um uma vez, na ordem');
  assert.match(prompts.at(-1)!, /especialista VIRTUAL/);
});
test('chamada: expulsar tira o agente, a ata registra e ele não fala mais; sem ninguém, espera o usuário', async () => {
  const { m, p } = setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'oi' } }] }));
  const c = m.start(p, 'x');
  const first = c.participants[0].id;
  const after = m.leave(p, first.toLowerCase());
  assert.ok(!after.participants.some((x) => x.id === first));
  assert.match(after.turns.at(-1)!.text, new RegExp(`${first} saiu da chamada [(]expulso`));
  assert.equal(after.turns.at(-1)!.speaker, 'JARVIS');
  for (let i = 0; i < 4; i++) assert.notEqual((await m.next(p))?.speaker, first);
  assert.throws(() => m.leave(p, first), /não está na chamada/);
  for (const x of m.get(p.id)!.participants) m.leave(p, x.id);
  assert.equal(m.get(p.id)!.status, 'AGUARDANDO_DONO');
  assert.equal(await m.next(p), null);
  assert.ok(readFileSync(m.get(p.id)!.file, 'utf8').includes('saiu da chamada'));
});

test('chamada: acabaram os tokens do agente → ele sai sozinho e a conversa segue', async () => {
  assert.equal(isQuotaError(402, ''), true);
  assert.equal(isQuotaError(429, '{"error":"insufficient_quota"}'), true);
  assert.equal(isQuotaError(429, '{"error":"rate limited, slow down"}'), false, '429 de pressa não é falta de tokens');
  assert.equal(isQuotaError(500, 'quota'), false);
  const { m, p } = setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m as any).fetchImpl = async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 });
  const c = m.start(p, 'x');
  const n = c.participants.length;
  const t1 = await m.next(p);
  assert.equal(t1?.speaker, 'JARVIS');
  assert.match(t1!.text, /saiu da chamada \(acabaram os tokens\)/);
  assert.equal(m.get(p.id)!.participants.length, n - 1);
});
