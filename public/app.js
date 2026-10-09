// JARVIS — UI. Todo dado do bus entra via textContent (nunca innerHTML).

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

// Dentro do app do celular (WebView do Código ao vivo): sem a barra da sala, só a tela pedida.
if (new URLSearchParams(location.search).has('embed')) document.documentElement.classList.add('embed');

const state = { csrf: null, project: null, agent: '', oldest: null, es: null, taskFilter: 'abertas', agentsKnown: [] };
const KIND = { command: 'comando', status: 'status', inbox: 'ordem', leader: 'líder', events: 'evento', decisions: 'decisão', goal: 'goal', handoff: 'handoff', meta: 'goal ativo' };

// ---------- tema ----------
const THEMES = ['system', 'dark', 'light'];
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#theme').textContent = `Tema: ${t === 'system' ? 'sistema' : t === 'dark' ? 'escuro' : 'claro'}`;
}
applyTheme(store.get('jarvis.theme', 'system'));
$('#theme').addEventListener('click', () => {
  const cur = store.get('jarvis.theme', 'system');
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  store.set('jarvis.theme', next);
  applyTheme(next);
});

// ---------- abas ----------
const TAB_TITLE = { chat: 'Sala central', chamada: 'Chamada em grupo', codigo: 'Código ao vivo', sala: 'Sala (bus)', comandos: 'Comandos', agentes: 'Agentes', tarefas: 'Tarefas', resumos: 'Resumos' };
function showTab(name) {
  if (!TAB_TITLE[name]) name = 'chat';
  $('#view-title').textContent = TAB_TITLE[name];
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === name));
  store.set('jarvis.tab', name);
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  if (name === 'codigo' && state.project) loadCode();
  if (name === 'resumos' && state.project) loadSummary();
  if (name === 'chat') $('#thread').lastElementChild?.scrollIntoView({ block: 'end' });
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TAB_TITLE[h]) showTab(h); });

