// Modo Prédio: roupas sorteadas, caminho pelo elevador e a simulação das cabines (sem navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, route, createElevators, ELEV } from '../public/predio.js';

test('chefe usa terno e gravata vermelha; o time usa roupa comum, sempre a mesma pelo nome', () => {
  const boss = lookFor('VOCÊ', true);
  assert.equal(boss.top, 'terno');
  assert.equal(boss.tie, '#DC2626');
  const a = lookFor('CODEX'), b = lookFor('CODEX');
  assert.deepEqual(a, b);
  assert.ok(['camiseta', 'listrada', 'moletom', 'polo'].includes(a.top));
  assert.ok(['nenhum', 'oculos', 'fone', 'barba'].includes(a.acc));
  assert.notDeepEqual(lookFor('CODEX', false, 1), a, 'o dado sorteia outra roupa');
});

// andares mínimos para o route(): só as salas que ele usa
const lobby = { name: 'Elevadores', x0: 940, x1: 1170, y0: 410, y1: 690, top: false, lobby: true, door: { x: 985, y: 410 }, spots: [] };
const sala = { name: 'Sala', x0: 30, x1: 320, y0: 30, y1: 310, top: true, door: { x: 175, y: 310 }, spots: [] };
const floors = [0, 1, 2].map(() => ({ rooms: [sala, lobby] }));

test('trocar de andar passa pela sala do elevador e termina pedindo o elevador', () => {
  const path = route(floors, { floor: 2, x: 175, y: 120 }, { floor: 0, x: 175, y: 120 });
  const last = path.at(-1);
  assert.equal(last.elevator, true);
  assert.equal(last.to, 0);
  assert.ok(path.at(-2).wait, 'antes do elevador fica numa marca de espera');
  assert.ok(path.every((n) => n.floor === 2 || n.elevator), 'até entrar na cabine fica no andar de saída');
  assert.ok(!path.some((n) => n.jump), 'ninguém mais teletransporta pela escada');
});

test('no mesmo andar não chama elevador', () => {
  const path = route(floors, { floor: 1, x: 175, y: 120 }, { floor: 1, x: 1096, y: 600 });
  assert.ok(!path.some((n) => n.elevator || n.wait));
  assert.deepEqual(path.at(-1), { floor: 1, x: 1096, y: 600 });
});

test('quem já está na sala do elevador vai direto para a marca', () => {
  const path = route(floors, { floor: 0, x: 1040, y: 560 }, { floor: 2, x: 175, y: 120 });
  assert.equal(path.length, 2);
  assert.ok(path[0].wait && path[1].elevator);
});

const run = (e, secs, every) => { for (let i = 0; i < secs * 20; i++) { every?.(); e.step(0.05); } };
// quem espera aperta o botão até uma cabine abrir com lugar (como no app)
const waitOpen = (e, f, secs = 10) => { for (let i = 0; i < secs * 20; i++) { e.call(f); const c = e.openAt(f); if (c) return c; e.step(0.05); } return null; };

test('chamada: a cabine vem, abre, fecha e volta a ficar parada', () => {
  const e = createElevators(4);
  e.call(3);
  let opened = false;
  run(e, 15, () => { if (e.cars.some((c) => c.state === 'open' && Math.round(c.pos) === 3)) opened = true; });
  assert.ok(opened, 'alguma cabine abriu no 3º');
  assert.equal(e.calls.size, 0);
  assert.ok(e.cars.every((c) => c.state === 'idle' && c.door === 0));
});

