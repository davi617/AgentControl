#!/usr/bin/env node
// Ponte Agent Control → Arduino pela USB (sem dependências). Lê o estado dos agentes e manda para o sketch
// hardware/arduino/AgentControlLeds a cada 3 s.
//   Linux/Raspberry Pi: node tools/arduino/ponte.mjs /dev/ttyACM0 [projeto]
//   Windows:            node tools/arduino/ponte.mjs COM3 [projeto]
// Remoto: AGENT_CONTROL_URL e AGENT_CONTROL_TOKEN, como na salinha do terminal.
import { execFileSync } from 'node:child_process';
import { openSync, writeSync } from 'node:fs';

const [port, proj] = process.argv.slice(2);
if (!port) { console.error('uso: node tools/arduino/ponte.mjs <porta> [projeto]'); process.exit(1); }
const BASE = (process.env.AGENT_CONTROL_URL || 'http://127.0.0.1:20150').replace(/\/$/, '');
const auth = process.env.AGENT_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_CONTROL_TOKEN}` } : {};

// Configura 9600 baud antes de abrir.
if (process.platform === 'win32') execFileSync('mode', [port, 'BAUD=9600', 'PARITY=n', 'DATA=8', 'STOP=1'], { shell: true, stdio: 'ignore' });
else execFileSync('stty', ['-F', port, '9600', 'raw', '-echo'], { stdio: 'ignore' });
const fd = openSync(process.platform === 'win32' ? `\\.\${port}` : port, 'w');
const send = (s) => writeSync(fd, s + '\n');

const get = async (p) => { const r = await fetch(BASE + p, { headers: auth, signal: AbortSignal.timeout(5000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

function code(a, now = Date.now()) {
  const s = `${a.latest?.status ?? ''}`.toLowerCase();
  if (a.done || /done|pronto|conclu/.test(s)) return '3';
  if (/block|bloq|erro|fail/.test(s)) return '2';
  return a.latest?.ts && now - new Date(a.latest.ts).getTime() < 30 * 60000 ? '1' : '0';
}

let project = proj || '', lastChat = -1;
setTimeout(async function tick() {
  try {
    if (!project) project = (await get('/api/projects'))[0]?.id ?? '';
    const q = `?project=${encodeURIComponent(project)}`;
    const [st, chat] = await Promise.all([get('/api/state' + q), get('/api/chat' + q)]);
    send('S:' + st.agents.slice(0, 8).map((a) => code(a)).join('').padEnd(8, '0'));
    const id = chat.at(-1)?.id ?? 0;
    if (lastChat >= 0 && id !== lastChat) send('B');
    lastChat = id;
  } catch (e) { console.error('sem conexão:', e.message); }
  setTimeout(tick, 3000);
}, 2000); // o Arduino reinicia ao abrir a porta
console.log(`ponte ligada em ${port} → ${BASE}`);