// ---------- util ----------
const api = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${path}${sep}project=${encodeURIComponent(state.project)}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? hm : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm}`;
}
function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 90) return 'agora';
  if (s < 3600) return `${Math.round(s / 60)} min atrás`;
  if (s < 86400) return `${Math.round(s / 3600)} h atrás`;
  return `${Math.round(s / 86400)} d atrás`;
}
function badge(status) {
  if (!status) return null;
  const key = String(status).toUpperCase().replace(/[^A-Z_]/g, '').split('_').slice(0, 2).join('_');
  const base = ['NOT_RUN', 'NEEDS_HUMAN'].some((k) => key.startsWith(k)) ? key : key.split('_')[0];
  return el('span', `badge s-${base}`, status);
}
function initials(a) { return a.replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'; }
function hue(a) { let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
// Avatar do design: fundo escuro tingido + iniciais claras do mesmo tom.
function paint(av, name) {
  const h = hue(name);
  av.style.background = `hsl(${h} 30% 18%)`;
  av.style.color = `hsl(${h} 85% 80%)`;
}
function statusTone(s) {
  const v = String(s ?? '').toUpperCase();
  if (/^(DONE|APPROVED)/.test(v)) return 'ok';
  if (/^(BLOCKED|FAILED|STOPPED|VIOLATION|REJECTED|AWAITING)/.test(v)) return 'err';
  if (/^(WORKING|ACK)/.test(v)) return 'work';
  if (/^(REVIEW|QUEUED|ASSIGNED|NOT_RUN|NEEDS)/.test(v)) return 'warn';
  return 'none';
}

// ---------- sala ----------
function renderEntry(e, fresh) {
  const li = el('li', 'msg' + (fresh ? ' fresh' : ''));
  li.dataset.id = e.id;
  const av = el('div', 'avatar', initials(e.agent));
  paint(av, e.agent);
  const main = el('div');
  const h = el('div', 'msg-h');
  h.append(el('span', 'who', e.agent), el('span', 'kind', KIND[e.kind] ?? e.kind));
  const b = badge(e.status);
  if (b) h.append(b);
  const t = el('time', null, fmtTime(e.ts));
  t.dateTime = e.ts;
  h.append(t);
  main.append(h);
  if (e.heading) main.append(el('h3', null, e.heading));
  const meta = el('div', 'meta');
  for (const [k, v] of [['task', e.task], ['modelo', e.model]]) {
    if (!v) continue;
    const s = el('span', null, `${k}: `);
    s.append(el('b', null, v));
    meta.append(s);
  }
  if (meta.childNodes.length) main.append(meta);
  if (e.body) {
    const pre = el('pre', 'body', e.body);
    main.append(pre);
    if (e.body.split('\n').length > 6 || e.body.length > 480) {
      pre.classList.add('long');
      const btn = el('button', 'more-btn', 'ver tudo');
      btn.type = 'button';
      btn.addEventListener('click', () => { const o = pre.classList.toggle('open'); btn.textContent = o ? 'recolher' : 'ver tudo'; });
      main.append(btn);
    }
  }
  li.append(av, main);
  return li;
}

async function loadFeed(append = false) {
  const q = new URLSearchParams({ limit: '60' });
  if (state.agent) q.set('agent', state.agent);
  if (append && state.oldest) q.set('before', state.oldest);
  const rows = await api(`/api/feed?${q}`);
  const feed = $('#feed');
  if (!append) feed.replaceChildren();
  const lastSeen = Number(store.get(`jarvis.seen.${state.project}`, '0'));
  let dividerPlaced = append;
  let sawNew = false;
  for (const e of rows) {
    if (e.id > lastSeen) sawNew = true;
    if (!dividerPlaced && lastSeen && sawNew && e.id <= lastSeen) {
      feed.append(el('li', 'divider', 'visto até aqui'));
      dividerPlaced = true;
    }
    feed.append(renderEntry(e, false));
  }
  if (!append && !rows.length) feed.append(el('li', 'empty', 'Nenhuma mensagem ainda.'));
  if (rows.length) state.oldest = rows[rows.length - 1].id; // a lista vem por data; o servidor continua dali (id menor não é a mais antiga)
  $('#more').hidden = rows.length < 60;
  if (!append && rows.length) store.set(`jarvis.seen.${state.project}`, String(Math.max(...rows.map((r) => r.id))));
}
$('#more').addEventListener('click', () => loadFeed(true));

function renderFilters(agents) {
  const box = $('#filters');
  box.replaceChildren();
  const ids = ['', 'DONO', ...agents.map((a) => a.id), 'LEADER', 'EVENTS', 'DECISIONS'];
  for (const id of ids) {
    const c = el('button', 'chip' + (state.agent === id ? ' active' : ''), id || 'Todos');
    c.type = 'button';
    c.addEventListener('click', () => { state.agent = id; state.oldest = null; renderFilters(agents); loadFeed(); });
    box.append(c);
  }
}

// ---------- agentes ----------
function renderAgents(s) {
  const grid = $('#agent-grid');
  grid.replaceChildren();
  for (const a of s.agents) {
    const c = el('article', 'card' + (statusTone(a.latest?.status) === 'err' ? ' blocked' : ''));
    const h = el('header', 'card-h');
    const av = el('div', 'avatar', initials(a.id));
    paint(av, a.id);
    h.append(av, el('h3', null, a.name ?? a.id));
    const b = badge(a.latest?.status ?? 'SEM STATUS');
    if (b) h.append(b);
    c.append(h);
    const dl = el('dl', 'kv');
    const row = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v ?? '—')); };
    row('task', a.latest?.task);
    row('modelo', a.model ?? a.latest?.model);
    row('último', a.latest ? `${a.latest.heading || '(sem título)'}` : null);
    row('STATUS', a.statusFileMtime ? ago(a.statusFileMtime) : 'sem arquivo');
    c.append(dl);
    if (a.vaultCopyStale) c.append(el('div', 'flag', '⚠ cópia no vault diferente da worktree (sync atrasado)'));
    if (a.done) c.append(el('div', 'flag', 'wrapper do orquestrador terminou'));
    if (a.lastLog?.length) c.append(el('pre', 'log', a.lastLog.join('\n')));
    grid.append(c);
  }
  const lk = $('#locks');
  lk.replaceChildren();
  if (!s.locks.length) lk.append(el('span', 'muted', 'nenhum lock'));
  for (const l of s.locks) {
    lk.append(el('div', 'lock' + (l.alive ? '' : ' orphan'), `${l.name}: PID ${l.pid ?? '?'} ${l.alive ? '(ativo)' : '(órfão — processo não existe)'}`));
  }
}

// ---------- tarefas ----------
const TASK_GROUPS = {
  abertas: (s) => /WORKING|ASSIGNED|QUEUED|WAIT|ACK/i.test(s),
  bloqueadas: (s) => /BLOCKED|FAILED/i.test(s),
  feitas: (s) => /DONE/i.test(s),
  todas: () => true,
};
function renderTasks(tasks) {
  const f = $('#task-filters');
  f.replaceChildren();
  for (const k of Object.keys(TASK_GROUPS)) {
    const n = tasks.filter((t) => TASK_GROUPS[k](t.status)).length;
    const c = el('button', 'chip' + (state.taskFilter === k ? ' active' : ''), `${k} ${n}`);
    c.type = 'button';
    c.addEventListener('click', () => { state.taskFilter = k; renderTasks(tasks); });
    f.append(c);
  }
  const list = $('#task-list');
  list.replaceChildren();
  const rows = tasks.filter((t) => TASK_GROUPS[state.taskFilter](t.status));
  if (!rows.length) list.append(el('div', 'empty', 'Nada aqui.'));
  for (const t of rows) {
    const d = el('div', 'task');
    d.append(el('span', 'id', t.id), el('span', 't', t.task));
    const r = el('div', 'row');
    const b = badge(t.status);
    if (b) r.append(b);
    r.append(el('span', null, t.owner));
    if (t.gate) r.append(el('span', null, `· ${t.gate}`));
    d.append(r);
    list.append(d);
  }
}

// ---------- chat central ----------
function chatMeta(body) {
  const get = (k) => new RegExp(`^\\s*-\\s*${k}\\s*:\\s*(.+)$`, 'im').exec(body)?.[1]?.trim();
  return {
    para: get('para') ?? 'TODOS',
    assunto: get('assunto'),
    via: get('via'),
    text: body.replace(/^\s*-\s*(para|assunto|via)\s*:.*$/gim, '').trim(),
  };
}
function renderBubble(e, fresh) {
  const m = chatMeta(e.body);
  const li = el('li', 'bubble' + (e.agent === 'DONO' ? ' me' : '') + (m.via ? ' pasted' : '') + (fresh ? ' fresh' : ''));
  const av = el('div', 'avatar', initials(e.agent));
  paint(av, e.agent);
  const b = el('div', 'b');
  const h = el('div', 'b-h');
  h.append(el('span', 'who', e.agent), el('span', null, `→ ${m.para}`));
  if (m.via) h.append(el('span', null, '· colado do app'));
  const t = el('time', null, fmtTime(e.ts));
  t.dateTime = e.ts;
  h.append(t);
  b.append(h);
  if (m.assunto) b.append(el('p', 'b-subject', m.assunto));
  b.append(el('p', 'b-text', (m.text || e.heading).replace(/\*\*(.+?)\*\*/g, '$1')));
  li.append(av, b);
  return li;
}
let chatCache = [];
async function loadChat() {
  chatCache = await api('/api/chat');
  const th = $('#thread');
  th.replaceChildren();
  if (!chatCache.length) th.append(el('li', 'empty', 'Sala vazia. Mande a primeira mensagem.'));
  for (const e of chatCache) th.append(renderBubble(e, false));
  if ($('#chat').classList.contains('active')) th.lastElementChild?.scrollIntoView({ block: 'end' });
}
function appendChat(entries) {
  const th = $('#thread');
  th.querySelector('.empty')?.remove();
  for (const e of entries) { chatCache.push(e); th.append(renderBubble(e, true)); }
  // Sessão longa: não deixa a conversa crescer sem fim na memória e na tela.
  while (th.childElementCount > 600) th.firstElementChild.remove();
  if (chatCache.length > 600) chatCache.splice(0, chatCache.length - 600);
  th.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}
function fillChatTargets(agents) {
  const sel = $('#chat-to');
  const cur = sel.value;
  sel.replaceChildren(Object.assign(el('option', null, 'Todos'), { value: 'TODOS' }));
  for (const a of agents) sel.append(Object.assign(el('option', null, a.name ?? a.id), { value: a.id }));
  sel.value = cur || 'TODOS';
}
$('#chat-as').addEventListener('change', () => {
  $('#chat-text').placeholder = $('#chat-as').value === 'CHATGPT' ? 'Cole aqui a resposta do app do ChatGPT…' : 'Fale com todos os agentes…';
});
$('#chat-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('#chat-text').value.trim();
  if (!text) return;
  const reply = $('#chat-reply');
  const btn = $('#chat-send');
  btn.disabled = true;
  reply.classList.remove('err');
  reply.textContent = '';
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf },
      body: JSON.stringify({ project: state.project, text, to: $('#chat-to').value, as: $('#chat-as').value, assunto: $('#chat-subject').value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    $('#chat-text').value = '';
    $('#chat-subject').value = '';
    $('#chat-as').value = 'DONO';
  } catch (e) {
    reply.classList.add('err');
    reply.textContent = `Não enviei: ${e.message}`;
  } finally { btn.disabled = false; }
});
$('#chat-text').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('#chat-form').requestSubmit();
});
// Ponte com o app do ChatGPT: copia o fio em Markdown + instrução de formato.
$('#copy-gpt').addEventListener('click', async () => {
  const last = chatCache.slice(-25);
  const md = [
    'Você é o CHATGPT na sala central dos agentes do dono (Agent Control). Abaixo, as últimas mensagens em Markdown.',
    'Responda no MESMO formato, uma mensagem só:',
    '`## AAAA-MM-DD HH:mm — CHATGPT` + `- para: TODOS|AGENTE` + `- assunto: …` + texto.',
    'Regras: sem segredos; sem PASS sem evidência; deploy/push/merge só com aprovação do dono.',
    '',
    ...last.map((e) => `## ${e.ts.replace('T', ' ').slice(0, 16)} — ${e.agent}\n${e.body.trim()}\n`),
  ].join('\n');
  const btn = $('#copy-gpt');
  try { await navigator.clipboard.writeText(md); btn.textContent = 'Copiado ✓'; }
  catch { btn.textContent = 'Não copiou'; }
  setTimeout(() => { btn.textContent = 'Copiar pro ChatGPT'; }, 2000);
});

