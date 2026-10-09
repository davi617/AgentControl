import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Entry {
  id: number;
  project: string;
  source: string; // caminho do arquivo de origem
  kind: string; // status | leader | events | decisions | inbox | goal | doc
  agent: string; // dono do arquivo (ou autor do heading no LEADER/EVENTS)
  heading: string;
  body: string; // já normalizado e filtrado
  task: string | null;
  status: string | null;
  model: string | null;
  ts: string; // ISO; data do heading quando existir, senão mtime do arquivo
  seen_at: string; // quando o JARVIS viu pela primeira vez
  initial: number; // 1 = importado na primeira varredura (não é "novidade")
}

export interface Summary {
  id: number;
  project: string;
  created_at: string;
  kind: string; // deterministic | llm
  model: string | null;
  status: string; // OK | NOT_RUN | FAILED
  text: string;
}

export interface Command {
  id: number;
  project: string;
  code: string; // J-001
  target: string; // LEADER ou id do agente
  text: string;
  requires_approval: number; // 1 = deploy/push/merge/… parado até aprovação de você
  approval: 'pending' | 'approved' | 'rejected' | null; // separado de status: um ACK não apaga a pendência
  status: string; // NEW | ACK | WORKING | BLOCKED | REVIEW | DONE | FAILED | AWAITING_APPROVAL
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, agent TEXT NOT NULL,
        heading TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL,
        task TEXT, status TEXT, model TEXT,
        ts TEXT NOT NULL, seen_at TEXT NOT NULL, initial INTEGER NOT NULL DEFAULT 0,
        UNIQUE(project, source, hash)
      );
      CREATE INDEX IF NOT EXISTS entries_feed ON entries(project, ts DESC, id DESC);
      -- chat(), latestByAgent() e o feed filtrado por agente filtravam por kind/agent sem índice.
      CREATE INDEX IF NOT EXISTS entries_kind ON entries(project, kind, ts DESC, id DESC);
      CREATE INDEX IF NOT EXISTS entries_agent ON entries(project, agent, kind, ts DESC, id DESC);
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, hash TEXT NOT NULL, mtime TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, code TEXT NOT NULL UNIQUE, target TEXT NOT NULL, text TEXT NOT NULL,
        requires_approval INTEGER NOT NULL, status TEXT NOT NULL, updated_by TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS commands_project ON commands(project, id DESC);
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL,
        model TEXT, status TEXT NOT NULL, text TEXT NOT NULL
      );
      -- Nota rápida do dono pelo app: não passa pelo chat nem gasta a fila. Vai para o vault (20-Operations/Notas Rapidas).
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
      );
      -- Notas do Cérebro (vault) marcadas para achar rápido.
      CREATE TABLE IF NOT EXISTS favorites (
        project TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, added_at TEXT NOT NULL,
        PRIMARY KEY (project, path)
      );
      -- Comandos prontos do dono (atalhos): texto + destino, um toque no app.
      CREATE TABLE IF NOT EXISTS shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL
      );
      -- Quais avisos o dono quer no celular (aprovação, comando concluído, resposta do JARVIS, RAM baixa…).
      CREATE TABLE IF NOT EXISTS alert_prefs (
        project TEXT PRIMARY KEY, prefs TEXT NOT NULL
      );
      -- Personagens do Modo Prédio (só cores e estilos; a foto nunca vem para cá).
      CREATE TABLE IF NOT EXISTS looks (
        project TEXT NOT NULL, id TEXT NOT NULL, look TEXT NOT NULL, PRIMARY KEY (project, id)
      );
    `);
    // Migração: bancos da Fase 2 não têm a coluna approval.
    const cols = this.db.prepare('PRAGMA table_info(commands)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'approval')) {
      this.db.exec('ALTER TABLE commands ADD COLUMN approval TEXT');
      this.db.exec("UPDATE commands SET approval = 'pending' WHERE requires_approval = 1");
    }
  }

  fileHash(p: string): string | undefined {
    const row = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(p) as { hash: string } | undefined;
    return row?.hash;
  }

  setFile(p: string, hash: string, mtime: string) {
    this.db.prepare('INSERT INTO files(path, hash, mtime) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, mtime=excluded.mtime')
      .run(p, hash, mtime);
  }

  /** Insere se (project, source, hash) ainda não existe. Devolve a entrada nova ou undefined. */
  insert(e: Omit<Entry, 'id'> & { hash: string }): Entry | undefined {
    const r = this.db.prepare(`INSERT OR IGNORE INTO entries
      (project, source, kind, agent, heading, body, hash, task, status, model, ts, seen_at, initial)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(e.project, e.source, e.kind, e.agent, e.heading, e.body, e.hash, e.task, e.status, e.model, e.ts, e.seen_at, e.initial);
    if (!r.changes) return undefined;
    return this.db.prepare('SELECT * FROM entries WHERE id = ?').get(r.lastInsertRowid) as unknown as Entry;
  }

  feed(project: string, opts: { agent?: string; before?: number; limit?: number } = {}): Entry[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where = ['project = ?'];
    const args: Array<string | number> = [project];
    if (opts.agent) { where.push('agent = ?'); args.push(opts.agent); }
    if (opts.before) {
      // A lista é ordenada por data (ts), não por id: continuar do `id <` pulava ou repetia mensagens quando as duas ordens diferem.
      const ref = this.db.prepare('SELECT ts FROM entries WHERE id = ? AND project = ?').get(opts.before, project) as { ts: string } | undefined;
      if (ref) { where.push('(ts < ? OR (ts = ? AND id < ?))'); args.push(ref.ts, ref.ts, opts.before); }
      else { where.push('id < ?'); args.push(opts.before); }
    }
    return this.db.prepare(`SELECT * FROM entries WHERE ${where.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT ${limit}`)
      .all(...args) as unknown as Entry[];
  }

  since(project: string, isoTs: string, limit = 200): Entry[] {
    return this.db.prepare('SELECT * FROM entries WHERE project = ? AND seen_at >= ? AND initial = 0 ORDER BY id DESC LIMIT ?')
      .all(project, isoTs, limit) as unknown as Entry[];
  }

  /** Últimas mensagens da sala central em ordem cronológica. */
  chat(project: string, limit = 300): Entry[] {
    const rows = this.db.prepare(`SELECT * FROM entries WHERE project = ? AND kind = 'chat' ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(project, limit) as unknown as Entry[];
    return rows.reverse();
  }

  latestByAgent(project: string, agent: string): Entry | undefined {
    return this.db.prepare(`SELECT * FROM entries WHERE project = ? AND agent = ? AND kind = 'status'
      ORDER BY ts DESC, id DESC LIMIT 1`).get(project, agent) as unknown as Entry | undefined;
  }

  nextCommandCode(): string {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM commands').get() as { n: number };
    return `J-${String(Number(row.n) + 1).padStart(3, '0')}`;
  }

  addCommand(c: Omit<Command, 'id'>): Command {
    const r = this.db.prepare(`INSERT INTO commands(project, code, target, text, requires_approval, approval, status, updated_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(c.project, c.code, c.target, c.text, c.requires_approval, c.approval, c.status, c.updated_by, c.created_at, c.updated_at);
    return { ...c, id: Number(r.lastInsertRowid) };
  }

  command(code: string): Command | undefined {
    return this.db.prepare('SELECT * FROM commands WHERE code = ?').get(code) as unknown as Command | undefined;
  }

  setCommandStatus(code: string, status: string, by: string, at: string) {
    this.db.prepare('UPDATE commands SET status = ?, updated_by = ?, updated_at = ? WHERE code = ?').run(status, by, at, code);
  }

  setApproval(code: string, approval: 'approved' | 'rejected', at: string) {
    this.db.prepare('UPDATE commands SET approval = ?, updated_at = ? WHERE code = ?').run(approval, at, code);
  }

  commands(project: string, limit = 50): Command[] {
    return this.db.prepare('SELECT * FROM commands WHERE project = ? ORDER BY id DESC LIMIT ?').all(project, limit) as unknown as Command[];
  }

  /** Comandos criados a partir de um instante (filtra no SQLite em vez de trazer 1000 linhas para filtrar em JS). */
  commandsSince(project: string, sinceIso: string): Command[] {
    return this.db.prepare('SELECT * FROM commands WHERE project = ? AND created_at >= ? ORDER BY id DESC').all(project, sinceIso) as unknown as Command[];
  }

  addSummary(s: Omit<Summary, 'id'>): Summary {
    const r = this.db.prepare('INSERT INTO summaries(project, created_at, kind, model, status, text) VALUES (?,?,?,?,?,?)')
      .run(s.project, s.created_at, s.kind, s.model, s.status, s.text);
    return { ...s, id: Number(r.lastInsertRowid) };
  }

  summaries(project: string, limit = 20): Summary[] {
    return this.db.prepare('SELECT * FROM summaries WHERE project = ? ORDER BY id DESC LIMIT ?')
      .all(project, limit) as unknown as Summary[];
  }

  lastSummary(project: string, kind: string): Summary | undefined {
    return this.db.prepare('SELECT * FROM summaries WHERE project = ? AND kind = ? ORDER BY id DESC LIMIT 1')
      .get(project, kind) as unknown as Summary | undefined;
  }

  // ---------- notas rápidas ----------
  addNote(project: string, text: string): Note {
    const r = this.db.prepare('INSERT INTO notes(project, text, created_at, done) VALUES (?,?,?,0)').run(project, text, nowIso());
    return { id: Number(r.lastInsertRowid), project, text, created_at: nowIso(), done: 0 };
  }
  notes(project: string, limit = 200): Note[] {
    return this.db.prepare('SELECT * FROM notes WHERE project = ? ORDER BY done ASC, id DESC LIMIT ?').all(project, limit) as unknown as Note[];
  }
  setNoteDone(project: string, id: number, done: boolean) {
    this.db.prepare('UPDATE notes SET done = ? WHERE project = ? AND id = ?').run(done ? 1 : 0, project, id);
  }
  deleteNote(project: string, id: number) {
    this.db.prepare('DELETE FROM notes WHERE project = ? AND id = ?').run(project, id);
  }

  // ---------- favoritos do cérebro ----------
  addFavorite(project: string, path: string, title: string) {
    this.db.prepare('INSERT INTO favorites(project, path, title, added_at) VALUES (?,?,?,?) ON CONFLICT(project, path) DO NOTHING')
      .run(project, path, title, nowIso());
  }
  removeFavorite(project: string, path: string) {
    this.db.prepare('DELETE FROM favorites WHERE project = ? AND path = ?').run(project, path);
  }
  favorites(project: string): { path: string; title: string; added_at: string }[] {
    return this.db.prepare('SELECT path, title, added_at FROM favorites WHERE project = ? ORDER BY added_at DESC').all(project) as never;
  }
  isFavorite(project: string, path: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM favorites WHERE project = ? AND path = ?').get(project, path);
  }

  // ---------- atalhos de comando ----------
  addShortcut(project: string, label: string, text: string, target: string): Shortcut {
    const r = this.db.prepare('INSERT INTO shortcuts(project, label, text, target, created_at) VALUES (?,?,?,?,?)')
      .run(project, label, text, target, nowIso());
    return { id: Number(r.lastInsertRowid), project, label, text, target, created_at: nowIso() };
  }
  shortcuts(project: string): Shortcut[] {
    return this.db.prepare('SELECT * FROM shortcuts WHERE project = ? ORDER BY id ASC').all(project) as unknown as Shortcut[];
  }
  deleteShortcut(project: string, id: number) {
    this.db.prepare('DELETE FROM shortcuts WHERE project = ? AND id = ?').run(project, id);
  }

  // ---------- preferências de alerta ----------
  alertPrefs(project: string): Record<string, boolean> {
    const row = this.db.prepare('SELECT prefs FROM alert_prefs WHERE project = ?').get(project) as { prefs: string } | undefined;
    return row ? JSON.parse(row.prefs) : {};
  }
  setAlertPrefs(project: string, prefs: Record<string, boolean>) {
    this.db.prepare('INSERT INTO alert_prefs(project, prefs) VALUES (?,?) ON CONFLICT(project) DO UPDATE SET prefs=excluded.prefs')
      .run(project, JSON.stringify(prefs));
  }

  // ---------- personagens do prédio ----------
  looks(project: string): Record<string, unknown> {
    const rows = this.db.prepare('SELECT id, look FROM looks WHERE project = ? ORDER BY id').all(project) as Array<{ id: string; look: string }>;
    return Object.fromEntries(rows.map((r) => [r.id, JSON.parse(r.look)]));
  }
  setLook(project: string, id: string, look: object | null) {
    if (look) this.db.prepare('INSERT INTO looks(project, id, look) VALUES (?,?,?) ON CONFLICT(project, id) DO UPDATE SET look=excluded.look').run(project, id, JSON.stringify(look));
    else this.db.prepare('DELETE FROM looks WHERE project = ? AND id = ?').run(project, id);
  }

  // ---------- estatísticas do time ----------
  agentStats(project: string, sinceIso: string): AgentStat[] {
    return this.db.prepare(`
      SELECT agent,
        COUNT(*) AS registros,
        SUM(CASE WHEN status LIKE 'DONE%' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status LIKE 'BLOCKED%' OR status LIKE 'FAILED%' THEN 1 ELSE 0 END) AS travado
      FROM entries WHERE project = ? AND kind = 'status' AND ts >= ?
      GROUP BY agent ORDER BY registros DESC
    `).all(project, sinceIso) as unknown as AgentStat[];
  }

  close() { this.db.close(); }
}

export interface Note { id: number; project: string; text: string; created_at: string; done: number }
export interface Shortcut { id: number; project: string; label: string; text: string; target: string; created_at: string }
export interface AgentStat { agent: string; registros: number; done: number; travado: number }

function nowIso(): string { return new Date().toISOString(); }
