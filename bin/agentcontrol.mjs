#!/usr/bin/env node
// agentcontrol: o Agent Control no terminal (v4.0). Fala com o servidor pela mesma API dos apps.
//   No PC: sem configurar nada (127.0.0.1:20150, token CSRF da sala).
//   De fora (Tailscale): --url http://100.x.y.z:20150 --token <token> (ou AGENT_CONTROL_URL / AGENT_CONTROL_TOKEN).
// JavaScript puro de propósito: instalado com `npm i -g`, o Node não roda .ts de dentro de node_modules.

const HELP = `agentcontrol — seu time de agentes no terminal

  agentcontrol                      quem está trabalhando e o que espera você
  agentcontrol ao-vivo [--diff]     os agentes mexendo no código, em tempo real (Ctrl+C sai)
  agentcontrol codigo [AGENTE]      o que cada agente mudou desde o último commit
  agentcontrol diff AGENTE ARQUIVO  as linhas que o agente mudou nesse arquivo
  agentcontrol mandar AGENTE texto  manda uma ordem (AGENTE: LEADER, CLAUDE, CODEX…)
  agentcontrol comandos             últimas ordens e o estado de cada uma
  agentcontrol aprovar J-001        aprova um comando protegido (vale só para ele)
  agentcontrol recusar J-001
  agentcontrol falar texto          fala na sala (o AgentC responde lá)
  agentcontrol panico [desligar]    para TODOS os agentes agora e fecha o acesso do time
  agentcontrol auditoria            últimos registros da auditoria

  --url URL       servidor (padrão http://127.0.0.1:20150 ou AGENT_CONTROL_URL)
  --token TOKEN   token do acesso de fora (ou AGENT_CONTROL_TOKEN)
  --projeto ID    projeto (padrão: o primeiro)
  --json          saída em JSON (para scripts)
`;

// ---------- argumentos ----------
const argv = process.argv.slice(2);
const opt = { url: process.env.AGENT_CONTROL_URL || 'http://127.0.0.1:20150', token: process.env.AGENT_CONTROL_TOKEN || '', projeto: '', json: false, diff: false };
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') opt.url = argv[++i] ?? opt.url;
  else if (a === '--token') opt.token = argv[++i] ?? '';
  else if (a === '--projeto' || a === '--project') opt.projeto = argv[++i] ?? '';
  else if (a === '--json') opt.json = true;
  else if (a === '--diff') opt.diff = true;
  else if (a === '-h' || a === '--help' || a === 'ajuda') { process.stdout.write(HELP); process.exit(0); }
  else args.push(a);
}
opt.url = opt.url.replace(/\/+$/, '');

// ---------- cores (desligadas fora de terminal ou com NO_COLOR) ----------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const c = { dim: paint('2'), bold: paint('1'), red: paint('31'), green: paint('32'), yellow: paint('33'), orange: paint('38;5;208'), cyan: paint('36') };
const hora = (iso) => (iso ? String(iso).replace('T', ' ').slice(11, 16) : '--:--');
const out = (s = '') => process.stdout.write(`${s}\n`);

// ---------- HTTP ----------
let csrf = '';
const headers = (extra = {}) => ({ ...(opt.token ? { Authorization: `Bearer ${opt.token}` } : {}), ...extra });
const withProject = (p) => (opt.projeto ? `${p}${p.includes('?') ? '&' : '?'}project=${encodeURIComponent(opt.projeto)}` : p);

async function call(method, p, body) {
  let r;
  try {
    if (method === 'POST' && !opt.token && !csrf) csrf = (await (await fetch(`${opt.url}/api/session`)).json()).csrf;
    r = await fetch(`${opt.url}${method === 'GET' ? withProject(p) : p}`, {
      method,
      headers: headers(method === 'POST' ? { 'Content-Type': 'application/json', ...(opt.token ? {} : { Origin: opt.url, 'X-Jarvis-Csrf': csrf }) } : {}),
      body: body ? JSON.stringify(opt.projeto ? { project: opt.projeto, ...body } : body) : undefined,
    });
  } catch {
    throw new Error(`não achei o Agent Control em ${opt.url}. Ele está ligado? (npm start ou o app do PC)`);
  }
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || `HTTP ${r.status}` }; }
  if (!r.ok) throw new Error(r.status === 401 ? 'token obrigatório ou inválido (--token)' : data.error ?? `HTTP ${r.status}`);
  return data;
}
const get = (p) => call('GET', p);
const post = (p, body) => call('POST', p, body);

// ---------- telas ----------
function fileLine(f) {
  const st = f.status === 'novo' ? c.green('novo    ') : f.status === 'apagado' ? c.red('apagado ') : c.yellow(f.status.padEnd(8));
  return `    ${st} ${f.path}  ${f.binary ? c.dim('binário') : `${c.green(`+${f.adds}`)} ${c.red(`−${f.dels}`)}`}`;
}

