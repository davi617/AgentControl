// Modo Time (2026-10-03): várias pessoas trabalhando junto com os agentes, cada uma com nome, papel e acesso próprio.
// O dono é quem usa o PC (e o token remoto principal). Os outros entram por convite: um token só deles, que fica
// guardado aqui só como hash. Papel: dono (tudo, inclusive aprovar) · membro (manda ordem e fala) · leitura (só vê).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writePrivate } from './fsutil.ts';

export type Role = 'dono' | 'membro' | 'leitura';
export interface Person { id: string; name: string; role: Role; color: string; tokenHash?: string; created: string }
export interface Who { id: string; name: string; role: Role; owner: boolean }
export interface PersonView { id: string; name: string; role: Role; color: string; online: boolean; lastSeen: string | null; via: string | null }

export const OWNER: Who = { id: 'DONO', name: 'Dono', role: 'dono', owner: true };
const COLORS = ['#F97316', '#22C55E', '#3B82F6', '#A855F7', '#EC4899', '#EAB308', '#14B8A6', '#EF4444'];
/** Online = fez algum pedido nos últimos 90 s (o app pergunta a cada poucos segundos). */
export const ONLINE_MS = 90_000;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Emite 'removed' (id) quando alguém sai do time: o servidor fecha o que essa pessoa ainda tinha aberto (SSE). */
export class Team extends EventEmitter {
  private people: Person[] = [];
  private seen = new Map<string, { at: number; via: string }>();
  private file: string;
  constructor(file: string) { super(); this.setMaxListeners(0); this.file = file; this.load(); }

  private load() {
    if (!this.file) return; // sem arquivo: time só em memória (testes)
    try { if (existsSync(this.file)) this.people = JSON.parse(readFileSync(this.file, 'utf8')).people ?? []; } catch { this.people = []; }
  }
  private save() {
    if (!this.file) return;
    writePrivate(this.file, JSON.stringify({ people: this.people }, null, 2));
  }

  /** Cria uma pessoa e devolve o token UMA vez (só o hash fica salvo). */
  invite(name: string, role: Role): { person: Person; token: string } {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) throw new Error('diga o nome da pessoa');
    if (!['dono', 'membro', 'leitura'].includes(role)) throw new Error('papel inválido');
    const base = clean.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'PESSOA';
    let id = base, n = 2;
    while (id === OWNER.id || id === 'CHATGPT' || id === 'JARVIS' || this.people.some((p) => p.id === id)) id = `${base}_${n++}`;
    const token = randomBytes(24).toString('hex');
    const person: Person = { id, name: clean, role, color: COLORS[this.people.length % COLORS.length], tokenHash: sha(token), created: new Date().toISOString() };
    this.people.push(person);
    this.save();
    return { person: { ...person, tokenHash: undefined }, token };
  }

  remove(id: string): boolean {
    const before = this.people.length;
    this.people = this.people.filter((p) => p.id !== id);
    this.seen.delete(id);
    if (this.people.length === before) return false;
    this.save();
    this.emit('removed', id);
    return true;
  }

  setRole(id: string, role: Role): boolean {
    const p = this.people.find((x) => x.id === id);
    if (!p || !['dono', 'membro', 'leitura'].includes(role)) return false;
    p.role = role;
    this.save();
    return true;
  }

  /** Quem é o dono deste token de convite (comparação em tempo constante). */
  byToken(token: string): Who | null {
    if (!token) return null;
    const h = Buffer.from(sha(token));
    for (const p of this.people) {
      if (p.tokenHash && p.tokenHash.length === h.length && timingSafeEqual(Buffer.from(p.tokenHash), h)) return { id: p.id, name: p.name, role: p.role, owner: false };
    }
    return null;
  }

  touch(who: Who, via: string) { this.seen.set(who.id, { at: Date.now(), via }); }

  /** Todos (o dono primeiro) com online/visto por último. */
  list(ownerName = 'Você'): PersonView[] {
    const view = (id: string, name: string, role: Role, color: string): PersonView => {
      const s = this.seen.get(id);
      return { id, name, role, color, online: !!s && Date.now() - s.at < ONLINE_MS, lastSeen: s ? new Date(s.at).toISOString() : null, via: s?.via ?? null };
    };
    return [view(OWNER.id, ownerName, 'dono', '#F97316'), ...this.people.map((p) => view(p.id, p.name, p.role, p.color))];
  }

  ids(): string[] { return this.people.map((p) => p.id); }
  name(id: string): string | undefined { return this.people.find((p) => p.id === id)?.name; }
}

const teams = new Map<string, Team>();
/** Uma instância por arquivo: o servidor local e o remoto enxergam as mesmas pessoas e a mesma presença. */
export function teamFor(dataDir: string | null): Team {
  const file = dataDir ? path.join(dataDir, 'team.json') : '';
  let t = teams.get(file);
  if (!t) { t = new Team(file); teams.set(file, t); }
  return t;
}

/** @menções no texto que batem com alguém do time (pessoas ou agentes), sem repetir. */
export function mentions(text: string, known: string[]): string[] {
  const set = new Set(known.map((k) => k.toUpperCase()));
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_.])@([\p{L}\p{N}_]{2,24})/gu)) {
    const id = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (set.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