// ---------- comandos ----------
const CMD_LABEL = { NEW: 'enviado', AWAITING_APPROVAL: 'aguarda sua aprovação', VIOLATION: 'executado SEM aprovação!', APPROVED: 'aprovado por você', REJECTED: 'recusado por você' };
const lockIcon = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [['rect', { x: 5, y: 10, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }]]) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    s.append(n);
  }
  return s;
};
async function decide(code, decision, btns) {
  if (decision === 'approve' && !confirm(`Aprovar ${code}? Vale só para este comando.`)) return;
  btns.forEach((b) => { b.disabled = true; });
  try {
    const r = await fetch('/api/commands/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf },
      body: JSON.stringify({ project: state.project, code, decision }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    $('#cmd-reply').classList.remove('err');
    $('#cmd-reply').textContent = data.reply;
  } catch (e) {
    $('#cmd-reply').classList.add('err');
    $('#cmd-reply').textContent = `Não registrei: ${e.message}`;
  } finally { btns.forEach((b) => { b.disabled = false; }); loadCommands(); }
}
// Fase 3: cartões de aprovação (um clique = um comando) + aviso no chat + contador na navegação.
function renderApprovals(rows) {
  const pending = rows.filter((c) => c.approval === 'pending');
  const box = $('#approvals');
  box.replaceChildren();
  if (!pending.length) box.append(el('div', 'empty', 'Nada esperando você.'));
  for (const c of pending) {
    const a = el('article', 'appr');
    const h = el('div', 'appr-h');
    h.append(lockIcon(), el('code', null, c.code));
    const b = el('span', 'badge s-AWAITING', 'AGUARDA VOCÊ');
    b.style.marginLeft = 'auto';
    h.append(b);
    const dl = el('dl', 'kv');
    dl.append(el('dt', null, 'para'), el('dd', null, c.target), el('dt', null, 'pedido'), el('dd', null, fmtTime(c.created_at)));
    const acts = el('div', 'appr-actions');
    const ok = el('button', 'primary', `Aprovar só ${c.code}`);
    const no = el('button', 'ghost-btn', 'Recusar');
    ok.type = no.type = 'button';
    ok.addEventListener('click', () => decide(c.code, 'approve', [ok, no]));
    no.addEventListener('click', () => decide(c.code, 'reject', [ok, no]));
    acts.append(ok, no);
    if (c.precisa > 1) {
      const n = c.votos?.length ?? 0;
      dl.append(el('dt', null, 'dupla'), el('dd', 'appr-votes', n ? `${n} de ${c.precisa}: ${c.votos.join(', ')} já aprovou; falta outra pessoa` : `precisa de ${c.precisa} pessoas`));
    }
    a.append(h, el('p', null, c.text), dl, acts, el('span', 'appr-note', 'Um clique vale para este comando, não para os próximos.'));
    box.append(a);
  }
  const badgeEl = $('#pending-badge');
  badgeEl.hidden = !pending.length;
  badgeEl.textContent = String(pending.length);
  const banner = $('#approval-banner');
  banner.hidden = !pending.length;
  if (pending.length) {
    $('#approval-banner-title').textContent = pending.length === 1 ? '1 aprovação esperando você' : `${pending.length} aprovações esperando você`;
    $('#approval-banner-sub').textContent = `${pending[0].code} · ${pending[0].text.slice(0, 70)}`;
  }
}
$('#approval-banner').addEventListener('click', (ev) => { ev.preventDefault(); showTab('comandos'); });
async function loadCommands() {
  const rows = await api('/api/commands');
  renderApprovals(rows);
  const list = $('#cmd-list');
  list.replaceChildren();
  if (!rows.length) list.append(el('div', 'empty', 'Nenhum comando ainda.'));
  for (const c of rows) {
    const d = el('div', 'task');
    d.append(el('span', 'id', c.code), el('span', 't', `para ${c.target}`));
    d.append(el('div', 'cmd-text', c.text));
    const r = el('div', 'row');
    const b = badge(c.status);
    if (b) r.append(b);
    if (CMD_LABEL[c.status]) r.append(el('span', null, CMD_LABEL[c.status]));
    r.append(el('span', null, `· ${c.updated_by ?? ''} ${fmtTime(c.updated_at)}`));
    d.append(r);
    list.append(d);
  }
}
function fillTargets(agents) {
  const sel = $('#cmd-to');
  sel.replaceChildren(Object.assign(el('option', null, 'Líder (distribui)'), { value: 'LEADER' }));
  for (const a of agents) sel.append(Object.assign(el('option', null, a.name ?? a.id), { value: a.id }));
}
$('#composer').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('#cmd-text').value.trim();
  const reply = $('#cmd-reply');
  if (!text) return;
  const btn = $('#cmd-send');
  btn.disabled = true;
  reply.classList.remove('err');
  reply.textContent = 'enviando…';
  try {
    const r = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf },
      body: JSON.stringify({ project: state.project, text, to: $('#cmd-to').value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
    reply.textContent = data.reply;
    $('#cmd-text').value = '';
    loadCommands();
  } catch (e) {
    reply.classList.add('err');
    reply.textContent = `Não enviei: ${e.message}`;
  } finally { btn.disabled = false; }
});

// ---------- coluna da direita do chat (design: Agentes · Alertas · Resumo) ----------
function renderRail(s) {
  const box = $('#rail-agents');
  box.replaceChildren();
  for (const a of s.agents) {
    const st = a.latest?.status;
    const tone = statusTone(st);
    const row = el('div', 'ra');
    const when = a.latest?.task || (a.statusFileMtime ? fmtTime(a.statusFileMtime) : '—');
    row.append(el('span', `dot ${tone}`), el('strong', null, a.name ?? a.id), el('code', null, when), el('span', `st ${tone}`, st ?? 'sem status'));
    box.append(row);
  }
  const alerts = [];
  for (const l of s.locks) if (!l.alive) alerts.push(`Lock ${l.name} órfão: PID ${l.pid ?? '?'} não existe.`);
  const byModel = new Map();
  for (const a of s.agents) if (a.model?.startsWith('nvidia/')) byModel.set(a.model, (byModel.get(a.model) ?? 0) + 1);
  for (const [m, n] of byModel) if (n > 1) alerts.push(`${n} agentes no mesmo modelo ${m} (limite NVIDIA = 1).`);
  const stale = s.agents.filter((a) => a.vaultCopyStale).map((a) => a.id);
  if (stale.length) alerts.push(`Cópia do STATUS no vault atrasada: ${stale.join(', ')}.`);
  const ab = $('#rail-alerts');
  ab.replaceChildren();
  if (!alerts.length) ab.append(el('p', 'muted', 'Nenhum alerta.'));
  for (const t of alerts) {
    const d = el('div', 'alert');
    const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ic.setAttribute('viewBox', '0 0 24 24');
    ic.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M12 4l9 16H3zM12 10v4M12 17.5v.01');
    ic.append(p);
    d.append(ic, el('span', null, t));
    ab.append(d);
  }
}
async function loadRailSummary() {
  const s = await api('/api/summary');
  const ok = s.llm.find((r) => r.status === 'OK');
  $('#rail-summary').textContent = ok ? ok.text.replace(/\*\*(.+?)\*\*/g, '$1') : 'Sem resumo por IA ainda.';
  $('#rail-summary-meta').textContent = ok ? `${(ok.model ?? '').split('/').pop()} · ${fmtTime(ok.created_at)}` : '';
}

// ---------- resumos ----------
async function loadSummary() {
  const s = await api('/api/summary');
  $('#det').textContent = s.deterministic;
  const box = $('#llm');
  box.replaceChildren();
  if (!s.llm.length) box.append(el('div', 'empty', 'Nenhum resumo por IA ainda.'));
  for (const r of s.llm) {
    const c = el('article', 'card');
    const h = el('header', 'card-h');
    h.append(el('h3', null, fmtTime(r.created_at)));
    const b = badge(r.status);
    if (b) h.append(b);
    h.append(el('span', 'muted', r.model ?? 'sem modelo'));
    c.append(h, el('pre', 'pre', r.text.replace(/\*\*(.+?)\*\*/g, '$1')));
    box.append(c);
  }
}

// ---------- chamada em grupo (voz) ----------
// O servidor decide quem fala e gera o texto; aqui o navegador dá a voz (speechSynthesis) e ouve o dono (SpeechRecognition).
const call = { data: null, paused: false, pumping: false, listening: false, rec: null, heard: '', voices: [], since: 0, clock: null, logged: 0 };
const stopSpeaking = () => { try { speechSynthesis.cancel(); } catch { /* sem voz */ } };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const PITCH = [1, 0.8, 1.22, 0.92, 1.1, 0.74, 1.3, 0.86];

async function callPost(path, body = {}) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf },
    body: JSON.stringify({ project: state.project, ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
function callNote(text, err = false) { const n = $('#call-note'); n.textContent = text; n.classList.toggle('err', err); }
function caption(who, text, thinking = false) {
  $('#call-cap-who').textContent = who ?? '';
  const t = $('#call-cap-text');
  t.textContent = text ?? '';
  t.className = thinking ? 'thinking' : '';
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const all = speechSynthesis.getVoices();
  const br = all.filter((v) => /^pt[-_]BR/i.test(v.lang));
  const pt = br.length ? br : all.filter((v) => /^pt/i.test(v.lang));
  // Vozes "Natural/Online" (Edge) primeiro: soam bem mais humanas.
  call.voices = pt.sort((a, b) => Number(/Natural|Online|Neural/i.test(b.name)) - Number(/Natural|Online|Neural/i.test(a.name)));
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener('voiceschanged', loadVoices); }

function voiceOf(id) {
  const i = Math.max(0, call.data?.participants.findIndex((p) => p.id === id) ?? 0);
  const n = call.voices.length;
  return { voice: n ? call.voices[i % n] : null, pitch: PITCH[i % PITCH.length] };
}

function tileState(id, cls) {
  document.querySelectorAll('.tile').forEach((t) => {
    const on = t.dataset.id === id;
    t.classList.toggle('speaking', on && cls === 'speaking');
    t.classList.toggle('listening', on && cls === 'listening');
    const st = t.querySelector('.state');
    st.replaceChildren();
    if (on && cls) { const b = el('span', 'bars'); for (let k = 0; k < 4; k++) b.append(el('i')); st.append(b); }
  });
}

function speak(turn) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { caption(turn.speaker, turn.text); setTimeout(resolve, 1500 + turn.text.length * 45); return; }
    const u = new SpeechSynthesisUtterance(turn.text);
    const v = voiceOf(turn.speaker);
    if (v.voice) u.voice = v.voice;
    u.lang = v.voice?.lang ?? 'pt-BR';
    u.pitch = v.pitch;
    u.rate = Number($('#call-speed').value) || 1;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(guard); tileState(null); resolve(); };
    // Alguns navegadores esquecem o onend: um relógio de segurança pelo tamanho do texto.
    const guard = setTimeout(finish, 4000 + turn.text.length * 110 / u.rate);
    u.onstart = () => { tileState(turn.speaker, 'speaking'); caption(turn.speaker, turn.text); };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

function renderStage() {
  const stage = $('#call-stage');
  stage.replaceChildren();
  if (!call.data) return;
  const people = [{ id: 'DONO', papel: 'Você' }, ...call.data.participants];
  // Iniciais únicas: OPENCODE e OPENCLAW não podem virar os dois "OP".
  const used = new Set(['DW']);
  const mark = (id) => {
    const s = id.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    for (let i = 1; i < s.length; i++) { const m = s[0] + s[i]; if (!used.has(m)) { used.add(m); return m; } }
    return s.slice(0, 2);
  };
  for (const p of people) {
    const t = el('div', 'tile' + (p.id === 'DONO' ? ' me' : ''));
    t.dataset.id = p.id;
    const face = el('div', 'face', p.id === 'DONO' ? 'DW' : mark(p.id));
    paint(face, p.id);
    t.append(el('span', 'state'), face, el('span', 'who', p.id === 'DONO' ? 'você (você)' : p.id), el('span', 'role', p.papel));
    stage.append(t);
  }
}
function logTurn(turn) {
  if (turn.n <= call.logged) return;
  call.logged = turn.n;
  const li = el('li', turn.speaker === 'DONO' ? 'me' : '');
  li.append(el('b', null, `${turn.speaker}: `), document.createTextNode(turn.text));
  $('#call-log').append(li);
  li.scrollIntoView({ block: 'nearest' });
}
function renderCall() {
  const active = !!call.data && call.data.status !== 'ENCERRADA';
  $('#call-start').hidden = active;
  $('#call-bar').hidden = !active;
  $('#call-timer').hidden = !active;
  $('#call-live-dot').hidden = !active;
  $('#call-pause').setAttribute('aria-pressed', String(call.paused));
  $('#call-pause').title = call.paused ? 'Continuar o debate' : 'Pausar o debate';
  if (call.data?.status === 'AGUARDANDO_DONO' && !call.listening) caption('', 'Eles estão esperando você. Aperte Falar (ou F) e responda.', true);
}
function tick() {
  const s = Math.floor((Date.now() - call.since) / 1000);
  $('#call-timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function pump() {
  if (call.pumping) return;
  call.pumping = true;
  try {
    while (call.data?.status === 'ATIVA' && !call.paused && !call.listening) {
      caption('', 'pensando…', true);
      const r = await callPost('/api/call/next');
      if (r.call) call.data = r.call;
      if (!r.turn) break;
      logTurn(r.turn);
      if (call.paused || call.listening) { caption(r.turn.speaker, r.turn.text); break; }
      await speak(r.turn);
    }
  } catch (e) {
    callNote(`A chamada travou: ${e.message}. Aperte Falar ou Continuar para tentar de novo.`, true);
    call.paused = true;
  } finally {
    call.pumping = false;
    if (call.data?.status === 'ATIVA' && !call.paused && !call.listening) caption('', '');
    renderCall();
  }
}

async function dono(text) {
  if (!call.data || call.data.status === 'ENCERRADA') return;
  text = text.trim();
  if (!text) { pump(); return; }
  try {
    call.data = await callPost('/api/call/say', { text });
    logTurn(call.data.turns.at(-1));
    caption('DONO', text);
    call.paused = false;
    callNote('');
  } catch (e) { callNote(`Não enviei sua fala: ${e.message}`, true); }
  renderCall();
  pump();
}

function listen() {
  if (!SR) { callNote('Este navegador não escuta voz. Use o Edge ou o Chrome, ou digite a sua fala.', true); $('#call-text').focus(); return; }
  if (call.listening) { call.listening = false; call.rec?.stop(); return; }
  stopSpeaking(); // interromper quem está falando, como numa call
  call.listening = true;
  call.heard = '';
  $('#call-mic').setAttribute('aria-pressed', 'true');
  $('#call-mic').lastElementChild.textContent = 'Enviar';
  tileState('DONO', 'listening');
  caption('DONO', 'ouvindo…', true);
  const rec = new SR();
  call.rec = rec;
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev) => {
    let fin = '', mid = '';
    for (let i = 0; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript + ' ') : (mid += ev.results[i][0].transcript));
    call.heard = fin;
    caption('DONO', (fin + mid).trim() || 'ouvindo…', !(fin + mid).trim());
  };
  rec.onerror = (ev) => { if (ev.error === 'not-allowed') callNote('O navegador bloqueou o microfone. Libere no cadeado da barra de endereço.', true); };
  rec.onend = () => {
    call.listening = false;
    $('#call-mic').setAttribute('aria-pressed', 'false');
    $('#call-mic').lastElementChild.textContent = 'Falar';
    tileState(null);
    dono(call.heard);
  };
  rec.start();
}

