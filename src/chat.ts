// Sala central: um chat único com todos os agentes.
// Regra de posse: cada agente escreve SÓ o próprio arquivo:
//   - com acesso ao vault:   <vault>/<chatDir>/<AGENTE>.md
//   - em worktree sandboxed: <worktree>/.ai-team/CHAT.md
// O JARVIS lê todos, junta num fio (SALA.md, só ele escreve) e espelha em .ai-team/SALA.md.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectCfg } from './config.ts';
import { redact } from './redact.ts';
import { nowIso, type SourceFile } from './sources.ts';
import type { Entry, Store } from './store.ts';

export const SALA_FILE = 'SALA.md';
const RESERVED = new Set([SALA_FILE.toLowerCase(), 'readme.md']);
const ID_RE = /^[A-Z0-9_-]{2,32}$/;

export function chatDir(p: ProjectCfg): string | undefined {
  return p.chatDir ? path.join(p.vault, p.chatDir) : undefined;
}

/** Arquivo de chat → SourceFile, ou undefined se não for arquivo de agente (SALA, README, nome inválido). */
export function chatSourceFor(p: ProjectCfg, file: string): SourceFile | undefined {
  const dir = chatDir(p);
  if (!dir || path.resolve(path.dirname(file)).toLowerCase() !== path.resolve(dir).toLowerCase()) return undefined;
  const base = path.basename(file);
  if (!base.toLowerCase().endsWith('.md') || RESERVED.has(base.toLowerCase())) return undefined;
  const id = base.slice(0, -3).toUpperCase();
  return ID_RE.test(id) ? { path: file, kind: 'chat', agent: id } : undefined;
}

export function chatSources(p: ProjectCfg): SourceFile[] {
  const out: SourceFile[] = [];
  const dir = chatDir(p);
  if (dir) {
    const ids = new Set(['DONO', 'JARVIS', ...p.agents.map((a) => a.id)]);
    if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.toLowerCase().endsWith('.md')) ids.add(n.slice(0, -3).toUpperCase());
    for (const id of ids) {
      const s = chatSourceFor(p, path.join(dir, `${id}.md`));
      if (s) out.push(s);
    }
  }
  for (const a of p.agents) if (a.worktree) out.push({ path: path.join(a.worktree, '.ai-team', 'CHAT.md'), kind: 'chat', agent: a.id });
  return out;
}

/** Destinatário e assunto ficam nas linhas "- para:" / "- assunto:" do corpo. */
export function chatMeta(body: string): { para: string; assunto: string | null; text: string } {
  const para = /^\s*-\s*para\s*:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? 'TODOS';
  const assunto = /^\s*-\s*assunto\s*:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? null;
  const text = body.replace(/^\s*-\s*(para|assunto|via)\s*:.*$/gim, '').trim();
  return { para, assunto, text };
}

/** Reescreve o fio único (últimas mensagens em ordem cronológica) e espelha para as worktrees. */
export function writeSala(store: Store, p: ProjectCfg): string | undefined {
  const dir = chatDir(p);
  if (!dir) return undefined;
  mkdirSync(dir, { recursive: true });
  const msgs = store.chat(p.id, 300);
  const lines = [
    '# SALA — chat central dos agentes',
    '',
    `> Gerado pelo Agent Control em ${nowIso().replace('T', ' ')}. **Não edite este arquivo.**`,
    `> Para falar: escreva no SEU arquivo (\`${p.chatDir}/<AGENTE>.md\` ou \`.ai-team/CHAT.md\`) no formato:`,
    '> `## AAAA-MM-DD HH:mm — AGENTE` + `- para: TODOS|AGENTE` + `- assunto:` + texto.',
    '',
  ];
  for (const m of msgs) {
    lines.push(`## ${m.ts.replace('T', ' ').slice(0, 16)} — ${m.agent}`);
    lines.push(m.body.trim(), '');
  }
  const file = path.join(dir, SALA_FILE);
  writeFileSync(file, lines.join('\n'));
  for (const a of p.agents) {
    const d = a.worktree && path.join(a.worktree, '.ai-team');
    if (d && existsSync(d)) {
      try { copyFileSync(file, path.join(d, SALA_FILE)); } catch (e) { console.error(`[sala] espelho ${a.id}:`, (e as Error).message); }
    }
  }
  return file;
}

/**
 * Mensagem enviada pela tela do JARVIS.
 * as=DONO → CHAT/DONO.md · as=CHATGPT → CHAT/CHATGPT.md marcado "via: colado por você"
 * (o app do ChatGPT não escreve arquivo sozinho; você cola a resposta dele).
 */
export function postChat(p: ProjectCfg, as: string, para: string, assunto: string, raw: string): string {
  // Modo Time: além de DONO/CHATGPT/JARVIS, cada pessoa do time escreve no próprio arquivo (ANA.md).
  if (!/^[A-Z0-9_]{2,24}$/.test(as)) throw new Error('autor inválido');
  const dir = chatDir(p);
  if (!dir) throw new Error('chat não configurado');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${as}.md`);
  const who = as === 'DONO' ? 'o Agent Control (em nome do dono)' : as === 'JARVIS' ? 'o AgentC (respostas ao dono)'  : as === 'CHATGPT' ? 'o ChatGPT (ou o Agent Control, quando o dono cola a resposta)' : `o JARVIS (em nome de ${as}, pessoa do time)`;
  if (!existsSync(file)) writeFileSync(file, `# ${as}\n\nMensagens de ${as} na sala central. Só ${who} escreve aqui.\n`);
  const [date, time] = nowIso().split('T');
  // Uma linha "## …" no corpo viraria outra mensagem no parser (data e título inventados); o espaço na frente a impede.
  const text = redact(raw.trim()).slice(0, 8000).replace(/^(#{2,})/gm, ' $1');
  const out = [
    '',
    `## ${date} ${time.slice(0, 5)} — ${as}`,
    `- para: ${para}`,
    ...(assunto ? [`- assunto: ${assunto.replace(/\n/g, ' ').slice(0, 120)}`] : []),
    ...(as === 'CHATGPT' ? ['- via: app do ChatGPT, colado por você no Agent Control'] : []),
    '',
    text,
    '',
  ].join('\n');
  appendFileSync(file, out);
  return file;
}

export function isChat(e: Entry): boolean { return e.kind === 'chat'; }
