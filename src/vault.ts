// Cérebro no celular: busca e leitura (só leitura) das notas do vault do Obsidian.
// Nada sai do vault: caminho validado dentro dele, só .md, pastas ocultas fora e segredos mascarados.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { redact } from './redact.ts';

export interface NoteHit { path: string; title: string; folder: string; mtime: string; snippet: string }

/** Texto das notas já lido (por caminho e mtime): a busca relia o vault inteiro a cada tecla. */
const textCache = new Map<string, { mtime: number; raw: string; folded: string }>();
const TEXT_CACHE_MAX = 1500;
function noteText(vault: string, f: { rel: string; mtime: number }): { raw: string; folded: string } | undefined {
  const key = `${vault}::${f.rel}`;
  const hit = textCache.get(key);
  if (hit && hit.mtime === f.mtime) return hit;
  let raw: string;
  try { raw = readFileSync(path.join(vault, f.rel), 'utf8'); } catch { return undefined; }
  if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value!);
  const entry = { mtime: f.mtime, raw, folded: fold(raw) };
  textCache.set(key, entry);
  return entry;
}

let cache: { vault: string; at: number; files: { rel: string; mtime: number }[] } | undefined;

/** Todas as notas .md (sem .obsidian, .git, .trash…). Lista guardada por 60 s. */
export function listNotes(vault: string): { rel: string; mtime: number }[] {
  if (cache && cache.vault === vault && Date.now() - cache.at < 60_000) return cache.files;
  const files: { rel: string; mtime: number }[] = [];
  // Pasta ou nota que some/trava no meio (OneDrive, EBUSY) não derruba a busca: só fica de fora da lista.
  const walk = (dir: string) => {
    let items: import('node:fs').Dirent[];
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of items) {
      if (d.name.startsWith('.')) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.toLowerCase().endsWith('.md')) {
        try { files.push({ rel: path.relative(vault, full).replace(/\\/g, '/'), mtime: statSync(full).mtimeMs }); } catch { /* sumiu agora */ }
      }
    }
  };
  walk(vault);
  cache = { vault, at: Date.now(), files };
  return files;
}

const title = (rel: string) => path.basename(rel, '.md');
const folder = (rel: string) => rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Sem busca: as notas mexidas por último. Com busca: título vale mais que conteúdo. */
export function searchNotes(vault: string, q: string, limit = 40): { total: number; hits: NoteHit[] } {
  const files = listNotes(vault);
  const terms = fold(q).split(/\s+/).filter(Boolean);
  const scored: { f: { rel: string; mtime: number }; score: number; snippet: string }[] = [];
  for (const f of files) {
    if (!terms.length) { scored.push({ f, score: f.mtime, snippet: '' }); continue; }
    const t = fold(f.rel);
    let text: ReturnType<typeof noteText>;
    let score = 0;
    for (const term of terms) {
      if (t.includes(term)) { score += 10; continue; }
      text ??= noteText(vault, f);
      if (!text?.folded.includes(term)) { score = 0; break; }
      score += 1;
    }
    if (!score) continue;
    const raw = (text ?? noteText(vault, f))?.raw.replace(/^---[\s\S]*?\n---\s*/, '') ?? '';
    const i = fold(raw).indexOf(terms[0]);
    const snippet = raw.slice(Math.max(0, i - 60), Math.max(0, i - 60) + 180).replace(/\s+/g, ' ').trim();
    scored.push({ f, score: score * 1e13 + f.mtime, snippet: redact(snippet) });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    total: files.length,
    hits: scored.slice(0, limit).map(({ f, snippet }) => ({ path: f.rel, title: title(f.rel), folder: folder(f.rel), mtime: new Date(f.mtime).toISOString(), snippet })),
  };
}

/** Lê uma nota pelo caminho relativo; undefined se sair do vault ou não for .md. */
export function readNote(vault: string, rel: string): { path: string; title: string; text: string; links: string[] } | undefined {
  if (!rel.toLowerCase().endsWith('.md') || rel.split(/[\\/]/).some((s) => s.startsWith('.'))) return undefined;
  const root = path.resolve(vault);
  const full = path.resolve(root, rel);
  if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return undefined;
  let text: string;
  try { text = readFileSync(full, 'utf8'); } catch { return undefined; }
  const clean = redact(text).slice(0, 60_000);
  // [[link]] → caminho da nota, para o app abrir tocando.
  const byTitle = new Map(listNotes(vault).map((f) => [fold(title(f.rel)), f.rel]));
  const links = [...new Set([...clean.matchAll(/\[\[([^\]|#]+)/g)].map((m) => byTitle.get(fold(m[1].trim().split('/').pop()!))).filter((x): x is string => !!x))].slice(0, 60);
  return { path: path.relative(root, full).replace(/\\/g, '/'), title: title(full), text: clean, links };
}
