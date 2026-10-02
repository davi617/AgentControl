// Fase 2: comandos de você → bus Markdown.
// O JARVIS escreve SÓ no próprio arquivo (Goals/<ID>/JARVIS-INBOX.md) e no espelho
// .ai-team/JARVIS-INBOX.md de cada worktree. Nunca edita arquivo de agente/líder.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectCfg } from './config.ts';
import { canonicalStatus } from './parser.ts';
import { redact } from './redact.ts';
import { goalDir, nowIso } from './sources.ts';
import type { Command, Entry, Store } from './store.ts';

export const INBOX_FILE = 'JARVIS-INBOX.md';
export const MAX_COMMAND_CHARS = 4000;

// Ações que o protocolo proíbe sem autorização explícita: ficam paradas até você aprovar.
const NEEDS_APPROVAL = /\b(deploy|push|merge|rebase|release|publicar|publica|produ[cç][aã]o|prod\b|force|apagar|apaga|deletar|delete|remover|drop|billing|pagar|pagamento|compra|comprar|cr[eé]dito|plano pago)\w*/i;

export function requiresApproval(text: string): boolean {
  return NEEDS_APPROVAL.test(text);
}

const HEADER = `# JARVIS INBOX

Comandos de você enviados pelo JARVIS. **Só o JARVIS escreve aqui.**
O líder lê, distribui e responde no próprio arquivo (LEADER.md / STATUS) com \`- jarvis: J-xxx\` e \`- status: ACK | WORKING | BLOCKED | REVIEW | DONE\`.
Comando com \`requires_approval: yes\` **não pode ser executado** até existir uma entrada \`approved: J-xxx\` neste arquivo.
`;

export function inboxPath(p: ProjectCfg): string | undefined {
  const gd = goalDir(p);
  return gd ? path.join(gd, INBOX_FILE) : undefined;
}

function entryText(c: Command): string {
  const [date, time] = c.created_at.split('T');
  const body = c.text.split('\n').map((l) => `> ${l}`).join('\n');
  return [
    '',
    `## ${date} ${time.slice(0, 5)} — DONO (via JARVIS)`,
    `- jarvis: ${c.code}`,
    `- to: ${c.target}`,
    `- status: ${c.requires_approval ? 'AWAITING_APPROVAL' : 'NEW'}`,
    `- requires_approval: ${c.requires_approval ? 'yes' : 'no'}`,
    '- text:',
    '',
    body,
    '',
  ].join('\n');
}

/** Espelha o inbox para cada worktree (a pasta .ai-team é transporte ignorado pelo Git). */
export function mirrorInbox(p: ProjectCfg, src: string) {
  for (const a of p.agents) {
    if (!a.worktree) continue;
    const dir = path.join(a.worktree, '.ai-team');
    if (!existsSync(dir)) continue;
    try { copyFileSync(src, path.join(dir, INBOX_FILE)); } catch (e) { console.error(`[inbox] espelho ${a.id}:`, (e as Error).message); }
  }
}

export function createCommand(store: Store, p: ProjectCfg, rawText: string, target: string): Command {
  const file = inboxPath(p);
  if (!file) throw new Error('sem Goal ativo para receber o comando');
  const text = redact(rawText.trim()).slice(0, MAX_COMMAND_CHARS);
  const now = nowIso();
  const approval = requiresApproval(text);
  const cmd = store.addCommand({
    project: p.id,
    code: store.nextCommandCode(),
    target,
    text,
    requires_approval: approval ? 1 : 0,
    approval: approval ? 'pending' : null,
    status: approval ? 'AWAITING_APPROVAL' : 'NEW',
    updated_by: 'JARVIS',
    created_at: now,
    updated_at: now,
  });
  if (!existsSync(file)) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, HEADER); }
  appendFileSync(file, entryText(cmd));
  mirrorInbox(p, file);
  return cmd;
}

const REF = /\bJ-\d{3,}\b/g;

/**
 * Entradas novas de agentes/líder que citam J-xxx atualizam o status do comando.
 * Entradas do próprio inbox (kind 'command') são ignoradas.
 */
export function trackCommands(store: Store, entries: Entry[]): Command[] {
  const changed: Command[] = [];
  for (const e of entries) {
    if (e.kind === 'command' || !e.status) continue;
    const refs = new Set(e.body.match(REF) ?? []);
    for (const code of refs) {
      const c = store.command(code);
      if (!c || c.project !== e.project) continue;
      const status = canonicalStatus(e.status) ?? e.status;
      // Comando protegido sem aprovação não pode "andar" para WORKING/DONE — nem depois de um ACK.
      // A aprovação fica numa coluna própria justamente para o ACK não apagar esse estado.
      const blocked = c.requires_approval && c.approval !== 'approved';
      const next = c.status === 'VIOLATION' ? 'VIOLATION' : blocked && /WORKING|DONE/.test(status) ? 'VIOLATION' : status;
      store.setCommandStatus(code, next, e.agent, e.ts);
      changed.push(store.command(code)!);
    }
  }
  return changed;
}

/**
 * Fase 3: você aprova ou recusa UM comando protegido. Vale só para esse código.
 * Registra "approved: J-xxx" / "rejected: J-xxx" no JARVIS-INBOX.md (regra do GOAL_MODE_PROTOCOL).
 */
export function decideCommand(store: Store, p: ProjectCfg, code: string, decision: 'approve' | 'reject'): Command {
  const c = store.command(code);
  if (!c || c.project !== p.id) throw new Error('comando desconhecido');
  if (!c.requires_approval) throw new Error('este comando não precisa de aprovação');
  if (c.approval !== 'pending') throw new Error(`comando já ${c.approval === 'approved' ? 'aprovado' : 'recusado'}`);
  const file = inboxPath(p);
  if (!file || !existsSync(file)) throw new Error('JARVIS-INBOX.md não encontrado');
  const now = nowIso();
  const [date, time] = now.split('T');
  const approved = decision === 'approve';
  appendFileSync(file, [
    '',
    `## ${date} ${time.slice(0, 5)} — DONO (via JARVIS)`,
    `- jarvis: ${code}`,
    `- ${approved ? 'approved' : 'rejected'}: ${code}`,
    `- status: ${approved ? 'APPROVED' : 'REJECTED'}`,
    '',
    approved ? `> Aprovado por você no JARVIS. Vale só para ${code}.` : `> Recusado por você no JARVIS. Não executar ${code}.`,
    '',
  ].join('\n'));
  mirrorInbox(p, file);
  store.setApproval(code, approved ? 'approved' : 'rejected', now);
  if (c.status !== 'VIOLATION') store.setCommandStatus(code, approved ? 'APPROVED' : 'REJECTED', 'DONO', now);
  return store.command(code)!;
}
