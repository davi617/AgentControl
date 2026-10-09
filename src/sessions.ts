// Sessões do navegador (iPhone/PWA), 2026-10-08. Antes o cookie guardava o PRÓPRIO token (do dono ou do convite):
// vazou o cookie, só trocando o token, o que derrubava todos os aparelhos. Agora /api/login troca o token por um
// segredo de sessão só daquele aparelho; aqui fica só o hash. Dá para ver os aparelhos e desconectar um por um.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writePrivate } from './fsutil.ts';

export const SESSION_COOKIE = 'ac_session';
export const SESSION_DAYS = 30;

export interface Session { id: string; person: string; hash: string; device: string; ip: string; created: string; expires: string }
export interface SessionView { id: string; person: string; device: string; ip: string; created: string; expires: string; lastSeen: string | null; atual: boolean }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** "iPhone · Safari" a partir do User-Agent (só para a lista de aparelhos; nada é decidido por isso). */
export function deviceName(ua: string): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${os} · ${nav}`;
}

export class Sessions {
  private list: Session[] = [];
  private seen = new Map<string, number>();
  private file: string;
  constructor(file: string) { this.file = file; this.load(); }

  private load() {
    if (!this.file) return;
    try { if (existsSync(this.file)) this.list = JSON.parse(readFileSync(this.file, 'utf8')).sessions ?? []; } catch { this.list = []; }
  }
  private save() { if (this.file) writePrivate(this.file, JSON.stringify({ sessions: this.list }, null, 2)); }
  private prune(now: number) {
    const before = this.list.length;
    this.list = this.list.filter((s) => Date.parse(s.expires) > now);
    return this.list.length !== before;
  }

  /** Abre uma sessão para `person` (DONO ou id do convite) e devolve o segredo do cookie UMA vez. */
  create(person: string, ua: string, ip: string, now = Date.now()): { session: Session; secret: string } {
    this.prune(now);
    const secret = randomBytes(32).toString('base64url');
    const session: Session = {
      id: randomBytes(6).toString('hex'), person, hash: sha(secret), device: deviceName(ua), ip,
      created: new Date(now).toISOString(), expires: new Date(now + SESSION_DAYS * 86_400_000).toISOString(),
    };
    this.list.push(session);
    // Um teto por pessoa: o login mais antigo sai (ninguém acumula centenas de sessões esquecidas).
    const mine = this.list.filter((s) => s.person === person);
    if (mine.length > 20) this.list = this.list.filter((s) => s !== mine[0]);
    this.save();
    return { session, secret };
  }

  /** Sessão dona deste segredo (comparação em tempo constante), ou null se não existe/venceu. */
  verify(secret: string, now = Date.now()): Session | null {
    if (!secret) return null;
    const h = Buffer.from(sha(secret));
    for (const s of this.list) {
      if (s.hash.length === h.length && timingSafeEqual(Buffer.from(s.hash), h)) {
        if (Date.parse(s.expires) <= now) return null;
        this.seen.set(s.id, now);
        return s;
      }
    }
    return null;
  }

  revoke(id: string): boolean {
    const before = this.list.length;
    this.list = this.list.filter((s) => s.id !== id);
    this.seen.delete(id);
    if (this.list.length === before) return false;
    this.save();
    return true;
  }
  revokeSecret(secret: string): boolean { const s = this.verify(secret); return s ? this.revoke(s.id) : false; }
  /** Tira todas as sessões de uma pessoa (removida do time). */
  revokePerson(person: string): number {
    const before = this.list.length;
    this.list = this.list.filter((s) => s.person !== person);
    const n = before - this.list.length;
    if (n) this.save();
    return n;
  }
  get(id: string): Session | undefined { return this.list.find((s) => s.id === id); }

  view(person?: string, current?: string, now = Date.now()): SessionView[] {
    if (this.prune(now)) this.save();
    return this.list.filter((s) => !person || s.person === person).map((s) => ({
      id: s.id, person: s.person, device: s.device, ip: s.ip, created: s.created, expires: s.expires,
      lastSeen: this.seen.has(s.id) ? new Date(this.seen.get(s.id)!).toISOString() : null, atual: s.id === current,
    }));
  }
}

const all = new Map<string, Sessions>();
/** Uma instância por pasta de dados, como o time: servidor local e remoto veem as mesmas sessões. */
export function sessionsFor(dataDir: string | null): Sessions {
  const file = dataDir ? path.join(dataDir, 'sessions.json') : '';
  let s = all.get(file);
  if (!s) { s = new Sessions(file); all.set(file, s); }
  return s;
}
