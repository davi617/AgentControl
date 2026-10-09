// Fase 2: comandos de você → bus Markdown.
// O JARVIS escreve SÓ no próprio arquivo (Goals/<ID>/JARVIS-INBOX.md) e no espelho
// .ai-team/JARVIS-INBOX.md de cada worktree. Nunca edita arquivo de agente/líder.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectCfg } from './config.ts';
import { canonicalStatus } from './parser.ts';
import { redact } from './redact.ts';
import { goalDir, nowIso } from './sources.ts';
import type { Command, Entry, Store } from './store.ts';

export const INBOX_FILE = 'JARVIS-INBOX.md';
export const MAX_COMMAND_CHARS = 4000;

// Ações que o protocolo proíbe sem autorização explícita: ficam paradas até você aprovar.
// Na dúvida, segura: um comando parado à toa custa um toque; um push não aprovado custa caro.
const NEEDS_APPROVAL = [
  /\b(deploy|push|merge|rebase|release|publicar|publica|publish|producao|prod\b|force|apagar|apaga|deletar|delete|remover|excluir|exclui|destroy|wipe|drop|truncate|billing|pagar|pagamento|compra|comprar|credito|plano pago)\w*/,
  // git e shell que reescrevem ou somem com coisa
  /\brm\s+-[a-z]*[rf]|\breset\s+--hard|\bclean\s+-[a-z]*f|\bgit\s+tag\b|\bchmod\s+(-r\s+)?777|\b(curl|wget)\b[^|\n]*\|\s*(ba|z)?sh\b/,
  // "manda/sobe/envia pro main" sem dizer push
  /\b(pro|pra|para|para o|no|na|into|to|on)\s+(a\s+|o\s+)?(main|master)\b/,
  // infraestrutura e pacotes publicados
  /\b(terraform|pulumi)\s+(apply|destroy)|\bkubectl\s+(apply|delete|rollout|scale)|\b(npm|pnpm|yarn|cargo|twine|gem)\s+publish|\bgh\s+(release|pr\s+merge|repo\s+delete)/,
];

/** Texto para a checagem: sem acento, sem caractere invisível (git p\u200Bush), letras de largura total viram normais. */
export function normalizeForCheck(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function requiresApproval(text: string): boolean {
  const t = normalizeForCheck(text);
  return NEEDS_APPROVAL.some((re) => re.test(t));
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

/** Espelhos do inbox, um por worktree de agente. */
export function mirrorPaths(p: ProjectCfg): { agent: string; file: string }[] {
  return p.agents.filter((a) => a.worktree).map((a) => ({ agent: a.id, file: path.join(a.worktree!, '.ai-team', INBOX_FILE) }));
}

// Guarda do inbox (2026-10-08): só o JARVIS escreve no JARVIS-INBOX.md, mas o espelho fica na worktree do agente,
// onde ele PODE escrever. Um "approved: J-xxx" forjado não libera nada no JARVIS (a aprovação vale pelo banco), mas
// engana os outros agentes que leem o arquivo. Aqui fica o que o JARVIS escreveu por último; diferente disso = mexeram.
const written = new Map<string, string>();
const key = (f: string) => path.resolve(f).toLowerCase();
const readOr = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
function remember(file: string) { const t = readOr(file); if (t !== null) written.set(key(file), t); }

/** Espelha o inbox para cada worktree (a pasta .ai-team é transporte ignorado pelo Git). */
export function mirrorInbox(p: ProjectCfg, src: string) {
  remember(src);
  for (const { agent, file } of mirrorPaths(p)) {
    if (!existsSync(path.dirname(file))) continue;
    try { copyFileSync(src, file); } catch (e) { console.error(`[inbox] espelho ${agent}:`, (e as Error).message); }
  }
}

/** Ao ligar: o que está no disco agora é o ponto de partida (não há como saber o que mudou com o JARVIS desligado). */
export function trustInbox(p: ProjectCfg) {
  const src = inboxPath(p);
  if (src && !written.has(key(src))) remember(src);
}

/**
 * Um arquivo de inbox mudou. Se não é o que o JARVIS escreveu, restaura e devolve quem mexeu
 * (o agente dono da worktree, ou "alguém" no inbox do vault). null = está tudo certo / não é inbox.
 */
export function guardInbox(p: ProjectCfg, changed: string): string | null {
  const src = inboxPath(p);
  if (!src) return null;
  const expected = written.get(key(src));
  if (expected === undefined) return null;
  if (key(changed) === key(src)) {
    if (readOr(src) === expected) return null;
    writeFileSync(src, expected);
    mirrorInbox(p, src);
    return 'alguém (no vault)';
  }
  const m = mirrorPaths(p).find((x) => key(x.file) === key(changed));
  if (!m || !existsSync(path.dirname(m.file))) return null;
  if (readOr(m.file) === expected) return null;
  copyFileSync(src, m.file);
  return m.agent;
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
  // Mexeram no inbox desde a última escrita? Volta ao certo antes de acrescentar (o append não legitima a mudança).
  const before = written.get(key(file));
  if (before !== undefined && readOr(file) !== before) writeFileSync(file, before);
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
    approved ? `> Aprovado por você no Agent Control. Vale só para ${code}.` : `> Recusado por você no Agent Control. Não executar ${code}.`,
    '',
  ].join('\n'));
  mirrorInbox(p, file);
  store.setApproval(code, approved ? 'approved' : 'rejected', now);
  if (c.status !== 'VIOLATION') store.setCommandStatus(code, approved ? 'APPROVED' : 'REJECTED', 'DONO', now);
  return store.command(code)!;
}