$('#call-start').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const topic = $('#call-topic').value.trim();
  if (!topic) { $('#call-topic').focus(); return; }
  const btn = ev.submitter ?? $('.call-go');
  btn.disabled = true;
  callNote('');
  try {
    call.data = await callPost('/api/call/start', { text: topic });
    call.logged = 0;
    call.paused = false;
    $('#call-log').replaceChildren();
    call.data.turns.forEach(logTurn);
    call.since = Date.now();
    clearInterval(call.clock);
    call.clock = setInterval(tick, 1000);
    tick();
    renderStage();
    renderCall();
    pump();
  } catch (e) { callNote(`Não liguei: ${e.message}`, true); } finally { btn.disabled = false; }
});
$('#call-mic').addEventListener('click', listen);
$('#call-type').addEventListener('submit', (ev) => { ev.preventDefault(); const t = $('#call-text'); stopSpeaking(); dono(t.value); t.value = ''; });
$('#call-pause').addEventListener('click', () => {
  call.paused = !call.paused;
  if (call.paused) { stopSpeaking(); caption('', 'Debate pausado.', true); }
  callNote('');
  renderCall();
  if (!call.paused) pump();
});
$('#call-end').addEventListener('click', async () => {
  stopSpeaking();
  call.rec?.abort();
  call.listening = false;
  try { call.data = await callPost('/api/call/end'); } catch { /* já encerrada */ }
  clearInterval(call.clock);
  call.clock = null;
  caption('', `Chamada encerrada · ${call.data?.turns.length ?? 0} falas. A ata ficou no vault.`, true);
  renderCall();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() !== 'f' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (!$('#chamada').classList.contains('active') || $('#call-bar').hidden) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) return;
  ev.preventDefault();
  listen();
});
/** Retoma uma chamada que já existe (ex.: aberta no celular) sem falar as falas antigas. */
async function loadCall() {
  const c = await api('/api/call').catch(() => null);
  call.data = c && c.status !== 'ENCERRADA' ? c : null;
  $('#call-log').replaceChildren();
  call.logged = 0;
  c?.turns?.forEach(logTurn);
  if (call.data && !call.clock) { call.since = new Date(call.data.turns[0]?.ts ?? Date.now()).getTime(); call.clock = setInterval(tick, 1000); }
  renderStage();
  renderCall();
}

