// Gravação de arquivo com dado sensível (time, licença): só o dono do PC lê (0600) e nunca fica pela metade.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Escreve num .tmp ao lado e troca de uma vez: queda de energia no meio não deixa JSON quebrado. */
export function writePrivate(file: string, data: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* Windows: permissão é por ACL */ }
}
