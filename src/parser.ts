// Parser do bus Markdown do Goal Mode.
// Formatos reais (Fase 0, F4): contrato "## YYYY-MM-DD HH:mm — AGENTE" (com — ou -),
// relatório livre por seções (## ACK, ## Inspecionado…) e placeholder sem seções.

import { createHash } from 'node:crypto';

export interface Section {
  heading: string; // texto do "## …" sem os #; "" quando o arquivo não tem seções
  body: string; // conteúdo da seção (sem a linha do heading)
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  agent?: string; // agente do heading do contrato
  fields: Record<string, string>; // "- chave: valor"
  hash: string;
}

const CONTRACT_HEADING = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?\s*(?:[—–-]\s*(.+))?$/;
const FIELD = /^\s*[-*]\s+([A-Za-z_][\w -]{0,40}?)\s*:\s*(.*)$/;

export const STATUS_VALUES = [
  'ACK', 'WORKING', 'BLOCKED', 'REVIEW', 'DONE', 'STOPPED', 'FAILED', 'IDLE_NO_SAFE_TASK',
  'ASSIGNED', 'QUEUED', 'NOT_RUN', 'NEEDS_HUMAN_REVIEW',
] as const;

export function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

export function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue; // modelos de formato dentro de ``` não são status reais
    const m = FIELD.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/[\s-]+/g, '_');
    const value = m[2].trim();
    if (/^<[^>]*>$/.test(value) || (key === 'status' && / \| /.test(value))) continue; // placeholder "<T-xxx>" ou "ACK | WORKING"
    if (!(key in fields)) fields[key] = value;
  }
  return fields;
}

/** Status canônico: primeira palavra conhecida do campo status (ex.: "BLOCKED_QUOTA" → BLOCKED). */
export function canonicalStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/[`*]/g, '').trim().toUpperCase();
  for (const v of STATUS_VALUES) if (s === v || s.startsWith(v + '_') || s.startsWith(v + ' ')) return v;
  const first = s.split(/[\s|,;(]/)[0];
  return first || undefined;
}

/** Sem campo "status": procura um status conhecido no texto (o Hermes escreve "- task: T-007 (DONE desde…)"). */
export function statusInText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.toUpperCase();
  return STATUS_VALUES.find((v) => new RegExp(`(^|[^A-Z_])${v}([^A-Z_]|$)`).test(s));
}
/**
 * Divide um .md em seções de nível 2 (##). Seções de nível 3+ ficam dentro da seção-mãe.
 * O texto antes do primeiro ## (título # e preâmbulo) só vira seção se o arquivo não tiver ##.
 */
export function splitSections(text: string): Section[] {
  const lines = text.split('\n');
  const chunks: Array<{ heading: string; lines: string[] }> = [];
  let preamble: string[] = [];
  let cur: { heading: string; lines: string[] } | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h && !line.startsWith('###')) {
      cur = { heading: h[1].trim(), lines: [] };
      chunks.push(cur);
    } else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }

  if (chunks.length === 0) {
    const body = preamble.join('\n').trim();
    if (!body) return [];
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? '';
    const rest = body.replace(/^#\s+.+$/m, '').trim();
    return [makeSection(title, rest)];
  }
  return chunks.map((c) => makeSection(c.heading, c.lines.join('\n').trim()));
}

function makeSection(heading: string, body: string): Section {
  const m = CONTRACT_HEADING.exec(heading);
  const s: Section = { heading, body, fields: parseFields(body), hash: sha(heading + '\n' + body) };
  if (m) {
    s.date = m[1];
    s.time = m[2]?.padStart(5, '0');
    if (m[3]) s.agent = m[3].replace(/\(.*\)\s*$/, '').trim().toUpperCase() || undefined;
  }
  return s;
}

export interface TaskRow {
  id: string;
  owner: string;
  status: string;
  task: string;
  gate: string;
  table: string; // título da seção onde a tabela está
}

/** Lê todas as tabelas Markdown de TASKS.md cujo cabeçalho começa com ID | Owner | Status. */
export function parseTasks(text: string): TaskRow[] {
  const rows: TaskRow[] = [];
  let table = 'Tarefas';
  let cols: string[] | null = null;
  for (const line of text.split('\n')) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) { table = h[1].trim(); cols = null; continue; }
    if (!line.trim().startsWith('|')) { cols = null; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!cols) {
      if (cells[0]?.toLowerCase() === 'id') cols = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    const get = (name: string) => cells[cols!.indexOf(name)] ?? '';
    rows.push({
      id: get('id'),
      owner: get('owner'),
      status: get('status'),
      task: get('task'),
      gate: get('gate') || get('target'),
      table,
    });
  }
  return rows;
}

/** Valor de uma linha "- chave: `valor`" em arquivos tipo ACTIVE_GOAL.md. */
export function readKey(text: string, key: string): string | undefined {
  const re = new RegExp('^\\s*[-*]\\s+' + key + '\\s*:\\s*`?([^`\\n]+)`?', 'mi');
  return re.exec(text)?.[1]?.trim();
}