// ---------- código ao vivo (o que cada agente está mexendo no código) ----------
const code = { data: null, open: null };
const secsAgo = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 1000 : Infinity);
async function loadCode() {
  try { code.data = await api('/api/code'); } catch { return; }
  renderCode();
}
function renderCode() {
  const d = code.data;
  if (!d) return;
  const box = $('#code-agents');
  box.replaceChildren();
  if (!d.agents.length) box.append(el('div', 'empty', 'Nenhum agente com pasta de código (worktree) neste projeto.'));
  let anyLive = false;
  for (const a of d.agents) {
    const live = secsAgo(a.changedAt) < 45;
    anyLive ||= live;
    const card = el('article', `code-card${live ? ' live' : ''}`);
    const h = el('div', 'code-card-h');
    const av = el('div', 'avatar', initials(a.agent));
    paint(av, a.agent);
    const t = el('div', 'code-who');
    t.append(el('h3', null, a.name), el('span', 'muted', a.error ? a.error : `${a.branch ?? 'sem branch'} · ${a.head ?? ''}${a.headMsg ? ` ${a.headMsg}` : ''}`));
    h.append(av, t);
    if (live) h.append(el('span', 'code-now', 'mexendo agora'));
    else if (a.files.length) h.append(el('span', 'code-pend', 'sem commit'));
    card.append(h);
    if (a.files.length) {
      const sum = el('p', 'code-sum');
      sum.append(document.createTextNode(`${a.files.length} arquivo${a.files.length > 1 ? 's' : ''} · `), el('span', 'add', `+${a.adds}`), document.createTextNode(' '), el('span', 'del', `−${a.dels}`));
      card.append(sum);
      const ul = el('ul', 'code-files');
      for (const f of a.files.slice(0, 40)) {
        const li = el('li');
        const b = el('button', 'code-file');
        b.type = 'button';
        b.append(el('span', `code-st st-${f.status}`, f.status), el('code', null, f.path), el('span', 'add', f.binary ? 'bin' : `+${f.adds}`), el('span', 'del', f.binary ? '' : `−${f.dels}`));
        b.addEventListener('click', () => openDiff(a.agent, f.path));
        li.append(b);
        ul.append(li);
      }
      if (a.files.length > 40) ul.append(el('li', 'muted', `+${a.files.length - 40} arquivos`));
      card.append(ul);
    } else if (!a.error) card.append(el('p', 'muted code-clean', 'Nada alterado desde o último commit.'));
    box.append(card);
  }
  $('#code-live-dot').hidden = !anyLive;
  const feed = $('#code-feed');
  feed.replaceChildren();
  if (!d.feed.length) feed.append(el('li', 'muted', 'Assim que um agente mexer num arquivo, aparece aqui.'));
  for (const e of d.feed.slice(0, 120)) {
    const li = el('li');
    li.append(el('span', 'muted', `${fmtTime(e.at)} `), el('b', null, e.name), document.createTextNode(' '));
    if (e.kind === 'commit') li.append(document.createTextNode('fez commit '), el('code', null, e.hash), document.createTextNode(` ${e.msg ?? ''}`));
    else if (e.kind === 'reverted') li.append(document.createTextNode('desfez '), el('code', null, e.path));
    else {
      const btn = el('button', 'link-btn code-feed-file', e.path);
      btn.type = 'button';
      btn.addEventListener('click', () => openDiff(e.agent, e.path));
      li.append(document.createTextNode(e.status === 'novo' ? 'criou ' : e.status === 'apagado' ? 'apagou ' : 'editou '), btn, document.createTextNode(' '), el('span', 'add', `+${e.adds ?? 0}`), document.createTextNode(' '), el('span', 'del', `−${e.dels ?? 0}`));
    }
    feed.append(li);
  }
  if (code.open) openDiff(code.open.agent, code.open.path, true);
}
async function openDiff(agent, path, quiet) {
  code.open = { agent, path };
  const box = $('#code-diff'), body = $('#code-diff-body');
  box.hidden = false;
  let d;
  try { d = await api(`/api/code/diff?agent=${encodeURIComponent(agent)}&path=${encodeURIComponent(path)}`); }
  catch { if (!quiet) { $('#code-diff-title').textContent = path; body.replaceChildren(el('span', 'muted', 'Esse arquivo não tem mais mudança (o agente desfez ou fez commit).')); } return; }
  $('#code-diff-title').textContent = `${d.name} · ${d.path}`;
  body.replaceChildren();
  for (const line of d.diff.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line)) continue;
    body.append(el('span', line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : null, `${line}\n`));
  }
  if (d.cortado) body.append(el('span', 'muted', '… (cortado: arquivo grande)'));
  if (!quiet) box.scrollIntoView({ block: 'nearest' });
}
$('#code-diff-close').addEventListener('click', () => { code.open = null; $('#code-diff').hidden = true; });

