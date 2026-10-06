// Modo Prédio: cada agente vira um bonequinho que anda pelos andares do escritório.
// Cada tela é um andar (Térreo, Diretoria e os andares do time). O chefe (você) usa terno com gravata vermelha;
// os agentes usam roupa comum (camiseta, calça e tênis) sorteada pelo nome. Onde cada um vai depende do estado real:
// trabalhando → mesa; travado ou esperando aprovação → sala do chefe; terminou → copa; parado → descanso;
// na chamada → sala de reunião. Só canvas e textContent: nada que vem dos agentes vira HTML.

const W = 1200, H = 720;
const CORR = { y0: 310, y1: 410 };
const TOP = [[30, 320], [320, 610], [610, 890], [890, 1170]];
const BOTTOM = [[30, 330], [330, 640], [640, 940]];
const STAIRS = { x0: 940, x1: 1170, y0: 410, y1: 690 };
const PER_FLOOR = 8; // 4 salas × 2 mesas
const SPEED = 95; // px/s no mundo

// ---------- sorteio estável pelo nome ----------
function seedOf(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

const SKIN = ['#F5D0B5', '#E8B894', '#D49A6A', '#B97A4F', '#8D5A3B', '#6B4026'];
const HAIR = ['#1F1A17', '#3B2A20', '#6B4423', '#A0522D', '#D6B370', '#E5E5E5', '#B45309', '#7C3AED'];
const SHIRT = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1', '#A855F7', '#EC4899', '#F4F4F5', '#27272A', '#0EA5E9'];
const PANTS = ['#1E3A8A', '#1E40AF', '#27272A', '#52525B', '#A16207', '#3F3F46', '#334155'];
const SHOES = ['#F4F4F5', '#EF4444', '#22C55E', '#3B82F6', '#111111', '#F97316', '#A855F7'];
const HAIRSTYLE = ['curto', 'longo', 'careca', 'bone', 'coque', 'topete'];

export function lookFor(name, boss = false, salt = 0) {
  const r = rng(seedOf(name) + salt * 7919);
  if (boss) return { boss: true, skin: pick(r, SKIN), hair: pick(r, HAIR.slice(0, 6)), style: pick(r, ['curto', 'topete', 'careca']), shirt: '#F4F4F5', jacket: '#1E293B', pants: '#1E293B', shoes: '#111111', tie: '#DC2626' };
  return { boss: false, skin: pick(r, SKIN), hair: pick(r, HAIR), style: pick(r, HAIRSTYLE), shirt: pick(r, SHIRT), pants: pick(r, PANTS), shoes: pick(r, SHOES), cap: pick(r, SHIRT) };
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
  const stairs = { name: 'Escada', ...STAIRS, top: false, door: { x: (STAIRS.x0 + STAIRS.x1) / 2, y: CORR.y1 }, spots: [], furniture: [{ t: 'stairs' }], stairs: true };
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
    f.rooms = [rec, copa, desc, jogos, jardim, banh, corr, stairs];
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
    f.rooms = [chefe, reun, aprov, sec, lounge, arq, stairs];
  } else {
    f.name = `${n}º andar · Time`;
    const offices = TOP.map(([a, b], i) => {
      const r = room(`Sala ${n}${String.fromCharCode(65 + i)}`, a, b, true);
      const desks = seats(r, 2, 120);
      for (const d of desks) r.furniture.push({ t: 'mesaPc', x: d.x, y: d.y + 12 });
      r.furniture.push({ t: 'planta', x: b - 25, y: 55 });
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
    f.rooms = [...offices, copa, foco, imp, stairs];
  }
  return f;
}

function roomAt(f, x, y) { return f.rooms.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) ?? null; }
const inside = (r) => ({ x: r.door.x, y: r.top ? r.door.y - 26 : r.door.y + 26 });
const corridorAt = (x, lane) => ({ x, y: (CORR.y0 + CORR.y1) / 2 + lane });

/** Caminho de um ponto a outro, passando pela porta, pelo corredor e, se mudar de andar, pela escada. */
export function route(floors, from, to, lane = 0) {
  const pts = [];
  const fa = floors[from.floor], fb = floors[to.floor];
  const ra = fa && roomAt(fa, from.x, from.y), rb = fb && roomAt(fb, to.x, to.y);
  if (!fa || !fb) return [{ ...to }];
  const sameRoom = from.floor === to.floor && ra && ra === rb;
  if (!sameRoom) {
    if (ra) pts.push({ floor: from.floor, ...inside(ra) }, { floor: from.floor, ...corridorAt(ra.door.x, lane) });
    if (from.floor !== to.floor) {
      const sa = fa.rooms.find((r) => r.stairs), sb = fb.rooms.find((r) => r.stairs);
      pts.push({ floor: from.floor, ...corridorAt(sa.door.x, lane) }, { floor: from.floor, ...inside(sa) }, { floor: from.floor, x: (sa.x0 + sa.x1) / 2, y: 600 });
      pts.push({ floor: to.floor, x: (sb.x0 + sb.x1) / 2, y: 600, jump: true }, { floor: to.floor, ...inside(sb) }, { floor: to.floor, ...corridorAt(sb.door.x, lane) });
    }
    if (rb) pts.push({ floor: to.floor, ...corridorAt(rb.door.x, lane) }, { floor: to.floor, ...inside(rb) });
  }
  pts.push({ floor: to.floor, x: to.x, y: to.y });
  return pts;
}

// ---------- desenho ----------
const STATUS_COLOR = { trabalhando: '#22C55E', revisando: '#F59E0B', travado: '#EF4444', terminou: '#38BDF8', parado: '#71717A', chefe: '#DC2626', chamada: '#F97316' };
const STATUS_LABEL = { trabalhando: 'trabalhando', revisando: 'revisando', travado: 'travado / esperando você', terminou: 'terminou', parado: 'parado', chefe: 'chefe (você)', chamada: 'na chamada' };

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

export function drawPerson(ctx, p, t) {
  const L = p.look;
  const walk = p.moving ? Math.sin(t * 12 + p.phase) : 0;
  const bob = p.moving ? Math.abs(walk) * 1.6 : p.celebrate > 0 ? Math.abs(Math.sin(t * 10)) * 10 : 0;
  const sit = !p.moving && p.sit;
  const sleep = p.mood === 'parado' && sit;
  ctx.save();
  ctx.translate(p.sx, p.sy);
  ctx.scale(p.scale, p.scale);
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(0, 0, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -bob - (sit ? 6 : 0));
  // pernas (calça) e tênis
  const legY = -17, legH = sit ? 9 : 16;
  for (const side of [-1, 1]) {
    const off = p.moving ? walk * 3.5 * side : 0;
    ctx.fillStyle = L.pants;
    rr(ctx, side * 4.5 - 3 + off * 0.4, legY, 6, legH, 2); ctx.fill();
    ctx.fillStyle = L.shoes;
    rr(ctx, side * 4.5 - 3.5 + off * 0.4 + (p.face < 0 ? -1.5 : 1.5), legY + legH - 2, 8, 4.5, 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(side * 4.5 - 3.5 + off * 0.4 + (p.face < 0 ? -1.5 : 1.5), legY + legH + 1.6, 8, 1);
  }
  // tronco
  if (L.boss) {
    ctx.fillStyle = L.jacket; rr(ctx, -9, -34, 18, 19, 4); ctx.fill();
    ctx.fillStyle = L.shirt; ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(4, -34); ctx.lineTo(0, -24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = L.tie; ctx.beginPath(); ctx.moveTo(-1.6, -33); ctx.lineTo(1.6, -33); ctx.lineTo(2.4, -22); ctx.lineTo(0, -19); ctx.lineTo(-2.4, -22); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = L.shirt; rr(ctx, -8.5, -34, 17, 18, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(-8.5, -19, 17, 3);
  }
  // braços
  const arm = p.moving ? walk * 5 : p.typing ? Math.sin(t * 22) * 1.5 : 0;
  ctx.strokeStyle = L.boss ? L.jacket : L.shirt; ctx.lineWidth = 4.2; ctx.lineCap = 'round';
  const armUp = p.celebrate > 0 ? -14 : 0;
  ctx.beginPath(); ctx.moveTo(-9, -31); ctx.lineTo(-11 - arm * 0.3, -21 + arm + armUp); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, -31); ctx.lineTo(11 - arm * 0.3, -21 - arm + armUp); ctx.stroke();
  ctx.fillStyle = L.skin;
  ctx.beginPath(); ctx.arc(-11 - arm * 0.3, -20 + arm + armUp, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11 - arm * 0.3, -20 - arm + armUp, 2.3, 0, Math.PI * 2); ctx.fill();
  // cabeça
  ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(0, -43, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = L.hair;
  switch (L.style) {
    case 'careca': break;
    case 'longo': ctx.beginPath(); ctx.arc(0, -45, 9.6, Math.PI, 0); ctx.fill(); ctx.fillRect(-9.6, -45, 3.2, 12); ctx.fillRect(6.4, -45, 3.2, 12); break;
    case 'bone': ctx.fillStyle = L.cap; ctx.beginPath(); ctx.arc(0, -45, 9.4, Math.PI, 0); ctx.fill(); ctx.fillRect(p.face < 0 ? -15 : 3, -46, 12, 3); break;
    case 'coque': ctx.beginPath(); ctx.arc(0, -45, 9.4, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.arc(0, -55, 4.5, 0, Math.PI * 2); ctx.fill(); break;
    case 'topete': ctx.beginPath(); ctx.arc(0, -45, 9.4, Math.PI, 0); ctx.fill(); ctx.beginPath(); ctx.ellipse(p.face * 3, -53, 6, 3.5, p.face * 0.4, 0, Math.PI * 2); ctx.fill(); break;
    default: ctx.beginPath(); ctx.arc(0, -45, 9.4, Math.PI * 1.02, -0.02); ctx.fill();
  }
  // rosto
  ctx.fillStyle = '#18181B';
  if (sleep) { ctx.fillRect(-5 + p.face, -43, 3.5, 1.2); ctx.fillRect(1.5 + p.face, -43, 3.5, 1.2); }
  else if (!p.blink) { ctx.fillRect(-4 + p.face * 1.6, -45, 2, 3); ctx.fillRect(2 + p.face * 1.6, -45, 2, 3); }
  if (p.mood === 'travado') { ctx.fillRect(-2 + p.face, -38.5, 4, 1.2); }
  else { ctx.beginPath(); ctx.arc(p.face * 1.2, -40, 2.4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.strokeStyle = '#18181B'; ctx.lineWidth = 1; ctx.stroke(); }
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
    case 'stairs': break;
  }
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
      const stairs = floors[0].rooms.find((r) => r.stairs);
      p = { id, boss, look: lookFor(id, boss, salt), floor: 0, x: (stairs.x0 + stairs.x1) / 2, y: 600, path: [], moving: false, face: 1, phase: Math.random() * 6, lane: (Math.random() - 0.5) * 30, mood: 'parado', sit: false, typing: false, blink: false, bubble: null, celebrate: 0, wanderAt: 0, target: null, info: null, scale: 1, sx: 0, sy: 0 };
      people.set(id, p);
    }
    return p;
  }

  function goTo(p, target) {
    if (p.target && p.target.floor === target.floor && Math.hypot(p.target.x - target.x, p.target.y - target.y) < 2) return;
    p.target = target;
    p.path = route(floors, { floor: p.floor, x: p.x, y: p.y }, target, p.lane);
    p.sit = false;
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
      p.mood = moodOf(p.info);
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
    let i = 0;
    for (const p of people.values()) {
      if (p.boss) continue;
      const idx = i++;
      if (p.path.length || now < p.wanderAt || p.mood === 'chamada' || p.mood === 'travado') continue;
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
    if (!p.path.length) {
      p.moving = false;
      if (p.back && now > (p.backAt ?? Infinity)) { const b = p.back; p.back = null; p.backAt = null; goTo(p, b); return; }
      if (p.back && !p.backAt) p.backAt = now + 6000 + Math.random() * 6000;
      const r = roomAt(floors[p.floor], p.x, p.y);
      p.sit = !!(r && (r.desks?.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 3) || r.spots.some((s) => s.sit && Math.hypot(s.x - p.x, s.y - p.y) < 3)));
      p.typing = p.sit && (p.mood === 'trabalhando' || p.mood === 'revisando') && !p.back;
      if (p.mood === 'travado' || p.boss) p.face = p.boss ? 1 : -1;
      return;
    }
    const n = p.path[0];
    if (n.floor !== p.floor) { p.floor = n.floor; p.x = n.x; p.y = n.y; p.path.shift(); renderFloors(); return; }
    const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
    const v = SPEED * (p.boss ? 0.85 : 1) * dt;
    p.moving = true;
    if (Math.abs(dx) > 0.5) p.face = dx < 0 ? -1 : 1;
    if (d <= v) {
      p.x = n.x; p.y = n.y; p.path.shift();
      if (!p.path.length && p.mood === 'terminou') p.celebrate = 1.6;
    } else { p.x += (dx / d) * v; p.y += (dy / d) * v; }
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
  function label(text, x, y) {
    const w = ctx.measureText(text).width;
    ctx.textAlign = 'center';
    ctx.fillText(text, Math.max(w / 2 + 4, Math.min(cw - w / 2 - 4, x)), Math.max(12, Math.min(ch - 4, y)));
  }

  function drawFloor(t) {
    const f = floors[view];
    const hour = new Date().getHours();
    const night = hour >= 19 || hour < 6;
    const css = getComputedStyle(root);
    const light = css.getPropertyValue('--bg').trim().toUpperCase() === '#F0EEEB';
    ctx.fillStyle = light ? '#D9D4CC' : '#0B0B0C';
    ctx.fillRect(0, 0, cw, ch);
    const zk = k * zoom;
    // chão do prédio
    ctx.fillStyle = light ? '#ECE7E0' : '#17171A';
    ctx.fillRect(...rectW(30, 30, 1170, 690));
    // corredor
    ctx.fillStyle = light ? '#E2DCD3' : '#1F1F23';
    ctx.fillRect(...rectW(30, CORR.y0, 1170, CORR.y1));
    ctx.strokeStyle = light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)'; ctx.lineWidth = 1;
    for (let x = 60; x < 1170; x += 60) { const a = P(x, CORR.y0 + 8), b = P(x, CORR.y1 - 8); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (const r of f.rooms) {
      ctx.fillStyle = r.green ? (light ? '#BBE5C4' : '#132A1A') : r.stairs ? (light ? '#D6D0C6' : '#141416') : r.boss ? (light ? '#E9DCCB' : '#1E1914') : r.meeting ? (light ? '#E3E0EE' : '#16151F') : (light ? '#F3EEE7' : '#151518');
      ctx.fillRect(...rectW(r.x0 + 3, r.y0 + 3, r.x1 - 3, r.y1 - 3));
      // piso de madeira/carpete: linhas leves
      ctx.strokeStyle = light ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.025)';
      for (let y = r.y0 + 24; y < r.y1; y += 24) { const a = P(r.x0 + 4, y), b = P(r.x1 - 4, y); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      if (r.stairs) {
        ctx.fillStyle = light ? '#BFB6A8' : '#26262B';
        for (let y = r.y0 + 40; y < r.y1 - 10; y += 22) ctx.fillRect(...rectW(r.x0 + 30, y, r.x1 - 30, y + 12));
        const c = P((r.x0 + r.x1) / 2, r.y1 - 30);
        ctx.fillStyle = light ? '#57534E' : '#A1A1AA'; ctx.font = `600 ${Math.max(9, 12 * zk)}px system-ui`; ctx.textAlign = 'center';
        ctx.fillText(view < floors.length - 1 ? '▲ sobe' : '', c.x, c.y - 14 * zk);
        ctx.fillText(view > 0 ? '▼ desce' : '', c.x, c.y + 2 * zk);
      }
    }
    // paredes com portas
    ctx.strokeStyle = light ? '#57534E' : '#3F3F46'; ctx.lineWidth = Math.max(2, 5 * zk); ctx.lineCap = 'square';
    const line = (x0, y0, x1, y1) => { const a = P(x0, y0), b = P(x1, y1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    line(30, 30, 1170, 30); line(1170, 30, 1170, 690); line(1170, 690, 30, 690); line(30, 690, 30, 30);
    for (const r of f.rooms) {
      const yWall = r.top ? CORR.y0 : CORR.y1;
      line(r.x0, yWall, r.door.x - 34, yWall); line(r.door.x + 34, yWall, r.x1, yWall);
      if (r.x0 > 30) line(r.x0, r.y0, r.x0, r.y1);
    }
    // janelas (dia/noite) na parede de fora
    for (let x = 80; x < 1150; x += 140) {
      ctx.fillStyle = night ? 'rgba(250,204,21,.55)' : 'rgba(125,211,252,.7)';
      ctx.fillRect(...rectW(x, 26, x + 70, 34));
      ctx.fillRect(...rectW(x, 686, x + 70, 694));
    }
    // nomes das salas
    ctx.textAlign = 'center'; ctx.font = `600 ${Math.max(9, 13 * zk)}px system-ui`;
    for (const r of f.rooms) {
      const c = P(r.stairs ? (r.x0 + r.x1) / 2 : r.x0 + (r.x1 - r.x0) * (r.top ? 0.5 : 0.5), r.top ? r.y1 - 12 : r.y1 - 14);
      ctx.fillStyle = light ? 'rgba(41,43,50,.55)' : 'rgba(244,244,245,.38)';
      label(r.name.toUpperCase(), c.x, c.y);
    }
    // relógio no corredor
    const clk = P(600, (CORR.y0 + CORR.y1) / 2);
    ctx.fillStyle = light ? 'rgba(41,43,50,.35)' : 'rgba(244,244,245,.18)';
    ctx.font = `700 ${Math.max(10, 22 * zk)}px system-ui`;
    ctx.fillText(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), clk.x, clk.y + 8 * zk);
    // móveis + pessoas, ordenados pela altura na tela
    const items = [];
    for (const r of f.rooms) for (const fu of r.furniture) if (fu.x != null) items.push({ sy: P(fu.x, fu.y + (fu.t.startsWith('mesa') ? 14 : 0)).y, draw: () => drawFurniture(ctx, fu, P, zk, t, night) });
    for (const p of people.values()) {
      if (p.floor !== view) continue;
      const s = P(p.x, p.y);
      p.sx = s.x; p.sy = s.y; p.scale = Math.max(0.55, 1.25 * zk);
      items.push({ sy: s.y, draw: () => drawPerson(ctx, p, t) });
    }
    items.sort((a, b) => a.sy - b.sy);
    for (const it of items) it.draw();
    // painel de aprovações e telão da reunião
    if (f.kind === 'diretoria') {
      const pa = P(1030, 45);
      ctx.font = `700 ${Math.max(9, 12 * zk)}px system-ui`; ctx.fillStyle = pending ? '#F87171' : '#4ADE80';
      label(pending ? `${pending} esperando você` : 'nada pendente', pa.x, pa.y + 4 * zk);
      const tl = P(605, 40);
      ctx.fillStyle = callData && callData.status !== 'ENCERRADA' ? '#FB923C' : '#71717A';
      label(callData && callData.status !== 'ENCERRADA' ? `● chamada: ${String(callData.topic ?? '').slice(0, 40)}` : 'sala livre', tl.x, tl.y + 4 * zk);
    }
    // nomes, estado e balões por cima de tudo
    for (const p of people.values()) {
      if (p.floor !== view) continue;
      drawTag(p, zk, t);
    }
    if (night) { ctx.fillStyle = 'rgba(10,15,40,.18)'; ctx.fillRect(0, 0, cw, ch); }
  }

  function drawTag(p, zk, t) {
    const s = p.scale;
    const name = p.boss ? 'VOCÊ · chefe' : p.id;
    ctx.font = `700 ${Math.max(9, 10.5 * Math.min(zk * 1.2, 1.4))}px system-ui`;
    const w = ctx.measureText(name).width + 16;
    const x = p.sx - w / 2, y = p.sy + 6;
    ctx.fillStyle = selected === p.id ? 'rgba(249,115,22,.95)' : 'rgba(9,9,11,.82)';
    rr(ctx, x, y, w, 16, 8); ctx.fill();
    ctx.fillStyle = STATUS_COLOR[p.mood] ?? '#71717A';
    ctx.beginPath(); ctx.arc(x + 8, y + 8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FAFAFA'; ctx.textAlign = 'left';
    ctx.fillText(name, x + 13, y + 12);
    // ícone acima da cabeça
    const hy = p.sy - 64 * s;
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
    const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
    last = ts;
    const t = ts / 1000;
    wander(ts);
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
      if (p.floor !== view) continue;
      const d = Math.hypot(sx - p.sx, sy - (p.sy - 25 * p.scale));
      if (d < 30 * Math.max(1, p.scale) && d < best) { best = d; hit = p; }
    }
    if (hit) return openCard(hit);
    // tocar na escada sobe ou desce
    const w = unP(sx, sy);
    if (w.x > STAIRS.x0 && w.y > STAIRS.y0) { goFloor(w.y < 560 ? view + 1 : view - 1); return; }
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
        for (const p of people.values()) if (p.floor >= floors.length) { p.floor = 0; p.path = []; }
      }
      placeAll();
    },
    /** Falas novas da sala viram balão em cima do bonequinho. */
    chat(entries) {
      for (const e of entries ?? []) {
        const id = e.agent === 'DONO' || e.agent === 'DONO' ? 'VOCÊ' : e.agent;
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
