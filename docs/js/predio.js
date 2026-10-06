// Modo Prédio: cada agente vira um bonequinho que anda pelos andares do escritório.
// Cada tela é um andar (Térreo, Diretoria e os andares do time). O chefe (você) usa terno com gravata vermelha;
// os agentes usam roupa comum (camiseta, calça e tênis) sorteada pelo nome. Onde cada um vai depende do estado real:
// trabalhando → mesa; travado ou esperando aprovação → sala do chefe; terminou → copa; parado → descanso;
// na chamada → sala de reunião. Só canvas e textContent: nada que vem dos agentes vira HTML.

const W = 1200, H = 720;
const CORR = { y0: 310, y1: 410 };
const TOP = [[30, 320], [320, 610], [610, 890], [890, 1170]];
const BOTTOM = [[30, 330], [330, 640], [640, 940]];
const LOBBY = { x0: 940, x1: 1170, y0: 410, y1: 690 };
const PER_FLOOR = 8; // 4 salas × 2 mesas
const SPEED = 95; // px/s no mundo

// ---------- elevador ----------
// Dois elevadores na sala do canto de cada andar (no lugar da escada). As portas ficam na parede do fundo da sala,
// viradas para quem olha; dentro da cabine cabem 4. Quem troca de andar chama, espera na marca, entra e sai no andar certo.
export const ELEV = {
  cars: [1060, 1132], // centro de cada porta (x)
  doorHalf: 30, block: { x0: 1024, x1: 1168, y0: 408, y1: 506 }, doorTop: 430, cabY: 503,
  cap: 4, speed: 0.75, // andares por segundo
  doorTime: 0.55, hold: 1.6,
  slots: [[-14, 0], [14, 0], [-4, -1], [6, -1]], // onde cada um fica dentro da cabine
  wait: [[1040, 552], [1078, 556], [1114, 552], [1152, 556], [1058, 592], [1096, 596], [1134, 592], [1020, 600]],
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

/**
 * Simulação dos elevadores, sem desenho (dá para testar no Node). Cada cabine: idle (parada, porta fechada) →
 * opening → open → closing → idle, ou moving entre andares. Chamadas do hall ficam em `calls` até uma cabine abrir ali.
 */
export function createElevators(nFloors, xs = ELEV.cars) {
  const cars = xs.map((x, i) => ({ i, x, pos: Math.min(i, nFloors - 1), dir: 0, state: 'idle', door: 0, timer: 0, stops: new Set(), riders: [], boarding: new Set() }));
  const calls = new Set();
  const at = (c) => Math.round(c.pos);
  const full = (c) => c.riders.length + c.boarding.size >= ELEV.cap;
  const covers = (c, f) => c.stops.has(f) || (at(c) === f && near(c.pos, f) && c.state !== 'idle' && c.state !== 'moving' && !full(c));
  const api = {
    cars, calls,
    get floors() { return nFloors; },
    setFloors(n) { nFloors = n; for (const c of cars) { if (c.pos > n - 1) { c.pos = n - 1; c.state = 'idle'; c.door = 0; } for (const f of [...c.stops]) if (f >= n) c.stops.delete(f); } for (const f of [...calls]) if (f >= n) calls.delete(f); },
    /** Alguém apertou o botão no andar `f`. Se a porta estiver fechando ali e ainda couber gente, ela abre de novo. */
    call(f) {
      if (f < 0 || f >= nFloors) return;
      calls.add(f);
      for (const c of cars) if (c.state === 'closing' && at(c) === f && near(c.pos, f) && !full(c)) { c.state = 'opening'; }
    },
    /** Cabine aberta neste andar com lugar sobrando (para quem está esperando entrar). */
    openAt(f) { return cars.find((c) => c.state === 'open' && at(c) === f && near(c.pos, f) && !full(c)) ?? null; },
    /** Cabine aberta neste andar (para quem está dentro sair). */
    arrivedAt(c) { return c.state === 'open' && near(c.pos, at(c)) ? at(c) : -1; },
    step(dt) {
      // quem atende cada chamada: a cabine parada mais perto; senão uma que já vem nessa direção
      for (const f of calls) {
        if (cars.some((c) => covers(c, f))) continue;
        const free = cars.filter((c) => !full(c));
        const idle = free.filter((c) => c.state === 'idle' && c.stops.size === 0).sort((a, b) => Math.abs(a.pos - f) - Math.abs(b.pos - f));
        const coming = free.filter((c) => c.state === 'moving' && Math.sign(f - c.pos) === c.dir).sort((a, b) => Math.abs(a.pos - f) - Math.abs(b.pos - f));
        const c = idle[0] ?? coming[0];
        if (c) c.stops.add(f);
      }
      for (const c of cars) {
        switch (c.state) {
          case 'idle': {
            if (!c.stops.size) { c.dir = 0; break; }
            const here = at(c);
            if (c.stops.has(here)) { c.state = 'opening'; break; }
            const list = [...c.stops];
            const ahead = c.dir ? list.filter((f) => Math.sign(f - c.pos) === c.dir) : [];
            const pool = ahead.length ? ahead : list;
            const next = pool.sort((a, b) => Math.abs(a - c.pos) - Math.abs(b - c.pos))[0];
            c.dir = Math.sign(next - c.pos);
            c.state = 'moving';
            break;
          }
          case 'moving': {
            const target = c.dir > 0 ? Math.floor(c.pos + 1e-6) + 1 : Math.ceil(c.pos - 1e-6) - 1;
            c.pos += c.dir * ELEV.speed * dt;
            if ((c.dir > 0 && c.pos >= target - 1e-6) || (c.dir < 0 && c.pos <= target + 1e-6) || target < 0 || target > nFloors - 1) {
              const f = Math.max(0, Math.min(nFloors - 1, target));
              const claim = calls.has(f) && !full(c) && !cars.some((o) => o !== c && o.stops.has(f));
              if (c.stops.has(f) || claim || f === 0 || f === nFloors - 1) {
                c.pos = f;
                c.state = c.stops.has(f) || claim ? 'opening' : 'idle';
              }
            }
            break;
          }
          case 'opening':
            c.door = Math.min(1, c.door + dt / ELEV.doorTime);
            if (c.door >= 1) { c.state = 'open'; c.timer = ELEV.hold; c.stops.delete(at(c)); calls.delete(at(c)); }
            break;
          case 'open':
            c.timer -= dt;
            if (c.boarding.size) c.timer = Math.max(c.timer, 0.5);
            if (c.timer <= 0) c.state = 'closing';
            break;
          case 'closing':
            c.door = Math.max(0, c.door - dt / ELEV.doorTime);
            if (c.door <= 0) c.state = 'idle';
            break;
        }
      }
    },
  };
  return api;
}

// ---------- sorteio estável pelo nome ----------
function seedOf(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

const SKIN = ['#F5D0B5', '#E8B894', '#D49A6A', '#B97A4F', '#8D5A3B', '#6B4026'];
const HAIR = ['#1F1A17', '#3B2A20', '#6B4423', '#A0522D', '#D6B370', '#E5E5E5', '#B45309', '#7C3AED'];
const SHIRT = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#F4F4F5', '#27272A', '#0EA5E9'];
const PANTS = ['#1E3A8A', '#1E40AF', '#27272A', '#52525B', '#A16207', '#3F3F46', '#334155'];
const SHOES = ['#F4F4F5', '#EF4444', '#22C55E', '#3B82F6', '#111111', '#F97316', '#A855F7'];
const HAIRSTYLE = ['curto', 'longo', 'careca', 'bone', 'coque', 'topete', 'cacheado', 'rabo'];
const TOPS = ['camiseta', 'camiseta', 'listrada', 'moletom', 'polo'];
const ACC = ['nenhum', 'nenhum', 'nenhum', 'nenhum', 'nenhum', 'oculos', 'oculos', 'fone', 'barba', 'barba'];

export function lookFor(name, boss = false, salt = 0) {
  const r = rng(seedOf(name) + salt * 7919);
  if (boss) return { boss: true, skin: pick(r, SKIN), hair: pick(r, HAIR.slice(0, 6)), style: pick(r, ['curto', 'topete', 'careca']), top: 'terno', shirt: '#F4F4F5', jacket: '#1E293B', pants: '#1E293B', shoes: '#111111', tie: '#DC2626', acc: 'nenhum' };
  return { boss: false, skin: pick(r, SKIN), hair: pick(r, HAIR), style: pick(r, HAIRSTYLE), shirt: pick(r, SHIRT), pants: pick(r, PANTS), shoes: pick(r, SHOES), cap: pick(r, SHIRT), top: pick(r, TOPS), acc: pick(r, ACC) };
}

// ---------- estado do agente → lugar ----------
export function moodOf(a, now = Date.now()) {
  const st = String(a?.latest?.status ?? '').toUpperCase();
  if (/^(BLOCKED|FAILED|AWAITING|VIOLATION|NEEDS)/.test(st)) return 'travado';
  if (/^(WORKING|ACK)/.test(st)) return 'trabalhando';
  if (/^(REVIEW|QUEUED|ASSIGNED)/.test(st)) return 'revisando';
  const ts = a?.latest?.ts ? new Date(a.latest.ts).getTime() : 0;
  if (/^DONE/.test(st)) return ts && now - ts > 6 * 3600_000 ? 'parado' : 'terminou';
  return 'parado';
}

// ---------- andares ----------
function room(name, x0, x1, top, extra = {}) {
  const [y0, y1] = top ? [30, CORR.y0] : [CORR.y1, 690];
  return { name, x0, x1, y0, y1, top, door: { x: (x0 + x1) / 2, y: top ? CORR.y0 : CORR.y1 }, spots: [], furniture: [], ...extra };
}
function seats(r, n, rowY) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: r.x0 + ((i + 1) * (r.x1 - r.x0)) / (n + 1), y: rowY });
  return out;
}