// ---------- ao vivo ----------
let stateTimer;
async function refreshState() {
  const s = await api('/api/state');
  $('#goal').textContent = s.goal ?? 'sem Goal ativo';
  renderAgents(s);
  renderRail(s);
  renderTasks(s.tasks);
  if (JSON.stringify(s.agents.map((a) => a.id)) !== JSON.stringify(state.agentsKnown)) {
    state.agentsKnown = s.agents.map((a) => a.id);
    renderFilters(s.agents);
    fillTargets(s.agents);
    fillChatTargets(s.agents);
  }
}
function scheduleState() { clearTimeout(stateTimer); stateTimer = setTimeout(() => refreshState().catch(() => {}), 200); }

function connect() {
  state.es?.close();
  const conn = $('#conn');
  const setConn = (st, label) => { conn.dataset.state = st; conn.lastElementChild.textContent = label; };
  setConn('wait', 'conectando');
  const es = new EventSource(`/events?project=${encodeURIComponent(state.project)}`);
  state.es = es;
  es.onopen = () => setConn('on', 'ao vivo');
  es.onerror = () => setConn('wait', 'reconectando');
  es.addEventListener('entries', (m) => {
    const { entries } = JSON.parse(m.data);
    const feed = $('#feed');
    feed.querySelector('.empty')?.remove();
    for (const e of entries) {
      if (state.agent && e.agent !== state.agent) continue;
      feed.prepend(renderEntry(e, true));
      store.set(`jarvis.seen.${state.project}`, String(e.id));
    }
  });
  es.addEventListener('agents', scheduleState);
  es.addEventListener('tasks', scheduleState);
  es.addEventListener('commands', () => loadCommands().catch(() => {}));
  es.addEventListener('panic', () => loadSecurity().catch(() => {}));
  // Mudança de código chega já pronta pelo SSE; a lista completa é relida (barata) se a aba estiver aberta.
  es.addEventListener('code', () => { if ($('#codigo').classList.contains('active')) loadCode(); else $('#code-live-dot').hidden = false; });
  es.addEventListener('chat', (m) => appendChat(JSON.parse(m.data).entries));
  // Falas vindas de outro aparelho (ex.: o dono falou pelo celular) entram na transcrição.
  es.addEventListener('call', (m) => { const ev = JSON.parse(m.data); if (ev.turn) logTurn(ev.turn); if (ev.status && call.data) { call.data.status = ev.status; renderCall(); } });
  es.addEventListener('summary', () => { loadRailSummary().catch(() => {}); if ($('#resumos').classList.contains('active')) loadSummary().catch(() => {}); });
}

