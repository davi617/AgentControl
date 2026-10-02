// Notas rápidas do dono pelo app: não passa pela sala nem gasta a fila da NVIDIA.
// Fica no banco (para marcar feito/apagar na hora) e também no vault (fonte da verdade operacional).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { redact } from './redact.ts';
import type { ProjectCfg } from './config.ts';
import type { Note, Store } from './store.ts';

const FILE = 'Notas Rapidas.md';

function notesFile(p: ProjectCfg): string {
  return path.join(p.vault, '20-Operations', FILE);
}

export function addNote(store: Store, p: ProjectCfg, rawText: string): Note {
  const text = redact(rawText.trim()).slice(0, 2000);
  if (!text) throw new Error('nota vazia');
  const note = store.addNote(p.id, text);
  const file = notesFile(p);
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '# Notas rápidas\n\nAnotações do dono pelo app do JARVIS. Marcadas como feitas continuam aqui riscadas.\n\n');
  appendFileSync(file, `- [ ] ${note.created_at.slice(0, 16).replace('T', ' ')} — ${text}\n`);
  return note;
}

/** Reescreve o arquivo do zero (todas as notas atuais) para refletir feito/apagado sem duplicar. */
export function syncNotesFile(store: Store, p: ProjectCfg) {
  const notes = store.notes(p.id, 500).slice().reverse();
  const lines = notes.map((n) => `- [${n.done ? 'x' : ' '}] ${n.created_at.slice(0, 16).replace('T', ' ')} — ${n.text}`);
  const file = notesFile(p);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# Notas rápidas\n\nAnotações do dono pelo app do JARVIS. Marcadas como feitas continuam aqui riscadas.\n\n${lines.join('\n')}\n`);
}

export function readNotesFile(p: ProjectCfg): string | null {
  const file = notesFile(p);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