function makeFloor(kind, n) {
  const f = { kind, n, rooms: [] };
  // sala dos elevadores (mesmo canto em todo andar): porta do corredor à esquerda, elevadores na parede do fundo
  const lobby = { name: 'Elevadores', ...LOBBY, top: false, door: { x: 985, y: CORR.y1 }, spots: [], lobby: true,
    furniture: [{ t: 'tapete', x: 1096, y: 574, w: 160, h: 74, c: '#334155' }, { t: 'banco', x: 1010, y: 660 }, { t: 'planta', x: 1148, y: 660 }, { t: 'planta', x: 962, y: 462 }] };
  if (kind === 'terreo') {
    f.name = 'Térreo';
    const rec = room('Recepção', ...TOP[0], true); rec.furniture.push({ t: 'balcao', x: 175, y: 150 }, { t: 'planta', x: 60, y: 60 }, { t: 'planta', x: 290, y: 60 });
    rec.spots = [{ x: 175, y: 210 }, { x: 120, y: 250 }, { x: 230, y: 250 }];
    const copa = room('Copa', ...TOP[1], true); copa.furniture.push({ t: 'cafe', x: 360, y: 70 }, { t: 'geladeira', x: 570, y: 80 }, { t: 'mesa', x: 465, y: 190, w: 140, h: 60 });
    copa.spots = [{ x: 410, y: 175 }, { x: 520, y: 175 }, { x: 410, y: 265 }, { x: 520, y: 265 }, { x: 365, y: 120 }];
    copa.idle = true;
    const desc = room('Descanso', ...TOP[2], true); desc.furniture.push({ t: 'sofa', x: 750, y: 90, w: 190 }, { t: 'sofa', x: 750, y: 240, w: 190 }, { t: 'tv', x: 750, y: 40 }, { t: 'planta', x: 860, y: 280 });
    desc.spots = [{ x: 690, y: 115, sit: 1 }, { x: 750, y: 115, sit: 1 }, { x: 810, y: 115, sit: 1 }, { x: 690, y: 265, sit: 1 }, { x: 750, y: 265, sit: 1 }, { x: 810, y: 265, sit: 1 }];
    desc.idle = true; desc.sleep = true;
    const jogos = room('Jogos', ...TOP[3], true); jogos.furniture.push({ t: 'pingpong', x: 1030, y: 160 }, { t: 'fliperama', x: 1130, y: 80 });
    jogos.spots = [{ x: 935, y: 160 }, { x: 1125, y: 160 }, { x: 1120, y: 120 }];
    jogos.idle = true;
    const jardim = room('Jardim', ...BOTTOM[0], false); jardim.furniture.push({ t: 'arvore', x: 90, y: 520 }, { t: 'arvore', x: 270, y: 610 }, { t: 'banco', x: 180, y: 520 }, { t: 'planta', x: 60, y: 660 });
    jardim.spots = [{ x: 155, y: 545, sit: 1 }, { x: 205, y: 545, sit: 1 }, { x: 180, y: 640 }];
    jardim.idle = true; jardim.green = true;
    const banh = room('Banheiros', ...BOTTOM[1], false); banh.furniture.push({ t: 'pia', x: 400, y: 660 }, { t: 'pia', x: 470, y: 660 }, { t: 'cabine', x: 560, y: 470 }, { t: 'cabine', x: 610, y: 470 });
    banh.spots = [{ x: 400, y: 620 }, { x: 470, y: 620 }];
    const corr = room('Correio', ...BOTTOM[2], false); corr.furniture.push({ t: 'estante', x: 700, y: 470 }, { t: 'estante', x: 880, y: 470 }, { t: 'caixas', x: 790, y: 640 });
    corr.spots = [{ x: 760, y: 560 }, { x: 830, y: 560 }];
    // decoração: tapetes, letreiro, aquário, máquina de lanche, luminárias, flores e quadros
    rec.furniture.push({ t: 'tapete', x: 175, y: 215, w: 210, h: 90, c: '#7C2D12' }, { t: 'letreiro', x: 175, y: 44 }, { t: 'aquario', x: 75, y: 250 });
    copa.furniture.push({ t: 'vending', x: 430, y: 72 }, { t: 'bebedouro', x: 505, y: 66 }, { t: 'tapete', x: 465, y: 220, w: 200, h: 120, c: '#78350F' });
    desc.furniture.push({ t: 'tapete', x: 750, y: 175, w: 230, h: 200, c: '#3B0764' }, { t: 'luminaria', x: 650, y: 180 }, { t: 'arte', x: 860, y: 40, c: '#F472B6' });
    jogos.furniture.push({ t: 'tapete', x: 1030, y: 160, w: 200, h: 120, c: '#1E3A8A' }, { t: 'arte', x: 950, y: 40, c: '#22D3EE' });
    jardim.furniture.push({ t: 'flores', x: 120, y: 610 }, { t: 'flores', x: 250, y: 470 }, { t: 'flores', x: 300, y: 520 });
    corr.furniture.push({ t: 'arte', x: 790, y: 680, c: '#FACC15' });
    // datas do ano: abóboras em outubro, bandeirinhas em junho/julho, árvore em dezembro
    const mes = new Date().getMonth() + 1;
    if (mes === 10) rec.furniture.push({ t: 'abobora', x: 110, y: 120 }, { t: 'abobora', x: 245, y: 120 });
    if (mes === 12) rec.furniture.push({ t: 'arvoreNatal', x: 290, y: 235 });
    f.rooms = [rec, copa, desc, jogos, jardim, banh, corr, lobby];
  } else if (kind === 'diretoria') {
    f.name = '1º andar · Diretoria';
    const chefe = room('Sala do chefe', ...TOP[0], true); chefe.furniture.push({ t: 'mesaChefe', x: 175, y: 110 }, { t: 'quadro', x: 175, y: 38 }, { t: 'planta', x: 55, y: 60 }, { t: 'planta', x: 295, y: 60 });
    chefe.boss = { x: 175, y: 92 };
    chefe.spots = [{ x: 115, y: 215 }, { x: 175, y: 225 }, { x: 235, y: 215 }, { x: 85, y: 270 }, { x: 265, y: 270 }];
    chefe.queue = true;
    const reun = room('Reunião', TOP[1][0], TOP[2][1], true); reun.furniture.push({ t: 'mesa', x: 605, y: 165, w: 380, h: 80 }, { t: 'telao', x: 605, y: 40 });
    reun.spots = [...seats({ x0: 415, x1: 795 }, 5, 112), ...seats({ x0: 415, x1: 795 }, 5, 232)].map((s) => ({ ...s, sit: 1 }));
    reun.head = { x: 380, y: 170 };
    reun.meeting = true;
    const aprov = room('Aprovações', ...TOP[3], true); aprov.furniture.push({ t: 'painel', x: 1030, y: 45 }, { t: 'mesa', x: 1030, y: 190, w: 120, h: 50 });
    aprov.spots = [{ x: 975, y: 260 }, { x: 1085, y: 260 }];
    aprov.board = true;
    const sec = room('Secretaria', ...BOTTOM[0], false); sec.furniture.push({ t: 'mesa', x: 180, y: 540, w: 150, h: 50 }, { t: 'arquivo', x: 60, y: 470 }, { t: 'arquivo', x: 300, y: 470 });
    sec.spots = [{ x: 180, y: 600 }];
    const lounge = room('Lounge', ...BOTTOM[1], false); lounge.furniture.push({ t: 'sofa', x: 485, y: 520, w: 200 }, { t: 'cafe', x: 600, y: 660 }, { t: 'planta', x: 360, y: 660 });
    lounge.spots = [{ x: 425, y: 545, sit: 1 }, { x: 485, y: 545, sit: 1 }, { x: 545, y: 545, sit: 1 }];
    lounge.idle = true;
    const arq = room('Arquivo', ...BOTTOM[2], false); arq.furniture.push({ t: 'estante', x: 690, y: 470 }, { t: 'estante', x: 790, y: 470 }, { t: 'estante', x: 890, y: 470 });
    arq.spots = [{ x: 790, y: 600 }];
    chefe.furniture.push({ t: 'tapete', x: 175, y: 160, w: 230, h: 120, c: '#7F1D1D' }, { t: 'trofeus', x: 60, y: 165 }, { t: 'luminaria', x: 290, y: 170 });
    reun.furniture.push({ t: 'tapete', x: 605, y: 172, w: 430, h: 170, c: '#1E293B' }, { t: 'luminaria', x: 410, y: 60 }, { t: 'luminaria', x: 800, y: 60 });
    aprov.furniture.push({ t: 'planta', x: 1140, y: 280 }, { t: 'tapete', x: 1030, y: 225, w: 180, h: 90, c: '#14532D' });
    lounge.furniture.push({ t: 'tapete', x: 485, y: 560, w: 230, h: 90, c: '#4C1D95' }, { t: 'arte', x: 390, y: 428, c: '#FB923C' });
    sec.furniture.push({ t: 'arte', x: 180, y: 428, c: '#60A5FA' });
    f.rooms = [chefe, reun, aprov, sec, lounge, arq, lobby];
  } else {
    f.name = `${n}º andar · Time`;
    const offices = TOP.map(([a, b], i) => {
      const r = room(`Sala ${n}${String.fromCharCode(65 + i)}`, a, b, true);
      const desks = seats(r, 2, 120);
      for (const d of desks) r.furniture.push({ t: 'mesaPc', x: d.x, y: d.y + 12 });
      r.furniture.push({ t: 'planta', x: b - 25, y: 55 }, { t: 'tapete', x: (a + b) / 2, y: 205, w: b - a - 70, h: 70, c: ['#1E3A8A', '#14532D', '#7C2D12', '#4C1D95'][i] }, { t: 'arte', x: a + 34, y: 40, c: ['#F472B6', '#22D3EE', '#FACC15', '#A3E635'][i] }, { t: 'quadroTarefas', x: (a + b) / 2, y: 44 });
      r.office = true;
      r.desks = desks.map((d) => ({ ...d, sit: 1 }));
      r.spots = [{ x: (a + b) / 2, y: 260 }];
      return r;
    });
    const copa = room(`Copa ${n}`, ...BOTTOM[0], false); copa.furniture.push({ t: 'cafe', x: 70, y: 660 }, { t: 'mesa', x: 190, y: 540, w: 120, h: 55 }, { t: 'geladeira', x: 300, y: 650 });
    copa.spots = [{ x: 150, y: 530 }, { x: 230, y: 530 }, { x: 75, y: 615 }];
    copa.idle = true;
    const foco = room('Sala de foco', ...BOTTOM[1], false); foco.furniture.push({ t: 'mesaPc', x: 420, y: 542 }, { t: 'mesaPc', x: 550, y: 542 }, { t: 'quadroBranco', x: 485, y: 428 });
    foco.spots = [{ x: 420, y: 530, sit: 1 }, { x: 550, y: 530, sit: 1 }];
    const imp = room('Impressora', ...BOTTOM[2], false); imp.furniture.push({ t: 'impressora', x: 700, y: 470 }, { t: 'arquivo', x: 900, y: 470 }, { t: 'planta', x: 670, y: 665 });
    imp.spots = [{ x: 700, y: 530 }];
    copa.furniture.push({ t: 'vending', x: 240, y: 655 }, { t: 'tapete', x: 190, y: 545, w: 170, h: 100, c: '#78350F' });
    foco.furniture.push({ t: 'luminaria', x: 370, y: 640 }, { t: 'luminaria', x: 600, y: 640 });
    f.rooms = [...offices, copa, foco, imp, lobby];
  }
  return f;
}

function roomAt(f, x, y) { return f.rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) ?? null; }
const inside = (r) => ({ x: r.door.x, y: r.top ? r.door.y - 26 : r.door.y + 26 });
// na sala do elevador dá a volta pela frente dos elevadores, sem passar por cima das portas
const LOBBY_PASS = { x: 995, y: 530 };
const leave = (f, r, lane) => [...(r.lobby ? [{ floor: f, ...LOBBY_PASS }] : []), { floor: f, ...inside(r) }, { floor: f, ...corridorAt(r.door.x, lane) }];
const enter = (f, r, lane) => [{ floor: f, ...corridorAt(r.door.x, lane) }, { floor: f, ...inside(r) }, ...(r.lobby ? [{ floor: f, ...LOBBY_PASS }] : [])];
const corridorAt = (x, lane) => ({ x, y: (CORR.y0 + CORR.y1) / 2 + lane });

/**
 * Caminho de um ponto a outro: porta, corredor e, se mudar de andar, a sala dos elevadores. Lá o caminho tem uma
 * marca de espera (`wait`) e o pedido de elevador (`elevator`); depois de sair da cabine o resto é refeito no andar novo.
 */
export function route(floors, from, to, lane = 0) {
  const pts = [];
  const fa = floors[from.floor], fb = floors[to.floor];
  const ra = fa && roomAt(fa, from.x, from.y), rb = fb && roomAt(fb, to.x, to.y);
  if (!fa || !fb) return [{ ...to }];
  const sameRoom = from.floor === to.floor && ra && ra === rb;
  if (!sameRoom) {
    if (from.floor !== to.floor) {
      const la = fa.rooms.find((r) => r.lobby);
      if (ra !== la) {
        if (ra) pts.push(...leave(from.floor, ra, lane));
        pts.push(...enter(from.floor, la, lane));
      }
      pts.push({ floor: from.floor, x: ELEV.wait[0][0], y: ELEV.wait[0][1], wait: true }, { floor: from.floor, elevator: true, to: to.floor });
      return pts; // o resto é calculado quando sair da cabine
    }
    if (ra) pts.push(...leave(from.floor, ra, lane));
    if (rb) pts.push(...enter(to.floor, rb, lane));
  }
  pts.push({ floor: to.floor, x: to.x, y: to.y });
  return pts;
}

// ---------- desenho ----------
const STATUS_COLOR = { trabalhando: '#22C55E', revisando: '#F59E0B', travado: '#EF4444', terminou: '#38BDF8', parado: '#71717A', chefe: '#DC2626', chamada: '#F97316' };
const STATUS_LABEL = { trabalhando: 'trabalhando', revisando: 'revisando', travado: 'travado / esperando você', terminou: 'terminou', parado: 'parado', chefe: 'chefe (você)', chamada: 'na chamada' };

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