async function selectProject(id) {
  state.project = id;
  state.agent = '';
  state.oldest = null;
  state.agentsKnown = [];
  store.set('jarvis.project', id);
  await refreshState();
  await loadFeed();
  await loadCommands();
  await loadChat();
  await loadRailSummary();
  await loadCall();
  if ($('#resumos').classList.contains('active')) await loadSummary();
  code.data = null; code.open = null; $('#code-diff').hidden = true;
  if ($('#codigo').classList.contains('active')) await loadCode();
  connect();
}

// Sair (só no acesso de fora, pelo Tailscale): apaga o cookie e volta para a tela de entrar.
if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  document.querySelectorAll('.logout').forEach((b) => {
    b.hidden = false;
    b.addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }).catch(() => {}); location.replace('/entrar'); });
  });
}

// Aparelhos conectados (sessões do navegador). O dono desconecta qualquer um; quem não é dono só vê os próprios.
async function loadDevices() {
  const list = $('#devices-list'), note = $('#devices-note');
  list.replaceChildren();
  note.textContent = '';
  let rows = [];
  try { rows = await (await fetch('/api/sessions')).json(); } catch { note.textContent = 'Não deu para carregar agora.'; return; }
  if (!rows.length) { note.textContent = 'Nenhum navegador conectado (o app do celular usa token, não aparece aqui).'; return; }
  for (const s of rows) {
    const li = el('li', 'device');
    const info = el('div');
    info.append(el('strong', null, `${s.device}${s.atual ? ' · este aparelho' : ''}`));
    info.append(el('span', 'muted', ` ${s.nome} · ${s.ip} · entrou ${fmtTime(s.created)}${s.lastSeen ? ` · visto ${ago(s.lastSeen)}` : ''}`));
    const b = el('button', 'link-btn', 'Desconectar');
    b.type = 'button';
    b.addEventListener('click', async () => {
      const r = await fetch('/api/sessions/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf }, body: JSON.stringify({ id: s.id }) }).catch(() => null);
      if (!r?.ok) { note.textContent = r?.status === 403 ? 'Só o dono do time desconecta aparelhos.' : 'Não deu para desconectar.'; return; }
      if (s.atual) { location.replace('/entrar'); return; }
      loadDevices();
    });
    li.append(info, b);
    list.append(li);
  }
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  const btn = $('#devices-btn');
  btn.hidden = false;
  btn.addEventListener('click', () => { $('#devices').showModal(); loadDevices(); });
}

// v4.0: pânico, aprovação em dupla e auditoria (só o dono vê o botão; o servidor confere de novo).
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JARVIS-CSRF': state.csrf }, body: JSON.stringify(body) });
async function loadSecurity() {
  let s;
  try { s = await (await fetch(`/api/settings?project=${encodeURIComponent(state.project)}`)).json(); } catch { return; }
  $('#panic-banner').hidden = !s.panico;
  if (s.panico) $('#panic-banner-sub').textContent = `Acionado por ${s.panico.by} em ${fmtTime(s.panico.at)}. Agentes parados e acesso fechado para quem não é dono.`;
  $('#panic-btn').textContent = s.panico ? 'Pânico ligado' : 'Acionar pânico';
  $('#panic-btn').disabled = !!s.panico;
  const t = $('#dual-toggle');
  t.checked = !!s.aprovacaoDupla;
  t.disabled = !s.aprovacaoDuplaDisponivel;
  $('#dual-note').textContent = s.aprovacaoDuplaDisponivel ? 'Convide a outra pessoa em Time com o papel "dono". Um "recusar" de qualquer uma vale na hora.' : 'Faz parte do plano Time.';
}
async function loadAudit() {
  const list = $('#audit-list'), check = $('#audit-check');
  list.replaceChildren();
  $('#audit-csv').href = `/api/audit?project=${encodeURIComponent(state.project)}&formato=csv`;
  let a;
  try { const r = await fetch(`/api/audit?project=${encodeURIComponent(state.project)}&limit=60`); if (!r.ok) throw 0; a = await r.json(); } catch { check.textContent = 'Não deu para carregar a auditoria.'; return; }
  check.replaceChildren(a.verificacao.ok
    ? el('span', 'audit-ok', `Corrente íntegra: ${a.verificacao.total} registro(s), nenhum alterado.`)
    : el('span', 'audit-bad', `Atenção: o registro #${a.verificacao.brokenAt} não confere. Alguém mexeu no banco.`));
  if (!a.linhas.length) list.append(el('li', 'muted', 'Nada registrado ainda.'));
  for (const r of a.linhas) {
    const li = el('li');
    li.append(el('span', 'muted', `${fmtTime(r.at)} · `), el('b', null, r.actor), document.createTextNode(` ${r.action}${r.target ? ` ${r.target}` : ''}${r.detail ? ` · ${r.detail}` : ''}`));
    list.append(li);
  }
}
async function setPanic(on) {
  if (on && !confirm('Acionar o pânico? Todos os agentes param AGORA e os aparelhos conectados são desligados.')) return;
  const note = $('#security-note');
  const r = await post('/api/panic', { on }).catch(() => null);
  note.textContent = !r?.ok ? 'Não deu: só o dono aciona o pânico.' : '';
  if (r?.ok) { const d = await r.json(); if (on) note.textContent = `Pânico ligado: ${d.pausados.length} projeto(s) parado(s), ${d.aparelhos} aparelho(s) desligado(s).`; }
  await loadSecurity();
  loadAudit();
}
$('#panic-btn').addEventListener('click', () => setPanic(true));
$('#panic-off').addEventListener('click', () => { if (confirm('Desligar o pânico? Os agentes voltam na próxima rodada e o time pode entrar de novo.')) setPanic(false); });
$('#dual-toggle').addEventListener('change', async (e) => {
  const r = await post('/api/settings', { project: state.project, aprovacaoDupla: e.target.checked }).catch(() => null);
  if (!r?.ok) $('#security-note').textContent = (await r?.json().catch(() => null))?.error ?? 'Não deu para mudar agora.';
  loadSecurity();
});
$('#security-btn').addEventListener('click', () => { $('#security').showModal(); loadSecurity(); loadAudit(); });

// App instalado (PWA): service worker só em contexto seguro (127.0.0.1 ou HTTPS).
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

(async function boot() {
  state.csrf = (await (await fetch('/api/session')).json()).csrf;
  const projects = await (await fetch('/api/projects')).json();
  const sel = $('#project');
  for (const p of projects) { const o = el('option', null, p.name); o.value = p.id; sel.append(o); }
  sel.addEventListener('change', () => selectProject(sel.value));
  const saved = store.get('jarvis.project', '');
  const first = projects.find((p) => p.id === saved)?.id ?? projects[0]?.id;
  sel.value = first;
  const fromHash = location.hash.slice(1);
  showTab(TAB_TITLE[fromHash] ? fromHash : fromHash === 'predio' || fromHash === 'personagem' ? 'codigo' : store.get('jarvis.tab', 'chat'));
  await selectProject(first);
  const me = (await (await fetch('/api/team')).json().catch(() => ({}))).me;
  $('#security-btn').hidden = me?.role !== 'dono';
  loadSecurity();
})();