function agentBlock(a) {
  const live = a.changedAt && Date.now() - new Date(a.changedAt).getTime() < 45_000;
  const head = `${c.bold(a.name)} ${c.dim(`${a.branch ?? ''} ${a.head ?? ''}`)}${live ? ` ${c.orange('● mexendo agora')}` : ''}`;
  out(head);
  if (a.error) { out(`    ${c.red(a.error)}`); return; }
  if (!a.files.length) { out(`    ${c.dim('nada alterado desde o último commit')}${a.headMsg ? c.dim(` · último: ${a.headMsg}`) : ''}`); return; }
  out(`    ${a.files.length} arquivo(s) · ${c.green(`+${a.adds}`)} ${c.red(`−${a.dels}`)}`);
  for (const f of a.files.slice(0, 25)) out(fileLine(f));
  if (a.files.length > 25) out(c.dim(`    … e mais ${a.files.length - 25}`));
}

function eventLine(e) {
  const quem = c.bold(e.name.padEnd(12));
  if (e.kind === 'commit') return `${c.dim(hora(e.at))} ${quem} ${c.cyan('commit')} ${e.hash} ${e.msg ?? ''}`;
  if (e.kind === 'reverted') return `${c.dim(hora(e.at))} ${quem} ${c.dim('desfez')} ${e.path}`;
  const verbo = e.status === 'novo' ? c.green('criou ') : e.status === 'apagado' ? c.red('apagou') : c.yellow('editou');
  return `${c.dim(hora(e.at))} ${quem} ${verbo} ${e.path}  ${c.green(`+${e.adds ?? 0}`)} ${c.red(`−${e.dels ?? 0}`)}`;
}

function printDiff(d) {
  out(c.bold(`${d.name} · ${d.path}`));
  for (const line of d.diff.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line)) continue;
    out(line.startsWith('+') ? c.green(line) : line.startsWith('-') ? c.red(line) : line.startsWith('@@') ? c.cyan(line) : line);
  }
  if (d.cortado) out(c.dim('… (cortado: arquivo grande)'));
}

async function status() {
  const [st, cmds, code] = await Promise.all([get('/api/state'), get('/api/commands'), get('/api/code').catch(() => ({ agents: [] }))]);
  if (opt.json) return out(JSON.stringify({ state: st, commands: cmds, code }, null, 2));
  out(`${c.bold('Agent Control')} · Goal ${st.goal ?? c.dim('nenhum')}`);
  const byId = new Map(code.agents.map((a) => [a.agent, a]));
  for (const a of st.agents) {
    const s = a.latest?.status ?? 'sem status';
    const cor = /WORKING/.test(s) ? c.orange : /DONE/.test(s) ? c.green : /BLOCKED|FAILED/.test(s) ? c.red : c.dim;
    const k = byId.get(a.id);
    const mud = k?.files.length ? `  ${k.files.length} arq. ${c.green(`+${k.adds}`)} ${c.red(`−${k.dels}`)}` : '';
    out(`  ${(a.name ?? a.id).padEnd(14)} ${cor(s.padEnd(10))} ${c.dim(a.latest?.task ?? '')}${mud}`);
  }
  const pend = cmds.filter((x) => x.approval === 'pending');
  if (pend.length) {
    out();
    out(c.yellow(`${pend.length} esperando sua aprovação:`));
    for (const x of pend) out(`  ${c.bold(x.code)} → ${x.target}: ${x.text.slice(0, 90)}${x.precisa > 1 ? c.dim(` (${x.votos?.length ?? 0} de ${x.precisa})`) : ''}`);
    out(c.dim('  agentcontrol aprovar J-xxx  ·  agentcontrol recusar J-xxx'));
  }
}

async function codigo(agent) {
  const d = await get('/api/code');
  const list = agent ? d.agents.filter((a) => a.agent === agent.toUpperCase()) : d.agents;
  if (opt.json) return out(JSON.stringify(agent ? list : d, null, 2));
  if (!list.length) return out(agent ? `Agente ${agent} sem pasta de código.` : 'Nenhum agente com pasta de código (worktree).');
  list.forEach((a, i) => { if (i) out(); agentBlock(a); });
}