// Formas do bonequinho (as mesmas do design no Claude Design). Desenhado virado para a direita; para a esquerda espelha.
let SHAPES = null;
function shapes() {
  if (SHAPES || typeof Path2D === 'undefined') return SHAPES;
  const d = (s) => new Path2D(s);
  SHAPES = {
    cap: d('M-11 -49 C-11.7 -58.6 -6 -62.7 0.5 -62.5 C7 -62.3 11.7 -58 11 -49 C9.6 -53.8 6 -55.7 1.5 -55.3 C-2.5 -56.6 -8 -55 -11 -49 Z'),
    longo: d('M-11.8 -52 C-12.8 -44 -12.4 -38 -9.2 -34.6 L9.2 -34.6 C12.4 -38 12.8 -44 11.8 -52 Z'),
    bone: d('M-11.3 -50 C-11.3 -60.6 -5.6 -63.8 0 -63.8 C5.6 -63.8 11.3 -60.6 11.3 -50 Z'),
    aba: d('M2 -51.6 L15.2 -50.2 C15.8 -48.6 14.6 -47.8 13 -47.8 L2 -48.8 Z'),
    barba: d('M-8.8 -48 C-8.2 -40.4 -4 -38.4 0 -38.4 C4 -38.4 8.2 -40.4 8.8 -48 C6.2 -44.4 3.6 -43.6 0 -43.4 C-3.6 -43.6 -6.2 -44.4 -8.8 -48 Z'),
    gola: d('M-3.6 -39.5 Q0 -35.4 3.6 -39.5 Z'),
    capuz: d('M-7.2 -39.4 Q0 -33.6 7.2 -39.4 Q5 -42.8 0 -43 Q-5 -42.8 -7.2 -39.4 Z'),
    poloL: d('M-4.8 -39.5 L0 -36 L-1.2 -33.4 L-6 -37.6 Z'), poloR: d('M4.8 -39.5 L0 -36 L1.2 -33.4 L6 -37.6 Z'),
    camisaV: d('M-4.8 -39.5 L4.8 -39.5 L0 -28.4 Z'),
    lapelaL: d('M-4.8 -39.5 L-7.4 -37.8 L-3.4 -30.6 L-1 -33 Z'), lapelaR: d('M4.8 -39.5 L7.4 -37.8 L3.4 -30.6 L1 -33 Z'),
    gravata: d('M-1.4 -36.6 L1.4 -36.6 L2.6 -25.8 L0 -23 L-2.6 -25.8 Z'), gravataSombra: d('M0.2 -36.6 L1.4 -36.6 L2.6 -25.8 L0.2 -23.2 Z'),
    lenco: d('M4.6 -34 L7.6 -34 L7.2 -32.2 L5.6 -31.6 Z'),
  };
  return SHAPES;
}

/**
 * Bonequinho: cabeça grande com contorno, olhos, sobrancelha e bochecha; roupa sorteada (camiseta, listrada, moletom
 * ou polo) ou terno com gravata vermelha (chefe). Anda balançando braços e pernas, fica de costas quando sobe a tela
 * ou espera o elevador, senta e digita na mesa, comemora com os braços para cima e dorme no sofá.
 */