test('quem entra é levado ao andar pedido e o visor passa pelos andares do meio', () => {
  const e = createElevators(4);
  const c = waitOpen(e, 0);
  assert.ok(c, 'a cabine do térreo abriu');
  c.riders.push({ o: { id: 'X' }, to: 3 }); c.stops.add(3);
  const seen = new Set();
  let arrived = false;
  run(e, 20, () => { seen.add(Math.round(c.pos)); if (e.arrivedAt(c) === 3) arrived = true; });
  assert.ok(arrived);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test('cabine cheia não abre de novo para quem ficou: a outra cabine vem buscar', () => {
  const e = createElevators(3);
  const a = e.cars[0];
  assert.equal(waitOpen(e, 0), a, 'a cabine que já estava no térreo abre');
  for (let i = 0; i < ELEV.cap; i++) a.riders.push({ o: { id: `P${i}` }, to: 2 });
  a.stops.add(2);
  assert.equal(e.openAt(0), null, 'cheia não aceita mais ninguém');
  let other = false;
  run(e, 20, () => { e.call(0); if (e.cars[1].state === 'open' && Math.round(e.cars[1].pos) === 0) other = true; });
  assert.ok(other, 'a segunda cabine veio ao térreo');
});

test('menos andares: cabine e chamadas acima do topo somem', () => {
  const e = createElevators(5);
  e.cars[1].pos = 4; e.call(4);
  e.setFloors(3);
  assert.ok(e.cars.every((c) => c.pos <= 2));
  assert.equal(e.calls.has(4), false);
});

// ---------- personagem: editor e foto ----------
import { analyzePhoto, FACE, lookFromSaved, savedFromLook } from '../public/predio.js';

/** Foto de mentira: fundo, cabelo (em cima e, se comprido, dos lados), rosto oval com a pele. */
function fakePhoto({ n = 160, bg = [40, 120, 200], skin = [200, 150, 110], hair = [40, 25, 15], long = false, bald = false } = {}) {
  const px = new Uint8ClampedArray(n * n * 4);
  const cx = n * FACE.cx, cy = n * FACE.cy, rx = n * FACE.rx, ry = n * FACE.ry;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ex = (x - cx) / rx, ey = (y - cy) / ry, e = Math.hypot(ex, ey);
    let c = bg;
    if (!bald && ey < -0.3 && e < 1.3) c = hair; // topo da cabeça
    if (long && Math.abs(ex) > 0.85 && Math.abs(ex) < 1.35 && ey > -0.5 && ey < 1.3) c = hair; // dos lados até os ombros
    if (e < 1 && (bald || ey > -0.7)) c = skin;
    if (bald && ey < -0.3 && e < 1.15) c = skin;
    const i = (y * n + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return [px, n];
}
const close = (hex, rgb) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return v.every((x, k) => Math.abs(x - rgb[k]) <= 6); };

test('foto: tira a cor da pele e do cabelo; cabelo curto não vira comprido', () => {
  const r = analyzePhoto(...fakePhoto());
  assert.ok(close(r.skin, [200, 150, 110]), r.skin);
  assert.ok(close(r.hair, [40, 25, 15]), r.hair);
  assert.equal(r.style, null);
});

test('foto: percebe cabelo comprido e careca', () => {
  assert.equal(analyzePhoto(...fakePhoto({ long: true })).style, 'longo');
  const bald = analyzePhoto(...fakePhoto({ bald: true }));
  assert.equal(bald.style, 'careca');
  assert.equal(bald.hair, null);
});

test('personagem salvo ida e volta: terno vira paletó com camisa branca e gravata vermelha', () => {
  const s = { skin: '#8D5A3B', hair: '#1F1A17', style: 'curto', top: 'terno', shirt: '#0F172A', pants: '#1E293B', shoes: '#111111', cap: '#EF4444', acc: 'oculos' };
  const L = lookFromSaved(s);
  assert.equal(L.jacket, '#0F172A'); assert.equal(L.shirt, '#F4F4F5'); assert.equal(L.tie, '#DC2626'); assert.equal(L.boss, true);
  assert.deepEqual(savedFromLook(L), s);
  const w = { ...s, top: 'moletom', shirt: '#22C55E' };
  assert.deepEqual(savedFromLook(lookFromSaved(w)), w);
});