/** Lê o /events (SSE) e chama onEvent(tipo, dados). Reconecta sozinho se o servidor reiniciar. */
async function stream(onEvent) {
  for (;;) {
    try {
      const r = await fetch(`${opt.url}${withProject('/events')}`, { headers: headers({ Accept: 'text/event-stream' }) });
      if (!r.ok) throw new Error(r.status === 401 ? 'token obrigatório ou inválido (--token)' : `HTTP ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type && data) { try { await onEvent(type, JSON.parse(data)); } catch { /* evento estranho: ignora */ } }
        }
      }
    } catch (e) {
      if (/token/.test(e.message)) throw e;
    }
    out(c.dim('… conexão caiu, tentando de novo em 3 s'));
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function aoVivo() {
  const d = await get('/api/code');
  if (!opt.json) {
    out(c.bold('Código ao vivo') + c.dim(` · ${opt.url} · Ctrl+C sai`));
    out();
    d.agents.forEach((a) => agentBlock(a));
    out();
    out(c.dim('últimas mudanças:'));
    for (const e of d.feed.slice(0, 10).reverse()) out(eventLine(e));
    out(c.dim('— esperando os agentes —'));
  }
  const seen = new Set();
  await stream(async (type, ev) => {
    if (opt.json) return out(JSON.stringify({ type, ...ev }));
    if (type === 'code') {
      for (const e of ev.events ?? []) {
        out(eventLine(e));
        if (opt.diff && e.kind === 'edit' && e.status !== 'apagado') {
          try { printDiff(await get(`/api/code/diff?agent=${encodeURIComponent(e.agent)}&path=${encodeURIComponent(e.path)}`)); } catch { /* já mudou de novo */ }
        }
      }
    } else if (type === 'commands') {
      for (const x of ev.commands ?? []) {
        const key = `${x.code}:${x.status}:${x.approval}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (x.approval === 'pending') out(c.yellow(`${hora(x.updated_at)} ${x.code} espera sua aprovação → ${x.target}: ${x.text.slice(0, 80)}`));
        else out(c.dim(`${hora(x.updated_at)} ${x.code} → ${x.status}${x.updated_by ? ` (${x.updated_by})` : ''}`));
      }
    } else if (type === 'panic') out(ev.on ? c.red(`PÂNICO ligado por ${ev.by}`) : c.green('pânico desligado'));
  });
}

async function main() {
  const [cmd = 'status', ...rest] = args;
  switch (cmd) {
    case 'status': return status();
    case 'ao-vivo': case 'aovivo': case 'live': return aoVivo();
    case 'codigo': case 'código': return codigo(rest[0]);
    case 'diff': {
      if (rest.length < 2) throw new Error('use: agentcontrol diff AGENTE ARQUIVO');
      const d = await get(`/api/code/diff?agent=${encodeURIComponent(rest[0])}&path=${encodeURIComponent(rest.slice(1).join(' '))}`);
      return opt.json ? out(JSON.stringify(d, null, 2)) : printDiff(d);
    }
    case 'mandar': {
      const [to, ...words] = rest;
      if (!to || !words.length) throw new Error('use: agentcontrol mandar AGENTE texto da ordem');
      const r = await post('/api/commands', { text: words.join(' '), to: to.toUpperCase() });
      return out(opt.json ? JSON.stringify(r) : r.reply);
    }
    case 'comandos': {
      const list = await get('/api/commands');
      if (opt.json) return out(JSON.stringify(list, null, 2));
      for (const x of list.slice(0, 20)) out(`${c.bold(x.code)} ${c.dim(hora(x.updated_at))} ${(x.approval === 'pending' ? c.yellow : c.dim)(x.status.padEnd(18))} → ${x.target}: ${x.text.slice(0, 70)}`);
      return;
    }
    case 'aprovar': case 'recusar': {
      const code = (rest[0] ?? '').toUpperCase();
      if (!/^J-\d{3,}$/.test(code)) throw new Error(`use: agentcontrol ${cmd} J-001`);
      const r = await post('/api/commands/decide', { code, decision: cmd === 'aprovar' ? 'approve' : 'reject' });
      return out(opt.json ? JSON.stringify(r) : r.reply);
    }
    case 'falar': {
      if (!rest.length) throw new Error('use: agentcontrol falar texto');
      await post('/api/chat', { text: rest.join(' '), to: 'TODOS' });
      return out('Mandei na sala. O AgentC responde lá (agentcontrol ao-vivo ou a sala no navegador).');
    }
    case 'panico': case 'pânico': {
      const on = !/^(desligar|off|nao|não)$/i.test(rest[0] ?? '');
      const r = await post('/api/panic', { on });
      return out(opt.json ? JSON.stringify(r) : on ? c.red(`PÂNICO ligado: ${r.pausados.length} projeto(s) parado(s), ${r.aparelhos} aparelho(s) desligado(s).`) : c.green('Pânico desligado. Os agentes voltam na próxima rodada.'));
    }
    case 'auditoria': {
      const a = await get('/api/audit?limit=40');
      if (opt.json) return out(JSON.stringify(a, null, 2));
      out(a.verificacao.ok ? c.green(`Corrente íntegra: ${a.verificacao.total} registro(s).`) : c.red(`Registro #${a.verificacao.brokenAt} não confere: alguém mexeu no banco.`));
      for (const l of a.linhas) out(`${c.dim(String(l.at).replace('T', ' ').slice(0, 16))} ${c.bold(l.actor)} ${l.action}${l.target ? ` ${l.target}` : ''}${l.detail ? c.dim(` · ${l.detail}`) : ''}`);
      return;
    }
    default:
      process.stderr.write(`Não conheço "${cmd}".\n\n${HELP}`);
      process.exitCode = 2;
  }
}

main().catch((e) => { process.stderr.write(`${c.red('erro:')} ${e.message}\n`); process.exitCode = 1; });
