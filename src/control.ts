// Botão "Parar todos os agentes" (pedido do dono, 2026-09-26): o arquivo PAUSE na pasta dos agentes
// faz o night-agent-loop não começar rodada nova; com "agora" dentro, corta também a rodada em andamento.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface PauseState { paused: boolean; agora: boolean; desde: string | null }

const file = (dir: string) => path.join(dir, 'PAUSE');

export function pauseState(dir: string): PauseState {
  const f = file(dir);
  if (!existsSync(f)) return { paused: false, agora: false, desde: null };
  return { paused: true, agora: /agora/.test(readFileSync(f, 'utf8')), desde: statSync(f).mtime.toISOString() };
}

export function setPause(dir: string, on: boolean, agora = false): PauseState {
  if (on) writeFileSync(file(dir), `${agora ? 'agora' : 'depois da rodada'} · pausado pelo dono no JARVIS em ${new Date().toISOString()}\n`);
  else rmSync(file(dir), { force: true });
  return pauseState(dir);
}
