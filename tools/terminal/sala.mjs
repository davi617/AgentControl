#!/usr/bin/env node
// Agent Control no terminal: a salinha dos agentes com a caixinha de fala do AgentC. Sem dependências, só Node 18+.
// Roda em qualquer Linux sem tela gráfica (servidor, Raspberry Pi, SSH) e também no Windows/macOS.
//
//   node tools/terminal/sala.mjs [projeto]
//   AGENT_CONTROL_URL=http://100.x.y.z:20150 AGENT_CONTROL_TOKEN=... node tools/terminal/sala.mjs   (remoto via Tailscale)
//
// Digite uma mensagem e Enter para falar na sala. /sair para fechar.
import readline from 'node:readline';

const BASE = (process.env.AGENT_CONTROL_URL || 'http://127.0.0.1:20150').replace(/\/$/, '');
const TOKEN = process.env.AGENT_CONTROL_TOKEN || '';
let project = process.argv[2] || '';
let csrf = '';
const C = { r: '\x1b[0m', dim: '\x1b[2m', b: '\x1b[1m', ok: '\x1b[32m', warn: '\x1b[33m', bad: '\x1b[31m', acc: '\x1b[38;5;208m', cy: '\x1b[36m' };
const auth = () => (TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {});

async function get(p) {
  const r = await fetch(BASE + p, { headers: auth(), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${p}`);
  return r.json();
}

async function say(text) {
  if (!TOKEN && !csrf) csrf = (await get('/api/session')).csrf;
  const h = { 'Content-Type': 'application/json', ...auth(), ...(TOKEN ? {} : { Origin: BASE, 'X-Jarvis-Csrf': csrf }) };
  const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: h, body: JSON.stringify({ project, text }) });
  if (r.status === 403 && !TOKEN) { csrf = ''; return say(text); }
  if (!r.ok) throw new Error(`não enviou (HTTP ${r.status})`);
}

// Estado do agente a partir do último status: trabalhando, parado, bloqueado ou pronto.
function mood(a) {
  const s = `${a.latest?.status ?? ''}`.toLowerCase();
  if (a.done || /done|pronto|conclu/.test(s)) return [C.cy, 'pronto'];
  if (/block|bloq|erro|fail/.test(s)) return [C.bad, 'travado'];
  const age = a.latest?.ts ? (Date.now() - new Date(a.latest.ts).getTime()) / 60000 : Infinity;
  if (age < 30) return [C.ok, 'trabalhando'];
  return [C.dim, 'parado'];
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function wrap(text, width) {
  const out = []; let line = '';
  for (const w of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if ((line + ' ' + w).trim().length > width) { if (line) out.push(line); line = w.slice(0, width); } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

// A caixinha de fala do AgentC (mascote laranja) com a última fala da sala.
function bubble(who, text, width) {
  const w = Math.max(20, Math.min(width - 14, 70));
  const lines = wrap(text || 'Tudo calmo por aqui.', w - 4);
  const top = `╭${'─'.repeat(w - 2)}╮`, bot = `╰${'─'.repeat(w - 2)}╯`;
  const face = [`${C.acc} ▄███▄ ${C.r}`, `${C.acc}█ ◕ ◕ █${C.r}`, `${C.acc} ▀▄▄▄▀ ${C.r}`, `${C.acc}AgentC ${C.r}`];
  const body = [top, ...lines.map((l) => `│ ${l.padEnd(w - 4)} │`), bot];
  body.splice(1, 0, `│ ${C.b}${cut(who, w - 4).padEnd(w - 4)}${C.r} │`);
  const rows = Math.max(face.length, body.length);
  const res = [];
  for (let i = 0; i < rows; i++) res.push(`${face[i] ?? '       '} ${i === 2 ? '◀' : ' '}${body[i] ?? ''}`);
  return res;
}

let last = { state: null, chat: [], err: '' };
let input = '';

function draw() {
  const W = Math.max(40, process.stdout.columns || 80);
  const out = ['\x1b[H\x1b[2J', `${C.b}${C.acc}● Agent Control${C.r} ${C.dim}${BASE} · projeto ${project}${C.r}`];
  if (last.err) out.push(`${C.bad}${last.err}${C.r}`);
  const s = last.state;
  if (s) {
    out.push(`${C.dim}Objetivo:${C.r} ${s.goal ?? 'nenhum'}`, '');
    const lastMsg = last.chat.at(-1);
    out.push(...bubble(lastMsg ? lastMsg.agent : 'AgentC', lastMsg ? lastMsg.body : '', W), '');
    // A salinha: uma mesa por agente.
    const colW = 26, perRow = Math.max(1, Math.floor(W / colW));
    for (let i = 0; i < s.agents.length; i += perRow) {
      const row = s.agents.slice(i, i + perRow);
      out.push(row.map((a) => { const [c, t] = mood(a); return `${c}●${C.r} ${C.b}${cut(a.id, 10).padEnd(10)}${C.r} ${c}${t.padEnd(12)}${C.r}`; }).join(' '));
      out.push(row.map((a) => `${C.dim}  ${cut(a.latest?.task ?? a.latest?.heading ?? '—', colW - 3).padEnd(colW - 2)}${C.r}`).join(' '));
    }
    out.push('', `${C.dim}── sala ─────${C.r}`);
    for (const m of last.chat.slice(-6)) out.push(`${C.b}${cut(m.agent, 12)}${C.r}: ${cut(m.body.replace(/\s+/g, ' '), W - 16)}`);
  } else if (!last.err) out.push('conectando…');
  out.push('', `${C.acc}›${C.r} ${input}`);
  process.stdout.write(out.join('\n'));
}

async function tick() {
  try {
    if (!project) project = (await get('/api/projects'))[0]?.id ?? '';
    const q = `?project=${encodeURIComponent(project)}`;
    const [state, chat] = await Promise.all([get('/api/state' + q), get('/api/chat' + q)]);
    last = { state, chat, err: '' };
  } catch (e) {
    last.err = `Sem conexão com ${BASE}: ${e.message}. O servidor (npm start) está ligado?`;
  }
  draw();
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', async (ch, key) => {
  if (key?.ctrl && key.name === 'c') return quit();
  if (key?.name === 'return') {
    const t = input.trim(); input = '';
    if (t === '/sair') return quit();
    if (t) { try { await say(t); } catch (e) { last.err = e.message; } await tick(); }
  } else if (key?.name === 'backspace') input = input.slice(0, -1);
  else if (ch && !key?.ctrl && ch >= ' ') input += ch;
  draw();
});
function quit() { process.stdout.write('\x1b[0m\n'); process.exit(0); }
process.stdout.on('resize', draw);
await tick();
setInterval(tick, 3000);