export function drawPerson(ctx, p, t) {
  const L = p.look, S = shapes();
  if (!S) return;
  const OUT = 'rgba(20,16,12,.5)';
  const walk = p.moving ? Math.sin(t * 11 + p.phase) : 0;
  const cel = p.celebrate > 0;
  const sit = !p.moving && p.sit;
  const back = !!p.faceUp && !sit;
  const sleep = p.mood === 'parado' && sit;
  const bob = p.moving ? Math.abs(walk) * 1.4 : cel ? Math.abs(Math.sin(t * 10)) * 9 : Math.sin(t * 2 + p.phase) * 0.35;
  const boss = L.boss, st = L.style, top = L.top ?? (boss ? 'terno' : 'camiseta');
  const torso = boss ? L.jacket : L.shirt;
  const fore = !boss && top !== 'moletom' ? L.skin : torso;
  const rect = (x, y, w, h, r, c) => { ctx.fillStyle = c; rr(ctx, x, y, w, h, r); ctx.fill(); };
  const circ = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const ell = (x, y, rx, ry, rot, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill(); };
  const fill = (c, path) => { ctx.fillStyle = c; ctx.fill(path); };
  const outline = (w = 0.7) => { ctx.strokeStyle = OUT; ctx.lineWidth = w; ctx.stroke(); };

  ctx.save();
  ctx.translate(p.sx, p.sy);
  ctx.scale(p.scale, p.scale);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 0.5, 12.5, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -bob + (sit ? 7 : 0));
  if (p.face < 0) ctx.scale(-1, 1);

  // cabelo que fica atrás da cabeça
  if (!back && st === 'rabo') ell(-11.6, -49, 3.6, 7.5, 0.35, L.hair);
  if (!back && st === 'longo') fill(L.hair, S.longo);
  if (st === 'cacheado') { circ(0, -53, 13.8, L.hair); circ(-12, -47, 4.4, L.hair); circ(12, -47, 4.4, L.hair); }

  // pernas e tênis
  const legH = sit ? 10 : 18.5, sw = walk * 2.2;
  const legs = [[-7.6 + sw, legH - Math.max(0, walk) * 1.6], [1.4 - sw, legH - Math.max(0, -walk) * 1.6]];
  for (const [x, h] of legs) rect(x, -20.5, 6.2, h, 2.2, L.pants);
  for (const [x, h] of legs) {
    const sx0 = x - 0.6 + (back ? 0 : 0.8), sy0 = -20.5 + h - 3;
    rect(sx0, sy0, 8.6, 5, 2.4, L.shoes); outline(0.6);
    rect(sx0, sy0 + 4, 8.6, 1.1, 0.5, boss ? '#0A0A0A' : 'rgba(255,255,255,.92)');
  }

  // pescoço e tronco
  rect(-2.6, -42, 5.2, 4.5, 0, L.skin);
  rect(-9.6, -39.5, 19.2, 21.5, 5.5, torso); outline();
  rect(4.2, -39, 5, 20.6, 4, 'rgba(0,0,0,.14)');
  ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(-9.6, -21, 19.2, 3);
  if (back) {
    if (top === 'moletom') fill('rgba(0,0,0,.22)', S.capuz);
  } else if (top === 'terno') {
    fill(L.shirt, S.camisaV); fill('#0F172A', S.lapelaL); fill('#0F172A', S.lapelaR);
    rect(-1.7, -39.2, 3.4, 2.8, 0.9, L.tie); fill(L.tie, S.gravata); fill('rgba(0,0,0,.18)', S.gravataSombra);
    fill('#F4F4F5', S.lenco); circ(-3.2, -24.4, 0.75, '#0F172A');
  } else if (top === 'listrada') {
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-9.4, -33.4, 18.8, 2.2); ctx.fillRect(-9.4, -27.4, 18.8, 2.2);
    fill(L.skin, S.gola);
  } else if (top === 'moletom') {
    fill('rgba(0,0,0,.22)', S.capuz);
    rect(-2.3, -37, 0.9, 5.4, 0.4, '#F4F4F5'); rect(1.4, -37, 0.9, 5.4, 0.4, '#F4F4F5');
    rect(-6, -27.4, 12, 6, 2, 'rgba(0,0,0,.14)');
  } else if (top === 'polo') {
    fill('rgba(255,255,255,.88)', S.poloL); fill('rgba(255,255,255,.88)', S.poloR);
    circ(0, -32.6, 0.65, 'rgba(0,0,0,.4)'); circ(0, -30, 0.65, 'rgba(0,0,0,.4)');
  } else fill(L.skin, S.gola);

  // braços: balançam andando, vão para a frente digitando, sobem comemorando
  let aL = 5, aR = -5;
  if (p.moving) { aL = 24 * walk; aR = -24 * walk; }
  else if (sit) { const ty = p.typing ? Math.sin(t * 22) * 6 : 0; aL = -32 + ty; aR = 32 - ty; }
  if (cel) { const w = Math.sin(t * 12) * 12; aL = 150 + w; aR = -150 - w; }
  for (const [side, deg] of [[-1, aL], [1, aR]]) {
    ctx.save();
    ctx.translate(11.4 * side, -36); ctx.rotate((deg * Math.PI) / 180); ctx.translate(-11.4 * side, 36);
    rect(side < 0 ? -13.8 : 9, -38, 4.8, 9, 2.4, torso);
    rect(side < 0 ? -13.6 : 9.2, -31, 4.4, 8.4, 2.2, fore);
    circ(11.4 * side, -22.4, 2.5, L.skin);
    ctx.restore();
  }

  // cabeça
  circ(-10.3, -49.2, 2.3, L.skin); circ(10.3, -49.2, 2.3, L.skin);
  ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(0, -50, 10.6, 0, Math.PI * 2); ctx.fill(); outline();

  if (back) {
    if (st !== 'careca' && st !== 'bone') {
      circ(0, -50.4, 11, L.hair);
      if (st === 'longo') fill(L.hair, S.longo);
      if (st === 'rabo') ell(0, -41, 3.4, 7, 0, L.hair);
      if (st === 'coque') circ(0, -63.6, 4.9, L.hair);
    }
    if (st === 'bone') fill(L.cap, S.bone);
    if (st === 'careca') ell(-3.6, -57.2, 3.2, 1.6, 0, 'rgba(255,255,255,.35)');
  } else {
    const fx = 1.2;
    if (L.acc === 'barba') fill(['#7C3AED', '#E5E5E5'].includes(L.hair) ? '#3B2A20' : L.hair, S.barba);
    ctx.strokeStyle = '#1B1B1F'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    if (sleep || p.blink) {
      for (const ex of [-3.7, 3.7]) { ctx.beginPath(); ctx.arc(ex + fx, sleep ? -51.4 : -50.4, 1.8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    } else {
      for (const ex of [-3.7, 3.7]) {
        ell(ex + fx, -50.4, 2.3, 2.7, 0, '#FFFFFF');
        circ(ex + fx * 1.5, -50.1, 1.45, '#1B1B1F');
        circ(ex + 0.5 + fx * 1.5, -50.8, 0.45, '#FFFFFF');
      }
    }
    const brow = L.hair === '#E5E5E5' ? '#A1A1AA' : L.hair;
    const worried = p.mood === 'travado';
    for (const [bx, rot] of [[-5.7, worried ? 0.35 : 0], [1.9, worried ? -0.35 : 0]]) {
      ctx.save(); ctx.translate(bx + fx + 1.9, -55); ctx.rotate(rot); rect(-1.9, -0.55, 3.8, 1.1, 0.55, brow); ctx.restore();
    }
    ell(fx * 1.7, -47.6, 0.9, 0.7, 0, 'rgba(0,0,0,.14)');
    circ(-6.6 + fx, -46.4, 1.8, 'rgba(244,114,182,.32)'); circ(6.6 + fx, -46.4, 1.8, 'rgba(244,114,182,.32)');
    ctx.strokeStyle = '#5B2A1F'; ctx.lineWidth = 0.95;
    ctx.beginPath();
    if (cel) { ctx.moveTo(-2.8 + fx, -45.6); ctx.quadraticCurveTo(fx, -40.4, 2.8 + fx, -45.6); ctx.closePath(); ctx.fillStyle = '#7F1D1D'; ctx.fill(); }
    else if (worried) { ctx.moveTo(-2.3 + fx, -43.8); ctx.quadraticCurveTo(fx, -45.8, 2.3 + fx, -43.8); ctx.stroke(); }
    else if (sleep) { ctx.arc(fx, -44.4, 1, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.moveTo(-2.5 + fx, -45.3); ctx.quadraticCurveTo(fx, -42.6, 2.5 + fx, -45.3); ctx.stroke(); }

    if (['curto', 'longo', 'coque', 'topete', 'rabo'].includes(st)) fill(L.hair, S.cap);
    if (st === 'topete') ell(3, -60.6, 7.6, 4.2, -0.31, L.hair);
    if (st === 'coque') circ(0, -63.6, 4.9, L.hair);
    if (st === 'cacheado') { circ(-7, -58, 4.3, L.hair); circ(-1.8, -60.6, 4.5, L.hair); circ(3.8, -60, 4.4, L.hair); circ(8.2, -57, 4, L.hair); }
    if (st === 'bone') { fill(L.cap, S.bone); fill(L.cap, S.aba); fill('rgba(0,0,0,.2)', S.aba); circ(0, -63.4, 1.3, 'rgba(0,0,0,.25)'); }
    if (st === 'careca') ell(-3.6, -57.2, 3.2, 1.6, 0, 'rgba(255,255,255,.35)');
    if (L.acc === 'oculos') {
      ctx.strokeStyle = '#18181B'; ctx.lineWidth = 0.9;
      for (const ex of [-3.7, 3.7]) { ctx.fillStyle = 'rgba(186,230,253,.18)'; ctx.beginPath(); ctx.arc(ex + fx, -50.4, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#18181B'; ctx.fillRect(-0.7 + fx, -51, 1.4, 0.9);
    }
  }
  if (L.acc === 'fone') {
    ctx.strokeStyle = '#27272A'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-11.4, -50); ctx.bezierCurveTo(-11.4, -65, 11.4, -65, 11.4, -50); ctx.stroke();
    rect(-13.6, -53.4, 4.4, 7.4, 2.2, '#F97316'); rect(9.2, -53.4, 4.4, 7.4, 2.2, '#F97316');
  }
  ctx.restore();
}

function drawFurniture(ctx, f, P, k, t, night) {
  const box = (x, y, w, h, fill, r = 4, stroke) => { const a = P(x - w / 2, y - h / 2), b = P(x + w / 2, y + h / 2); ctx.fillStyle = fill; rr(ctx, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), r * k); ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); } };
  const dot = (x, y, r, fill) => { const a = P(x, y); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(a.x, a.y, r * k, 0, Math.PI * 2); ctx.fill(); };
  switch (f.t) {
    case 'mesaPc': box(f.x, f.y, 84, 30, '#8B5E3C', 4); box(f.x, f.y - 6, 30, 16, '#18181B', 2); box(f.x, f.y - 6, 26, 12, night ? '#60A5FA' : '#3B82F6', 1); box(f.x + 26, f.y + 4, 10, 6, '#D4D4D8', 2); break;
    case 'mesaChefe': box(f.x, f.y, 170, 46, '#5B3A21', 6); box(f.x - 40, f.y - 4, 34, 18, '#18181B', 2); box(f.x - 40, f.y - 4, 30, 14, '#60A5FA', 1); box(f.x + 45, f.y, 22, 14, '#F4F4F5', 2); dot(f.x + 70, f.y - 8, 5, '#B91C1C'); break;
    case 'mesa': box(f.x, f.y, f.w ?? 120, f.h ?? 60, '#A16207', 8); break;
    case 'balcao': box(f.x, f.y, 200, 40, '#7C2D12', 8); box(f.x, f.y - 10, 200, 12, '#F97316', 4); break;
    case 'cafe': box(f.x, f.y, 34, 30, '#3F3F46', 4); dot(f.x, f.y - 2, 5, '#78350F'); if (Math.sin(t * 2) > 0) dot(f.x + 6, f.y - 22 - (t * 10) % 8, 2.5, 'rgba(255,255,255,.35)'); break;
    case 'geladeira': box(f.x, f.y, 38, 50, '#E4E4E7', 5, '#A1A1AA'); break;
    case 'sofa': box(f.x, f.y, f.w ?? 180, 34, '#7C3AED', 10); box(f.x, f.y - 14, f.w ?? 180, 12, '#6D28D9', 6); break;
    case 'tv': box(f.x, f.y, 120, 14, '#0A0A0A', 3); box(f.x, f.y, 112, 8, night ? '#F97316' : '#1E3A8A', 2); break;
    case 'planta': dot(f.x, f.y + 6, 10, '#78350F'); dot(f.x - 6, f.y - 4, 9, '#16A34A'); dot(f.x + 6, f.y - 6, 9, '#22C55E'); dot(f.x, f.y - 12, 8, '#15803D'); break;
    case 'arvore': dot(f.x, f.y, 34, '#166534'); dot(f.x - 12, f.y - 10, 22, '#15803D'); dot(f.x + 14, f.y + 6, 20, '#22C55E'); break;
    case 'banco': box(f.x, f.y, 110, 18, '#92400E', 5); break;
    case 'pingpong': box(f.x, f.y, 150, 80, '#15803D', 6, '#F4F4F5'); box(f.x, f.y, 3, 80, '#F4F4F5', 0); dot(f.x + Math.sin(t * 3) * 60, f.y + Math.cos(t * 5) * 20, 3.5, '#FFFFFF'); break;
    case 'fliperama': box(f.x, f.y, 40, 46, '#1E1B4B', 5); box(f.x, f.y - 6, 30, 20, `hsl(${(t * 80) % 360} 80% 60%)`, 2); break;
    case 'pia': box(f.x, f.y, 50, 26, '#E4E4E7', 6); dot(f.x, f.y, 6, '#93C5FD'); break;
    case 'cabine': box(f.x, f.y, 44, 90, '#A1A1AA', 3, '#71717A'); break;
    case 'estante': box(f.x, f.y, 90, 26, '#78350F', 3); for (let i = -3; i <= 3; i++) box(f.x + i * 11, f.y, 8, 18, ['#EF4444', '#3B82F6', '#EAB308', '#22C55E'][(i + 3) % 4], 1); break;
    case 'caixas': box(f.x - 20, f.y, 34, 30, '#B45309', 3); box(f.x + 18, f.y + 4, 30, 26, '#D97706', 3); break;
    case 'arquivo': box(f.x, f.y, 44, 30, '#52525B', 3, '#3F3F46'); break;
    case 'quadro': box(f.x, f.y, 140, 14, '#F4F4F5', 2); break;
    case 'quadroBranco': box(f.x, f.y, 150, 10, '#F4F4F5', 2); break;
    case 'telao': box(f.x, f.y, 260, 16, '#0A0A0A', 3); break;
    case 'painel': box(f.x, f.y, 200, 18, '#0A0A0A', 3); break;
    case 'impressora': box(f.x, f.y, 60, 36, '#D4D4D8', 5); box(f.x, f.y + 4, 40, 6, '#F4F4F5', 1); break;
    case 'tapete': break; // vai na camada fixa (chão)
    case 'arte': break; // quadro na parede: camada fixa
    case 'letreiro': { const a = P(f.x, f.y); const on = !night || Math.sin(t * 7) > -0.92; ctx.font = `800 ${Math.max(8, 12 * k)}px system-ui`; ctx.textAlign = 'center'; ctx.shadowColor = '#F97316'; ctx.shadowBlur = on ? 10 * k : 0; ctx.fillStyle = on ? '#FDBA74' : '#7C2D12'; const lw = ctx.measureText('AGENT CONTROL').width; ctx.fillText('AGENT CONTROL', Math.max(a.x, lw / 2 + 6), a.y + 4 * k); ctx.shadowBlur = 0; break; }
    case 'aquario': { box(f.x, f.y, 56, 34, '#0C4A6E', 5, '#38BDF8'); for (let i = 0; i < 3; i++) dot(f.x - 18 + ((t * (8 + i * 5) + i * 17) % 36), f.y - 6 + i * 6, 2.6, ['#F97316', '#FACC15', '#F472B6'][i]); dot(f.x + 14, f.y - 10 - ((t * 12) % 10), 1.4, 'rgba(255,255,255,.6)'); break; }
    case 'vending': box(f.x, f.y, 40, 52, '#B91C1C', 5); box(f.x - 5, f.y - 4, 22, 34, '#0F172A', 2); for (let i = 0; i < 3; i++) box(f.x - 5, f.y - 14 + i * 10, 18, 4, ['#FACC15', '#22C55E', '#38BDF8'][i], 1); box(f.x + 13, f.y - 8, 6, 10, '#E4E4E7', 1); break;
    case 'bebedouro': box(f.x, f.y + 6, 22, 22, '#E4E4E7', 4); dot(f.x, f.y - 8, 10, 'rgba(147,197,253,.85)'); break;
    case 'luminaria': { dot(f.x, f.y + 8, 7, '#3F3F46'); box(f.x, f.y - 6, 3, 26, '#52525B', 1); if (night) { const a = P(f.x, f.y - 18); const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 70 * k); g.addColorStop(0, 'rgba(253,224,71,.35)'); g.addColorStop(1, 'rgba(253,224,71,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a.x, a.y, 70 * k, 0, Math.PI * 2); ctx.fill(); } dot(f.x, f.y - 18, 9, night ? '#FDE047' : '#FEF3C7'); break; }
    case 'flores': for (let i = 0; i < 5; i++) dot(f.x + Math.cos(i * 1.3) * 12, f.y + Math.sin(i * 1.3) * 8, 3.5, ['#F472B6', '#FACC15', '#F87171', '#C084FC', '#FB923C'][i]); break;
    case 'trofeus': box(f.x, f.y, 34, 90, '#78350F', 3); for (let i = 0; i < 3; i++) { dot(f.x, f.y - 28 + i * 28, 7, '#FACC15'); box(f.x, f.y - 20 + i * 28, 8, 5, '#CA8A04', 1); } break;
    case 'abobora': dot(f.x, f.y, 11, '#EA580C'); dot(f.x - 6, f.y, 8, '#F97316'); dot(f.x + 6, f.y, 8, '#F97316'); box(f.x, f.y - 12, 3, 6, '#166534', 1); break;
    case 'arvoreNatal': { const a = P(f.x, f.y); ctx.fillStyle = '#166534'; ctx.beginPath(); ctx.moveTo(a.x, a.y - 40 * k); ctx.lineTo(a.x - 22 * k, a.y + 10 * k); ctx.lineTo(a.x + 22 * k, a.y + 10 * k); ctx.closePath(); ctx.fill(); for (let i = 0; i < 6; i++) dot(f.x - 12 + (i % 3) * 12, f.y - 20 + Math.floor(i / 3) * 16, 2.6, Math.sin(t * 3 + i) > 0 ? '#FACC15' : '#EF4444'); dot(f.x, f.y - 42, 4, '#FDE047'); break; }
    case 'quadroTarefas': box(f.x, f.y, 140, 26, '#F4F4F5', 3, '#A1A1AA'); break;
    case 'stairs': break;
  }
}

/** Coisas do chão e da parede que não mudam: desenhadas uma vez na camada fixa (cache). */
function drawStaticDecor(g, f, P, k) {
  for (const r of f.rooms) for (const fu of r.furniture) {
    if (fu.t === 'tapete') {
      const a = P(fu.x - fu.w / 2, fu.y - fu.h / 2), b = P(fu.x + fu.w / 2, fu.y + fu.h / 2);
      g.globalAlpha = 0.55; g.fillStyle = fu.c; rr(g, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), 14 * k); g.fill();
      g.globalAlpha = 0.35; g.strokeStyle = '#FFFFFF'; g.lineWidth = Math.max(1, 1.5 * k); g.setLineDash([4 * k, 4 * k]);
      rr(g, Math.min(a.x, b.x) + 6 * k, Math.min(a.y, b.y) + 6 * k, Math.abs(b.x - a.x) - 12 * k, Math.abs(b.y - a.y) - 12 * k, 10 * k); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
    } else if (fu.t === 'arte') {
      const a = P(fu.x - 17, fu.y - 9), b = P(fu.x + 17, fu.y + 9);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      g.fillStyle = '#A16207'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle = fu.c; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(x + w * 0.3, y + h * 0.4, Math.min(w, h) * 0.22, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w * 0.55, y + h * 0.35); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    }
  }
}

/** AgentC, o mascote do escritório: um robozinho hexagonal que passeia pelos andares. */
function drawPet(ctx, pet, t) {
  ctx.save();
  ctx.translate(pet.sx, pet.sy - 4 * pet.scale - Math.abs(Math.sin(t * 6)) * (pet.moving ? 3 : 1) * pet.scale);
  ctx.scale(pet.scale, pet.scale);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(0, 4, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(Math.cos(a) * 11, -10 + Math.sin(a) * 11); }
  ctx.closePath(); ctx.fillStyle = '#141414'; ctx.fill(); ctx.strokeStyle = '#F97316'; ctx.lineWidth = 2.6; ctx.stroke();
  const blink = (t % 3.5) < 0.12;
  ctx.fillStyle = '#F4F4F4';
  if (blink) { ctx.fillRect(-5 + pet.face, -10, 3.5, 1.2); ctx.fillRect(1.5 + pet.face, -10, 3.5, 1.2); }
  else { ctx.fillRect(-4.5 + pet.face, -14, 3, 7); ctx.fillRect(1.5 + pet.face, -14, 3, 7); }
  ctx.restore();
}

// ---------- componente ----------
export function createPredio(root, hooks = {}) {
  const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* privado */ } } };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };

  root.classList.add('predio');
  const bar = el('div', 'predio-bar');
  const floorsBox = el('div', 'predio-floors');
  floorsBox.setAttribute('role', 'tablist');
  floorsBox.setAttribute('aria-label', 'Andares');
  const tools = el('div', 'predio-tools');
  const mk = (label, title, fn) => { const b = el('button', 'predio-btn', label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', fn); tools.append(b); return b; };
  bar.append(floorsBox, tools);
  const stage = el('div', 'predio-stage');
  const canvas = el('canvas', 'predio-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Prédio com os agentes andando pelos andares');
  canvas.tabIndex = 0;
  const card = el('div', 'predio-card'); card.hidden = true;
  const legend = el('div', 'predio-legend');
  for (const k of ['trabalhando', 'revisando', 'travado', 'terminou', 'parado', 'chamada']) { const s = el('span'); const i = el('i'); i.style.background = STATUS_COLOR[k]; s.append(i, document.createTextNode(STATUS_LABEL[k].split(' /')[0])); legend.append(s); }
  const sr = el('ul', 'sr'); // leitor de tela: quem está onde
  sr.setAttribute('aria-live', 'polite');
  stage.append(canvas, card);
  root.append(bar, stage, legend, sr);

  const ctx = canvas.getContext('2d');
  let floors = [makeFloor('terreo', 0), makeFloor('diretoria', 1), makeFloor('time', 2)];
  let view = Number(store.get('predio.andar', '2')) || 2;
  let salt = Number(store.get('predio.roupas', '0')) || 0;
  let zoom = 1, cam = { x: 0, y: 0 }, follow = null, selected = null;
  const people = new Map(); // id → bonequinho
  let pending = 0, callData = null, running = false, last = 0, dpr = 1, k = 1, portrait = false, ox = 0, oy = 0, cw = 0, ch = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // camada fixa (chão, paredes, tapetes, quadros, nomes das salas): desenhada só quando algo muda
  const bg = document.createElement('canvas'); let bgKey = '';
  let light = false, themeAt = 0, lastDraw = 0;
  const confetti = [];
  const pet = { id: 'AgentC', pet: true, floor: 0, x: 600, y: 360, path: [], moving: false, face: 1, scale: 1, sx: 0, sy: 0, restUntil: 0, bubble: null, lane: 12, target: null };
  let elev = createElevators(floors.length);
  const CHATTER = [['Bora um café?', 'Bora! ☕'], ['Viu o deploy?', 'Passou liso ✓'], ['Que bug chato…', 'Te ajudo depois'], ['Bom trabalho hoje!', 'Valeu! 🙌'], ['O chefe aprovou?', 'Ainda não 😅'], ['Ping-pong?', 'Só uma partida!'], ['Terminei a minha', 'Boa! 🎉']];

  mk('−', 'Afastar', () => setZoom(zoom / 1.25));
  mk('+', 'Aproximar', () => setZoom(zoom * 1.25));
  mk('🎲', 'Sortear roupas', () => { salt++; store.set('predio.roupas', String(salt)); for (const p of people.values()) p.look = lookFor(p.id, p.boss, salt); });
  const fsBtn = mk('⛶', 'Tela cheia', () => toggleFull());

  function toggleFull() {
    const on = !root.classList.contains('full');
    if (on && root.requestFullscreen && !/iPhone|iPad/.test(navigator.userAgent)) root.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.classList.toggle('full', on);
    fsBtn.setAttribute('aria-pressed', String(on));
    resize();
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && root.classList.contains('full')) { root.classList.remove('full'); resize(); } });

  function setZoom(z) { zoom = Math.min(3, Math.max(1, z)); if (zoom === 1) cam = { x: 0, y: 0 }; clampCam(); }
  function clampCam() { const mx = (W * (zoom - 1)) / 2, my = (H * (zoom - 1)) / 2; cam.x = Math.max(-mx, Math.min(mx, cam.x)); cam.y = Math.max(-my, Math.min(my, cam.y)); }

  function renderFloors() {
    floorsBox.replaceChildren();
    floors.forEach((f, i) => {
      const n = [...people.values()].filter((p) => p.floor === i).length;
      const b = el('button', 'predio-floor' + (i === view ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === view));
      b.append(el('b', null, i === 0 ? 'T' : `${i}º`), el('span', null, f.name.replace(/^\d+º andar · /, '')), el('small', null, String(n)));
      b.addEventListener('click', () => goFloor(i));
      floorsBox.append(b);
    });
  }
  function goFloor(i) { view = Math.max(0, Math.min(floors.length - 1, i)); store.set('predio.andar', String(view)); follow = null; renderFloors(); }

  // ---------- pessoas ----------
  function ensure(id, boss = false) {
    let p = people.get(id);
    if (!p) {
      // todo mundo chega pela recepção do térreo
      p = { id, boss, look: lookFor(id, boss, salt), floor: 0, x: 120 + Math.random() * 110, y: 250, path: [], moving: false, face: 1, phase: Math.random() * 6, lane: (Math.random() - 0.5) * 30, mood: 'parado', sit: false, typing: false, blink: false, bubble: null, celebrate: 0, wanderAt: 0, target: null, info: null, scale: 1, sx: 0, sy: 0 };
      people.set(id, p);
    }
    return p;
  }

  function goTo(p, target) {
    if (p.target && p.target.floor === target.floor && Math.hypot(p.target.x - target.x, p.target.y - target.y) < 2) return;
    p.target = target;
    p.sit = false;
    // dentro da cabine: só troca o andar de saída; o caminho é refeito quando a porta abrir
    if (p.inCar) { const r = p.inCar.riders.find((x) => x.o === p); if (r) r.to = target.floor; p.inCar.stops.add(target.floor); p.path = []; return; }
    leaveQueue(p);
    p.path = route(floors, { floor: p.floor, x: p.x, y: p.y }, target, p.lane);
  }

  // ---------- elevador: marcas de espera, entrar e sair ----------
  const waiting = new Map(); // "andar:marca" → quem está ali
  function leaveQueue(o) {
    if (o.boardingCar) { o.boardingCar.boarding.delete(o.id); o.boardingCar = null; }
    for (const [key, who] of waiting) if (who === o) waiting.delete(key);
    o.waitSpot = null;
  }
  function waitSpotFor(o) {
    for (let i = 0; i < ELEV.wait.length; i++) {
      const key = `${o.floor}:${i}`;
      if (!waiting.has(key) || waiting.get(key) === o) { waiting.set(key, o); return ELEV.wait[i]; }
    }
    const [x, y] = ELEV.wait[Math.floor(Math.random() * ELEV.wait.length)];
    return [x + (Math.random() - 0.5) * 20, y + 30];
  }
  /** Anda pelo caminho, incluindo o elevador. Devolve true quando chega no fim do caminho neste passo. */
  function travel(o, dt, speed) {
    if (o.inCar) {
      const c = o.inCar, slot = c.riders.findIndex((r) => r.o === o), f = Math.round(c.pos);
      if (o.floor !== f) { o.floor = f; if (!o.pet) renderFloors(); }
      o.x = c.x + ELEV.slots[slot % ELEV.slots.length][0]; o.y = ELEV.cabY + ELEV.slots[slot % ELEV.slots.length][1];
      o.moving = false; o.faceUp = false; o.face = 1;
      const r = c.riders[slot];
      if (elev.arrivedAt(c) === r.to && c.door > 0.85) {
        c.riders.splice(slot, 1);
        o.inCar = null; o.floor = r.to; o.x = c.x + (slot % 2 ? 10 : -10);
        const out = { floor: r.to, x: o.x, y: 546 };
        o.path = [out, ...(o.target ? route(floors, out, o.target, o.lane).filter((n) => !(n.floor === out.floor && Math.hypot(n.x - out.x, n.y - out.y) < 1)) : [])];
        if (!o.pet) renderFloors();
      }
      return false;
    }
    let n = o.path[0];
    if (!n) return false;
    if (n.elevator) {
      o.moving = false; o.faceUp = true;
      if (n.to === o.floor) { o.path.shift(); leaveQueue(o); if (o.target) o.path = route(floors, { floor: o.floor, x: o.x, y: o.y }, o.target, o.lane); return false; }
      elev.call(o.floor);
      const c = elev.openAt(o.floor);
      if (c) {
        leaveQueue(o);
        o.boardingCar = c; c.boarding.add(o.id);
        const slot = c.riders.length + c.boarding.size - 1;
        o.path.unshift({ floor: o.floor, x: c.x + ELEV.slots[slot % ELEV.slots.length][0], y: ELEV.cabY, board: c });
      }
      return false;
    }
    if (n.wait && !o.waitSpot) { o.waitSpot = waitSpotFor(o); n.x = o.waitSpot[0]; n.y = o.waitSpot[1]; }
    if (n.floor !== o.floor) { o.floor = n.floor; o.x = n.x; o.y = n.y; o.path.shift(); if (!o.pet) renderFloors(); return false; }
    const dx = n.x - o.x, dy = n.y - o.y, d = Math.hypot(dx, dy);
    const v = speed * dt;
    o.moving = true;
    if (Math.abs(dx) > 0.5) o.face = dx < 0 ? -1 : 1;
    o.faceUp = dy < -Math.abs(dx) * 0.9;
    if (d > v) { o.x += (dx / d) * v; o.y += (dy / d) * v; return false; }
    o.x = n.x; o.y = n.y; o.path.shift();
    if (n.board) {
      const c = n.board;
      c.boarding.delete(o.id); o.boardingCar = null;
      if (c.state === 'open' || c.state === 'opening') {
        const e = o.path[0];
        const to = e?.elevator ? e.to : o.target?.floor ?? o.floor;
        if (e?.elevator) o.path.shift();
        c.riders.push({ o, to }); c.stops.add(to); o.inCar = c; o.moving = false;
      } else {
        o.path.unshift({ floor: o.floor, x: o.x, y: 546 }); // a porta fechou na cara: volta para a marca e chama de novo
      }
      return false;
    }
    return !o.path.length;
  }

  const taken = new Map();
  function freeSpot(floorIdx, filter, id, mix = 0) {
    const f = floors[floorIdx];
    const cands = [];
    for (const r of f.rooms.filter(filter)) for (const s of r.spots) cands.push({ floor: floorIdx, ...s });
    if (!cands.length) return null;
    const key = (s) => `${s.floor}:${s.x}:${s.y}`;
    const r = rng(seedOf(id) + mix + Math.floor(Date.now() / 600_000));
    const start = Math.floor(r() * cands.length);
    for (let i = 0; i < cands.length; i++) { const s = cands[(start + i) % cands.length]; const who = taken.get(key(s)); if (!who || who === id) { taken.set(key(s), id); return s; } }
    return cands[start];
  }
  function release(id) { for (const [k2, v] of taken) if (v === id) taken.delete(k2); }

  function deskOf(index) {
    const fi = 2 + Math.floor(index / PER_FLOOR), slot = index % PER_FLOOR;
    const r = floors[fi].rooms[Math.floor(slot / 2)];
    return { floor: fi, ...r.desks[slot % 2] };
  }

  function placeAll() {
    taken.clear();
    const inCall = new Set(callData && callData.status !== 'ENCERRADA' ? callData.participants.map((x) => x.id) : []);
    const dir = floors[1];
    const reun = dir.rooms.find((r) => r.meeting), chefe = dir.rooms.find((r) => r.queue);
    let ci = 0, qi = 0;
    const boss = people.get('VOCÊ');
    if (boss) {
      boss.mood = 'chefe';
      const t = inCall.size ? { floor: 1, ...reun.head } : { floor: 1, ...chefe.boss };
      goTo(boss, t);
    }
    let i = 0;
    for (const p of people.values()) {
      if (p.boss) continue;
      const idx = i++;
      release(p.id);
      if (inCall.has(p.id)) { p.mood = 'chamada'; const s = reun.spots[ci++ % reun.spots.length]; taken.set(`1:${s.x}:${s.y}`, p.id); goTo(p, { floor: 1, ...s }); continue; }
      const before = p.mood;
      p.mood = moodOf(p.info);
      if (before && before !== 'terminou' && p.mood === 'terminou') p.party = true;
      if (p.mood === 'trabalhando' || p.mood === 'revisando') goTo(p, deskOf(idx));
      else if (p.mood === 'travado') { const s = chefe.spots[qi++ % chefe.spots.length]; goTo(p, { floor: 1, ...s }); }
      else if (p.mood === 'terminou') goTo(p, freeSpot(0, (r) => r.name === 'Copa' || r.name === 'Jogos', p.id) ?? deskOf(idx));
      else goTo(p, freeSpot(0, (r) => r.sleep || r.green, p.id) ?? deskOf(idx));
      p.wanderAt = performance.now() + 20_000 + Math.random() * 40_000;
    }
    renderFloors();
    describe();
  }

  /** De vez em quando quem trabalha vai buscar um café na copa do andar e volta; quem está à toa troca de lugar. */
  function wander(now) {
    // chefe com aprovação esperando: de vez em quando vai conferir o painel e volta para a mesa
    const boss = people.get('VOCÊ');
    if (boss && pending > 0 && !boss.path.length && !boss.inCar && boss.mood === 'chefe' && now > (boss.checkAt ?? 0) && !(callData && callData.status !== 'ENCERRADA')) {
      boss.checkAt = now + 45_000 + Math.random() * 30_000;
      const aprov = floors[1].rooms.find((r) => r.board), chefe = floors[1].rooms.find((r) => r.queue);
      boss.back = { floor: 1, ...chefe.boss };
      goTo(boss, { floor: 1, ...aprov.spots[0] });
      boss.bubble = { text: `${pending} aprovação(ões) esperando…`, until: now + 4000 };
    }
    // conversa no corredor: dois parados perto um do outro trocam uma frase
    const idle = [...people.values()].filter((q) => !q.boss && !q.path.length && !q.inCar && !q.typing && now > (q.chatAt ?? 0) && (!q.bubble || q.bubble.until < now));
    for (let a = 0; a < idle.length; a++) for (let b = a + 1; b < idle.length; b++) {
      const x = idle[a], y = idle[b];
      if (x.floor !== y.floor || Math.hypot(x.x - y.x, x.y - y.y) > 110 || Math.random() > 0.02) continue;
      const [q, r] = CHATTER[Math.floor(Math.random() * CHATTER.length)];
      x.bubble = { text: q, until: now + 3000 }; x.face = y.x > x.x ? 1 : -1; y.face = -x.face;
      setTimeout(() => { y.bubble = { text: r, until: performance.now() + 3000 }; }, 1800);
      x.chatAt = y.chatAt = now + 40_000 + Math.random() * 40_000;
    }
    let i = 0;
    for (const p of people.values()) {
      if (p.boss) continue;
      const idx = i++;
      if (p.path.length || p.inCar || now < p.wanderAt || p.mood === 'chamada' || p.mood === 'travado') continue;
      p.wanderAt = now + 25_000 + Math.random() * 50_000;
      if (p.mood === 'trabalhando' || p.mood === 'revisando') {
        if (Math.random() < 0.25 && p.floor >= 2) {
          const copa = floors[p.floor].rooms.find((r) => r.idle);
          const s = copa.spots[Math.floor(Math.random() * copa.spots.length)];
          p.back = deskOf(idx);
          goTo(p, { floor: p.floor, ...s });
        }
      } else if (p.mood === 'terminou' || (p.mood === 'parado' && Math.random() < 0.3)) {
        release(p.id);
        const s = freeSpot(0, (r) => !!r.idle, p.id, Math.floor(now));
        if (s) goTo(p, s);
      }
    }
  }

  function step(p, dt, now) {
    if (p.celebrate > 0) p.celebrate -= dt;
    if (!p.path.length && !p.inCar) {
      p.faceUp = false;
      p.moving = false;
      if (p.back && now > (p.backAt ?? Infinity)) { const b = p.back; p.back = null; p.backAt = null; goTo(p, b); return; }
      if (p.back && !p.backAt) p.backAt = now + 6000 + Math.random() * 6000;
      const r = roomAt(floors[p.floor], p.x, p.y);
      p.sit = !!(r && (r.desks?.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 3) || r.spots.some((s) => s.sit && Math.hypot(s.x - p.x, s.y - p.y) < 3)));
      p.typing = p.sit && (p.mood === 'trabalhando' || p.mood === 'revisando') && !p.back;
      if (p.mood === 'travado' || p.boss) p.face = p.boss ? 1 : -1;
      return;
    }
    if (travel(p, dt, SPEED * (p.boss ? 0.85 : 1)) && p.mood === 'terminou') { p.celebrate = 1.6; if (p.party) { p.party = false; burst(p.floor, p.x, p.y - 30); } }
  }

  function burst(floor, x, y) {
    if (reduce) return;
    for (let i = 0; i < 36; i++) confetti.push({ floor, x, y, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 140, life: 1.6 + Math.random(), c: ['#F97316', '#FACC15', '#22C55E', '#38BDF8', '#F472B6', '#A855F7'][i % 6], r: Math.random() * 6 });
  }
  function stepConfetti(dt) {
    for (let i = confetti.length - 1; i >= 0; i--) { const c = confetti[i]; c.life -= dt; c.vy += 260 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 8; if (c.life <= 0) confetti.splice(i, 1); }
  }
  /** O mascote anda por pontos aleatórios do andar; às vezes troca de andar de elevador. */
  function stepPet(dt, now) {
    if (!pet.path.length && !pet.inCar) {
      pet.faceUp = false;
      pet.moving = false;
      if (now < pet.restUntil) return;
      pet.restUntil = now + 2500 + Math.random() * 6000;
      let floor = pet.floor;
      if (Math.random() < 0.15) floor = Math.floor(Math.random() * floors.length);
      const rooms = floors[floor].rooms.filter((r) => !r.lobby && r.spots.length);
      const r = rooms[Math.floor(Math.random() * rooms.length)];
      const s = Math.random() < 0.3 ? corridorAt(80 + Math.random() * 840, (Math.random() - 0.5) * 50) : { x: r.x0 + 30 + Math.random() * (r.x1 - r.x0 - 60), y: r.y0 + 60 + Math.random() * (r.y1 - r.y0 - 100) };
      pet.target = { floor, ...s };
      leaveQueue(pet);
      pet.path = route(floors, { floor: pet.floor, x: pet.x, y: pet.y }, pet.target, 12);
      return;
    }
    travel(pet, dt, 70);
  }

  // ---------- desenho do andar ----------
  function resize() {
    const r = stage.getBoundingClientRect();
    cw = Math.max(280, r.width);
    const full = root.classList.contains('full');
    portrait = cw < 640 && (full ? innerHeight > innerWidth : true);
    const ww = portrait ? H : W, wh = portrait ? W : H;
    const maxH = full ? innerHeight - bar.offsetHeight - 16 : portrait ? innerHeight * 1.1 : innerHeight * 0.72;
    k = Math.min(cw / ww, maxH / wh);
    ch = wh * k;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    ox = (cw - ww * k) / 2; oy = 0;
  }
  // mundo → tela (com zoom, câmera e, no celular em pé, o prédio de lado)
  function P(x, y) {
    const zx = (x - W / 2 - cam.x) * zoom + W / 2, zy = (y - H / 2 - cam.y) * zoom + H / 2;
    return portrait ? { x: ox + zy * k, y: oy + zx * k } : { x: ox + zx * k, y: oy + zy * k };
  }
  function unP(sx, sy) {
    const a = portrait ? { zx: (sy - oy) / k, zy: (sx - ox) / k } : { zx: (sx - ox) / k, zy: (sy - oy) / k };
    return { x: (a.zx - W / 2) / zoom + W / 2 + cam.x, y: (a.zy - H / 2) / zoom + H / 2 + cam.y };
  }
  const rectW = (x0, y0, x1, y1) => { const a = P(x0, y0), b = P(x1, y1); return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)]; };

  // texto centrado que nunca sai da tela (no celular em pé o prédio fica de lado)
  function label(text, x, y, g = ctx) {
    const w = g.measureText(text).width;
    g.textAlign = 'center';
    g.fillText(text, Math.max(w / 2 + 4, Math.min(cw - w / 2 - 4, x)), Math.max(12, Math.min(ch - 4, y)));
  }

  /** Camada fixa: fundo, chão, corredor, salas, tapetes, quadros, paredes, janelas e nomes das salas. */
  function drawStatic(g, f, night) {
    const zk = k * zoom;
    g.fillStyle = light ? '#D9D4CC' : '#0B0B0C';
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = light ? '#ECE7E0' : '#17171A';
    g.fillRect(...rectW(30, 30, 1170, 690));
    g.fillStyle = light ? '#E2DCD3' : '#1F1F23';
    g.fillRect(...rectW(30, CORR.y0, 1170, CORR.y1));
    g.strokeStyle = light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)'; g.lineWidth = 1;
    for (let x = 60; x < 1170; x += 60) { const a = P(x, CORR.y0 + 8), b = P(x, CORR.y1 - 8); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    for (const r of f.rooms) {
      g.fillStyle = r.green ? (light ? '#BBE5C4' : '#132A1A') : r.lobby ? (light ? '#E4DED4' : '#141417') : r.boss ? (light ? '#E9DCCB' : '#1E1914') : r.meeting ? (light ? '#E3E0EE' : '#16151F') : (light ? '#F3EEE7' : '#151518');
      g.fillRect(...rectW(r.x0 + 3, r.y0 + 3, r.x1 - 3, r.y1 - 3));
      g.strokeStyle = light ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.025)';
      for (let y = r.y0 + 24; y < r.y1; y += 24) { const a = P(r.x0 + 4, y), b = P(r.x1 - 4, y); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      if (r.lobby) {
        // bloco dos elevadores na parede do fundo: moldura das portas e o painel de botões
        const B = ELEV.block;
        g.fillStyle = light ? '#C9C1B5' : '#2A2A30'; g.fillRect(...rectW(B.x0, B.y0, B.x1, B.y1));
        g.fillStyle = light ? '#B3AA9C' : '#36363E'; g.fillRect(...rectW(B.x0, B.y1 - 4, B.x1, B.y1));
        for (const cx of ELEV.cars) {
          g.fillStyle = light ? '#8F877B' : '#52525B'; g.fillRect(...rectW(cx - ELEV.doorHalf - 4, ELEV.doorTop - 4, cx + ELEV.doorHalf + 4, B.y1));
          g.fillStyle = '#09090B'; g.fillRect(...rectW(cx - 13, B.y0 + 3, cx + 13, ELEV.doorTop - 6));
        }
        const bx = (ELEV.cars[0] + ELEV.cars[1]) / 2;
        g.fillStyle = light ? '#8F877B' : '#52525B'; g.fillRect(...rectW(bx - 4, 452, bx + 4, 476));
        // dicas de toque: subir e descer
        g.fillStyle = light ? '#57534E' : '#A1A1AA'; g.font = `600 ${Math.max(9, 11 * zk)}px system-ui`; g.textAlign = 'center';
        const up = view < floors.length - 1 ? '▲ sobe' : '', down = view > 0 ? '▼ desce' : '';
        if (portrait) { const c = P(985, 580); g.fillText([up, down].filter(Boolean).join('  '), c.x, c.y); }
        else { const c1 = P(985, 560), c2 = P(985, 600); if (up) g.fillText(up, c1.x, c1.y); if (down) g.fillText(down, c2.x, c2.y); }
      }
    }
    drawStaticDecor(g, f, P, zk);
    // bandeirinhas de festa junina no corredor (junho e julho)
    const mes = new Date().getMonth() + 1;
    if (mes === 6 || mes === 7) {
      const cols = ['#EF4444', '#FACC15', '#22C55E', '#3B82F6', '#F97316', '#A855F7'];
      for (let x = 50, i = 0; x < 1150; x += 26, i++) { const a = P(x, CORR.y0 + 6), b = P(x + 20, CORR.y0 + 6), c = P(x + 10, CORR.y0 + 20); g.fillStyle = cols[i % cols.length]; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.closePath(); g.fill(); }
    }
    g.strokeStyle = light ? '#57534E' : '#3F3F46'; g.lineWidth = Math.max(2, 5 * zk); g.lineCap = 'square';
    const line = (x0, y0, x1, y1) => { const a = P(x0, y0), b = P(x1, y1); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    line(30, 30, 1170, 30); line(1170, 30, 1170, 690); line(1170, 690, 30, 690); line(30, 690, 30, 30);
    for (const r of f.rooms) {
      const yWall = r.top ? CORR.y0 : CORR.y1;
      line(r.x0, yWall, r.door.x - 34, yWall); line(r.door.x + 34, yWall, r.x1, yWall);
      if (r.x0 > 30) line(r.x0, r.y0, r.x0, r.y1);
    }
    for (let x = 80; x < 1150; x += 140) {
      g.fillStyle = night ? 'rgba(250,204,21,.55)' : 'rgba(125,211,252,.7)';
      g.fillRect(...rectW(x, 26, x + 70, 34));
      g.fillRect(...rectW(x, 686, x + 70, 694));
    }
    g.textAlign = 'center'; g.font = `600 ${Math.max(9, 13 * zk)}px system-ui`;
    for (const r of f.rooms) {
      const c = P((r.x0 + r.x1) / 2, r.top ? r.y1 - 12 : r.y1 - 14);
      g.fillStyle = light ? 'rgba(41,43,50,.55)' : 'rgba(244,244,245,.38)';
      label(r.name.toUpperCase(), c.x, c.y, g);
    }
    const clk = P(600, (CORR.y0 + CORR.y1) / 2);
    g.fillStyle = light ? 'rgba(41,43,50,.35)' : 'rgba(244,244,245,.18)';
    g.font = `700 ${Math.max(10, 22 * zk)}px system-ui`;
    g.fillText(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), clk.x, clk.y + 8 * zk);
  }

  function drawFloor(t) {
    const f = floors[view];
    const now = new Date();
    const hour = now.getHours();
    const night = hour >= 19 || hour < 6;
    if (performance.now() > themeAt) { themeAt = performance.now() + 1000; light = getComputedStyle(root).getPropertyValue('--bg').trim().toUpperCase() === '#F0EEEB'; }
    const zk = k * zoom;
    // tela retina (celular, iPhone, Mac): desenha em pixels de verdade, não num canto pequeno
    const key = [view, floors.length, cw, ch, dpr, zoom.toFixed(3), cam.x.toFixed(1), cam.y.toFixed(1), light, night, portrait, now.getMinutes()].join('|');
    if (key !== bgKey) {
      bgKey = key;
      if (bg.width !== canvas.width || bg.height !== canvas.height) { bg.width = canvas.width; bg.height = canvas.height; }
      const g = bg.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStatic(g, f, night);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawElevators(t, zk);
    // móveis + pessoas, ordenados pela altura na tela
    const items = [];
    for (const r of f.rooms) for (const fu of r.furniture) if (fu.x != null && fu.t !== 'tapete' && fu.t !== 'arte') items.push({ sy: P(fu.x, fu.y + (fu.t.startsWith('mesa') ? 14 : 0)).y, draw: () => drawFurniture(ctx, fu, P, zk, t, night) });
    for (const p of people.values()) {
      if (p.floor !== view || p.inCar) continue;
      const s = P(p.x, p.y);
      p.sx = s.x; p.sy = s.y; p.scale = Math.max(0.55, 1.1 * zk);
      items.push({ sy: s.y, draw: () => drawPerson(ctx, p, t) });
    }
    if (pet.floor === view && !pet.inCar) { const s = P(pet.x, pet.y); pet.sx = s.x; pet.sy = s.y; pet.scale = Math.max(0.5, 1.1 * zk); items.push({ sy: s.y, draw: () => drawPet(ctx, pet, t) }); }
    items.sort((a, b) => a.sy - b.sy);
    for (const it of items) it.draw();
    // quadro de tarefas de cada sala do time: quem senta ali e no que está trabalhando
    if (f.kind === 'time' && zk > 0.45) {
      ctx.font = `600 ${Math.max(7, 8.5 * zk)}px system-ui`; ctx.fillStyle = '#18181B';
      for (const r of f.rooms.filter((x) => x.office)) {
        const lines = [...people.values()].filter((q) => q.target && q.target.floor === view && r.desks.some((d) => d.x === q.target.x && d.y === q.target.y)).map((q) => `${q.id}: ${q.info?.latest?.task ?? 'esperando ordem'}`);
        lines.slice(0, 2).forEach((txt, i) => { const a = P((r.x0 + r.x1) / 2, 39 + i * 10); let x = txt; while (ctx.measureText(x).width > 128 * zk && x.length > 6) x = x.slice(0, -2); label(x === txt ? x : x + '…', a.x, a.y); });
      }
    }
    // confete de quem terminou
    for (const c of confetti) { if (c.floor !== view) continue; const a = P(c.x, c.y); ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(c.r); ctx.globalAlpha = Math.min(1, c.life); ctx.fillStyle = c.c; ctx.fillRect(-3 * zk, -1.5 * zk, 6 * zk, 3 * zk); ctx.restore(); }
    // painel de aprovações e telão da reunião
    if (f.kind === 'diretoria') {
      const done = [...people.values()].filter((q) => q.mood === 'terminou').length;
      const tr = P(60, 222); ctx.font = `700 ${Math.max(8, 10 * zk)}px system-ui`; ctx.fillStyle = '#FACC15'; label(`${done} ✓ hoje`, tr.x, tr.y);
      const pa = P(1030, 45);
      ctx.font = `700 ${Math.max(9, 12 * zk)}px system-ui`; ctx.fillStyle = pending ? '#F87171' : '#4ADE80';
      label(pending ? `${pending} esperando você` : 'nada pendente', pa.x, pa.y + 4 * zk);
      const tl = P(605, 40);
      ctx.fillStyle = callData && callData.status !== 'ENCERRADA' ? '#FB923C' : '#71717A';
      label(callData && callData.status !== 'ENCERRADA' ? `● chamada: ${String(callData.topic ?? '').slice(0, 40)}` : 'sala livre', tl.x, tl.y + 4 * zk);
    }
    if (shown(pet) && pet.bubble && pet.bubble.until > performance.now()) drawTag({ ...pet, id: 'AgentC', mood: 'chamada', boss: false, info: null }, zk, t, true);
    // nomes, estado e balões por cima de tudo; etiquetas que se encostam descem uma linha
    const placed = [];
    ctx.font = `700 ${Math.max(9, 10.5 * Math.min(zk * 1.2, 1.4))}px system-ui`;
    // quem está na fila ou dentro do elevador não mostra o nome (vira um contador), a não ser o selecionado ou quem fala
    const quiet = (q) => (q.inCar || q.boardingCar || q.path[0]?.elevator) && selected !== q.id && !(q.bubble && q.bubble.until > performance.now());
    const queue = [...people.values()].filter((q) => q.floor === view && !q.inCar && (q.boardingCar || q.path[0]?.elevator)).length;
    if (queue) {
      const a = P(1078, 628), txt = `${queue} esperando o elevador`;
      ctx.font = `600 ${Math.max(9, 10 * Math.min(zk * 1.2, 1.4))}px system-ui`;
      const w = ctx.measureText(txt).width + 14;
      ctx.fillStyle = 'rgba(249,115,22,.92)'; rr(ctx, a.x - w / 2, a.y - 9, w, 18, 9); ctx.fill();
      ctx.fillStyle = '#0A0A0A'; ctx.textAlign = 'center'; ctx.fillText(txt, a.x, a.y + 4);
    }
    ctx.font = `700 ${Math.max(9, 10.5 * Math.min(zk * 1.2, 1.4))}px system-ui`;
    for (const p of [...people.values()].filter((q) => shown(q) && !quiet(q)).sort((a, b) => a.sy - b.sy)) {
      const w = ctx.measureText(p.boss ? 'VOCÊ · chefe' : p.id).width + 16;
      let y = p.sy + 6;
      while (placed.some((r) => Math.abs(r.x - p.sx) < (r.w + w) / 2 + 2 && Math.abs(r.y - y) < 17)) y += 17;
      placed.push({ x: p.sx, y, w });
      p.tagY = y;
      drawTag(p, zk, t);
    }
    if (night) { ctx.fillStyle = 'rgba(10,15,40,.18)'; ctx.fillRect(0, 0, cw, ch); }
  }

  /** Está à vista neste andar? Quem está na cabine só aparece com a porta aberta. */
  function shown(o) {
    if (o.floor !== view) return false;
    return !o.inCar || (near(o.inCar.pos, view) && o.inCar.door > 0.3);
  }

  /** Portas de correr, cabine (com quem está dentro), visor do andar e botão de chamada. */
  function drawElevators(t, zk) {
    const B = ELEV.block;
    for (const c of elev.cars) {
      const open = near(c.pos, view) ? c.door : 0;
      const x0 = c.x - ELEV.doorHalf, x1 = c.x + ELEV.doorHalf, y0 = ELEV.doorTop, y1 = B.y1;
      if (open > 0.01) {
        ctx.save();
        ctx.beginPath(); ctx.rect(...rectW(c.x - ELEV.doorHalf * open, y0, c.x + ELEV.doorHalf * open, y1)); ctx.clip();
        ctx.fillStyle = light ? '#A8A29E' : '#3B3B44'; ctx.fillRect(...rectW(x0, y0, x1, y1));
        ctx.fillStyle = light ? '#78716C' : '#26262B'; ctx.fillRect(...rectW(x0, y1 - 14, x1, y1));
        ctx.fillStyle = 'rgba(250,204,21,.35)'; ctx.fillRect(...rectW(x0 + 6, y0 + 2, x1 - 6, y0 + 5));
        for (const r of [...c.riders].sort((a, b) => a.o.y - b.o.y)) {
          const o = r.o, s = P(o.x, o.y);
          o.sx = s.x; o.sy = s.y;
          if (o.pet) { o.scale = Math.max(0.5, 1.1 * zk); drawPet(ctx, o, t); } else { o.scale = Math.max(0.55, 1.1 * zk); drawPerson(ctx, o, t); }
        }
        ctx.restore();
      }
      const w = ELEV.doorHalf * (1 - open);
      if (w > 0.2) {
        ctx.fillStyle = light ? '#D6D3D1' : '#A1A1AA'; ctx.fillRect(...rectW(x0, y0, x0 + w, y1));
        ctx.fillStyle = light ? '#E7E5E4' : '#B4B4BC'; ctx.fillRect(...rectW(x1 - w, y0, x1, y1));
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(...rectW(x0 + w * 0.3, y0 + 4, x0 + w * 0.3 + 3, y1 - 6)); ctx.fillRect(...rectW(x1 - w * 0.7, y0 + 4, x1 - w * 0.7 + 3, y1 - 6));
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(...rectW(x0 + w - 1, y0, x0 + w, y1)); ctx.fillRect(...rectW(x1 - w, y0, x1 - w + 1, y1));
      }
      // visor: andar onde a cabine está e a seta enquanto anda
      const fl = Math.round(c.pos);
      const txt = (c.state === 'moving' ? (c.dir > 0 ? '▲' : '▼') : '') + (fl === 0 ? 'T' : String(fl));
      const d = P(c.x, (B.y0 + 3 + ELEV.doorTop - 6) / 2 + 0.5);
      ctx.font = `700 ${Math.max(7, 9.5 * zk)}px ui-monospace, SFMono-Regular, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = c.state === 'moving' ? '#FB923C' : '#4ADE80';
      ctx.fillText(txt, d.x, d.y);
      ctx.textBaseline = 'alphabetic';
    }
    // botão de chamada: acende quando alguém espera neste andar
    const bx = (ELEV.cars[0] + ELEV.cars[1]) / 2, lit = elev.calls.has(view);
    for (const [y, on] of [[459, lit && view < floors.length - 1], [469, lit && view > 0]]) {
      const a = P(bx, y);
      ctx.fillStyle = on ? '#FB923C' : (light ? '#E7E5E4' : '#71717A');
      ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(1.5, 2.4 * zk), 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTag(p, zk, t, petOnly = false) {
    const s = p.scale;
    const name = p.boss ? 'VOCÊ · chefe' : p.id;
    if (petOnly) {
      const hy = p.sy - 34 * s;
      ctx.font = `500 ${Math.max(10, 11 * Math.min(zk * 1.2, 1.4))}px system-ui`;
      const bw = ctx.measureText(p.bubble.text).width + 18, bx = Math.max(4, Math.min(cw - bw - 4, p.sx - bw / 2));
      ctx.fillStyle = 'rgba(253,186,116,.97)'; rr(ctx, bx, hy - 26, bw, 22, 10); ctx.fill();
      ctx.fillStyle = '#18181B'; ctx.textAlign = 'left'; ctx.fillText(p.bubble.text, bx + 9, hy - 11);
      return;
    }
    ctx.font = `700 ${Math.max(9, 10.5 * Math.min(zk * 1.2, 1.4))}px system-ui`;
    const w = ctx.measureText(name).width + 16;
    const x = p.sx - w / 2, y = p.tagY ?? p.sy + 6;
    ctx.fillStyle = selected === p.id ? 'rgba(249,115,22,.95)' : 'rgba(9,9,11,.82)';
    rr(ctx, x, y, w, 16, 8); ctx.fill();
    ctx.fillStyle = STATUS_COLOR[p.mood] ?? '#71717A';
    ctx.beginPath(); ctx.arc(x + 8, y + 8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FAFAFA'; ctx.textAlign = 'left';
    ctx.fillText(name, x + 13, y + 12);
    // ícone acima da cabeça
    const hy = p.sy - 74 * s;
    let icon = null;
    if (p.mood === 'travado') icon = Math.sin(t * 6) > -0.3 ? '!' : null;
    else if (p.mood === 'parado' && p.sit) icon = 'z'.repeat(1 + (Math.floor(t * 1.5) % 3));
    else if (p.typing) icon = '.'.repeat(1 + (Math.floor(t * 3) % 3));
    else if (p.celebrate > 0) icon = '✓';
    if (p.bubble && p.bubble.until > performance.now()) {
      ctx.font = `500 ${Math.max(10, 11 * Math.min(zk * 1.2, 1.4))}px system-ui`;
      const text = p.bubble.text;
      const bw = Math.min(220, ctx.measureText(text).width + 18);
      const bx = Math.max(4, Math.min(cw - bw - 4, p.sx - bw / 2)), by = hy - 26;
      ctx.fillStyle = 'rgba(250,250,250,.96)'; rr(ctx, bx, by, bw, 22, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.sx - 5, by + 22); ctx.lineTo(p.sx + 5, by + 22); ctx.lineTo(p.sx, by + 29); ctx.fill();
      ctx.fillStyle = '#18181B'; ctx.textAlign = 'left';
      let tx = text; while (ctx.measureText(tx).width > bw - 18 && tx.length > 4) tx = tx.slice(0, -2);
      ctx.fillText(tx === text ? tx : tx + '…', bx + 9, by + 15);
    } else if (icon) {
      ctx.font = `800 ${Math.max(11, 14 * Math.min(zk * 1.2, 1.4))}px system-ui`; ctx.textAlign = 'center';
      ctx.fillStyle = p.mood === 'travado' ? '#EF4444' : p.celebrate > 0 ? '#22C55E' : '#A1A1AA';
      ctx.fillText(icon, p.sx + (icon.startsWith('z') ? 10 : 0), hy);
    }
  }

  function frame(ts) {
    if (!running) return;
    // 30 quadros por segundo bastam para bonequinhos: metade do trabalho da CPU/bateria
    if (ts - lastDraw < 32) { requestAnimationFrame(frame); return; }
    lastDraw = ts;
    const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
    last = ts;
    const t = ts / 1000;
    wander(ts);
    elev.step(reduce ? Math.min(1, dt * 4) : dt);
    stepConfetti(reduce ? 0 : dt);
    stepPet(reduce ? 0 : dt, ts);
    for (const p of people.values()) {
      step(p, reduce ? 1 : dt, ts);
      p.blink = (t + p.phase) % 4 < 0.12;
    }
    if (follow) { const p = people.get(follow); if (p) { if (p.floor !== view) { view = p.floor; renderFloors(); } if (zoom > 1) { cam.x = p.x - W / 2; cam.y = p.y - H / 2; clampCam(); } } }
    drawFloor(t);
    requestAnimationFrame(frame);
  }

  // ---------- toque, arrastar, zoom ----------
  let drag = null; const touches = new Map(); let pinch = null;
  canvas.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } });
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); return; }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (zoom > 1 && drag.moved) { const ddx = portrait ? dy : dx, ddy = portrait ? dx : dy; cam.x = drag.cx - ddx / (k * zoom); cam.y = drag.cy - ddy / (k * zoom); clampCam(); follow = null; }
  });
  const up = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && !drag.moved && touches.size === 0) click(e);
    if (touches.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey && !root.classList.contains('full')) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); goFloor(view + 1); }
    if (e.key === 'PageDown' || e.key === 'ArrowDown') { e.preventDefault(); goFloor(view - 1); }
    if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
    if (e.key === '-') setZoom(zoom / 1.25);
    if (e.key === 'Escape') closeCard();
  });

  function click(e) {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    let hit = null, best = 1e9;
    for (const p of people.values()) {
      if (!shown(p)) continue;
      const d = Math.hypot(sx - p.sx, sy - (p.sy - 30 * p.scale));
      if (d < 30 * Math.max(1, p.scale) && d < best) { best = d; hit = p; }
    }
    if (hit) return openCard(hit);
    if (shown(pet) && Math.hypot(sx - pet.sx, sy - (pet.sy - 10 * pet.scale)) < 22 * Math.max(1, pet.scale)) {
      const frases = ['Oi! Eu sou o AgentC 🤖', 'Cuido do time pra você.', 'Psiu: tem café na copa ☕', 'Todo mundo trabalhando!', 'Me faz cócegas não! 😆'];
      pet.bubble = { text: frases[Math.floor(Math.random() * frases.length)], until: performance.now() + 3500 };
      pet.restUntil = performance.now() + 3500;
      if (!pet.inCar) { leaveQueue(pet); pet.path = []; }
      return;
    }
    // tocar na sala do elevador sobe (perto das portas) ou desce (perto do banco)
    const w = unP(sx, sy);
    if (w.x > LOBBY.x0 && w.y > LOBBY.y0) { goFloor(w.y < 580 ? view + 1 : view - 1); return; }
    closeCard();
  }

  function closeCard() { card.hidden = true; selected = null; }
  function openCard(p) {
    selected = p.id;
    card.replaceChildren();
    const h = el('div', 'predio-card-h');
    const dot = el('i'); dot.style.background = STATUS_COLOR[p.mood];
    h.append(dot, el('b', null, p.boss ? 'Você (chefe)' : p.id), el('span', null, STATUS_LABEL[p.mood] ?? p.mood));
    const x = el('button', 'predio-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar'); x.addEventListener('click', closeCard); h.append(x);
    card.append(h);
    const a = p.info;
    const dl = el('dl');
    const row = (k2, v) => { if (v) dl.append(el('dt', null, k2), el('dd', null, v)); };
    row('andar', floors[p.floor]?.name);
    row('tarefa', a?.latest?.task);
    row('status', a?.latest?.status);
    row('modelo', a?.model ?? a?.latest?.model);
    row('última fala', p.lastSaid);
    if (p.boss) row('aprovações', pending ? `${pending} esperando você` : 'nenhuma');
    card.append(dl);
    const acts = el('div', 'predio-acts');
    const b1 = el('button', 'btn', follow === p.id ? 'Parar de seguir' : 'Seguir'); b1.type = 'button';
    b1.addEventListener('click', () => { follow = follow === p.id ? null : p.id; if (follow && zoom === 1) setZoom(1.8); openCard(p); });
    acts.append(b1);
    if (!p.boss && hooks.sendCommand) {
      const f = el('form', 'predio-order');
      const inp = el('input'); inp.maxLength = 1000; inp.placeholder = `Ordem para ${p.id}…`; inp.setAttribute('aria-label', `Ordem para ${p.id}`);
      const go = el('button', 'primary', 'Mandar'); go.type = 'submit';
      const msg = el('small', 'predio-msg');
      f.append(inp, go);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const text = inp.value.trim(); if (!text) return;
        go.disabled = true;
        try { msg.textContent = await hooks.sendCommand(p.id, text); inp.value = ''; p.bubble = { text: 'Ok, chefe! 👍', until: performance.now() + 4000 }; }
        catch (err) { msg.textContent = `Não enviei: ${err.message}`; }
        finally { go.disabled = false; }
      });
      card.append(f, msg);
    }
    if (p.boss && hooks.openApprovals) { const b2 = el('button', 'btn', 'Ver aprovações'); b2.type = 'button'; b2.addEventListener('click', hooks.openApprovals); acts.append(b2); }
    card.append(acts);
    card.hidden = false;
  }

  function describe() {
    sr.replaceChildren();
    for (const p of people.values()) sr.append(el('li', null, `${p.boss ? 'Você' : p.id}: ${STATUS_LABEL[p.mood] ?? p.mood}, ${floors[p.floor]?.name ?? ''}`));
  }

  const ro = new ResizeObserver(() => { if (running) resize(); });
  ro.observe(stage);
  document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else if (root.getClientRects().length) api.show(); });

  const api = {
    /** Estado vindo de /api/state: cria/atualiza os bonequinhos e manda cada um para o lugar certo. */
    update(s) {
      ensure('VOCÊ', true);
      const ids = new Set(s.agents.map((a) => a.id));
      for (const id of [...people.keys()]) if (id !== 'VOCÊ' && !ids.has(id)) { people.delete(id); release(id); }
      for (const a of s.agents) ensure(a.id).info = a;
      const need = 3 + Math.max(1, Math.ceil(s.agents.length / PER_FLOOR)) - 1;
      if (floors.length !== need) {
        floors = [makeFloor('terreo', 0), makeFloor('diretoria', 1)];
        for (let n = 2; n < need; n++) floors.push(makeFloor('time', n));
        if (view >= floors.length) view = floors.length - 1;
        elev.setFloors(floors.length);
        for (const c of elev.cars) for (const r of c.riders) if (r.to >= floors.length) { r.to = floors.length - 1; c.stops.add(r.to); }
        for (const p of people.values()) if (p.floor >= floors.length && !p.inCar) { leaveQueue(p); p.floor = 0; p.x = 175; p.y = 250; p.path = []; p.target = null; }
      }
      placeAll();
    },
    /** Falas novas da sala viram balão em cima do bonequinho. */
    chat(entries) {
      for (const e of entries ?? []) {
        const id = e.agent === 'USUARIO' || e.agent === 'DONO' ? 'VOCÊ' : e.agent;
        const p = people.get(id); if (!p) continue;
        const text = String(e.body ?? e.heading ?? '').replace(/^\s*-\s*(para|assunto|via)\s*:.*$/gim, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        p.lastSaid = text.slice(0, 140);
        p.bubble = { text: text.slice(0, 80), until: performance.now() + 7000 };
      }
    },
    call(c) { callData = c; if (people.size) placeAll(); },
    pending(n) { pending = n; },
    show() { if (running) return; running = true; last = 0; resize(); renderFloors(); requestAnimationFrame(frame); },
    hide() { running = false; },
    get floors() { return floors; },
    get people() { return people; },
  };
  return api;
}
