import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localIso } from './date.ts';

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
  /** Quem pediu: DONO ou o id da pessoa do time (null em comandos antigos de outra pessoa). */
  created_by?: string | null;
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
    this.migrate();
  }

  /**
   * Migrações numeradas (PRAGMA user_version). Cada passo roda uma vez, em ordem, dentro de uma transação:
   * banco antigo sobe até a versão atual; banco novo passa por todas. Nunca editar um passo já publicado, só somar.
   */
  private migrate() {
    const steps: Array<() => void> = [
      // 1 (Fase 3): aprovação numa coluna própria, para um ACK não apagar a pendência.
      () => {
        const cols = this.db.prepare('PRAGMA table_info(commands)').all() as Array<{ name: string }>;
        if (!cols.some((c) => c.name === 'approval')) {
          this.db.exec('ALTER TABLE commands ADD COLUMN approval TEXT');
          this.db.exec("UPDATE commands SET approval = 'pending' WHERE requires_approval = 1");
        }
      },
      // 2 (v4.0): quem criou o comando, votos de aprovação (dupla), auditoria encadeada e ajustes por projeto.
      () => {
        this.db.exec(`
          ALTER TABLE commands ADD COLUMN created_by TEXT;
          CREATE TABLE IF NOT EXISTS approvals (
            code TEXT NOT NULL, person TEXT NOT NULL, decision TEXT NOT NULL, at TEXT NOT NULL,
            PRIMARY KEY (code, person)
          );
          CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at TEXT NOT NULL, project TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
            target TEXT NOT NULL, detail TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL
          );
          -- Só acréscimo: o banco recusa editar ou apagar uma linha da auditoria.
          CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'auditoria só aceita acréscimo'); END;
          CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'auditoria só aceita acréscimo'); END;
          CREATE TABLE IF NOT EXISTS settings (
            project TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (project, key)
          );
        `);
        // Comandos antigos: o nome de quem pediu ia no texto ("[Ana] ...").
        this.db.exec("UPDATE commands SET created_by = 'DONO' WHERE created_by IS NULL AND text NOT LIKE '[%'");
      },
    ];
    const at = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let v = at; v < steps.length; v++) {
      this.db.exec('BEGIN');
      try {
        steps[v]();
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }

  /** Versão do esquema (quantas migrações já rodaram). */
  get schemaVersion(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
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
    const r = this.db.prepare(`INSERT INTO commands(project, code, target, text, requires_approval, approval, status, updated_by, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(c.project, c.code, c.target, c.text, c.requires_approval, c.approval, c.status, c.updated_by, c.created_by ?? null, c.created_at, c.updated_at);
    return { ...c, created_by: c.created_by ?? null, id: Number(r.lastInsertRowid) };
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
    const at = nowIso();
    const r = this.db.prepare('INSERT INTO notes(project, text, created_at, done) VALUES (?,?,?,0)').run(project, text, at);
    return { id: Number(r.lastInsertRowid), project, text, created_at: at, done: 0 };
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
    const at = nowIso();
    const r = this.db.prepare('INSERT INTO shortcuts(project, label, text, target, created_at) VALUES (?,?,?,?,?)')
      .run(project, label, text, target, at);
    return { id: Number(r.lastInsertRowid), project, label, text, target, created_at: at };
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

  // ---------- votos de aprovação (aprovação em dupla) ----------
  /** Registra o voto de uma pessoa; false se ela já tinha votado neste comando. */
  addVote(code: string, person: string, decision: 'approve' | 'reject', at: string): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO approvals(code, person, decision, at) VALUES (?,?,?,?)').run(code, person, decision, at).changes > 0;
  }
  votes(code: string): { person: string; decision: string; at: string }[] {
    return this.db.prepare('SELECT person, decision, at FROM approvals WHERE code = ? ORDER BY at, person').all(code) as never;
  }

  // ---------- ajustes por projeto ----------
  setting(project: string, key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM settings WHERE project = ? AND key = ?').get(project, key) as { value: string } | undefined)?.value;
  }
  setSetting(project: string, key: string, value: string) {
    this.db.prepare('INSERT INTO settings(project, key, value) VALUES (?,?,?) ON CONFLICT(project, key) DO UPDATE SET value=excluded.value').run(project, key, value);
  }

  // ---------- auditoria (só acréscimo, hash encadeado) ----------
  /** Cada linha guarda o hash da anterior: mexer numa linha antiga quebra a corrente dali em diante. */
  audit(a: { project: string; actor: string; action: string; target?: string; detail?: string; at?: string }): AuditRow {
    const prev = (this.db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined)?.hash ?? GENESIS;
    const row = { at: a.at ?? nowIso(), project: a.project, actor: a.actor, action: a.action, target: a.target ?? '', detail: (a.detail ?? '').slice(0, 2000) };
    const hash = auditHash(prev, row);
    const r = this.db.prepare('INSERT INTO audit(at, project, actor, action, target, detail, prev, hash) VALUES (?,?,?,?,?,?,?,?)')
      .run(row.at, row.project, row.actor, row.action, row.target, row.detail, prev, hash);
    return { id: Number(r.lastInsertRowid), ...row, prev, hash };
  }
  auditLog(project: string | null, limit = 200): AuditRow[] {
    const lim = Math.min(Math.max(limit, 1), 100_000);
    return (project === null
      ? this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(lim)
      : this.db.prepare("SELECT * FROM audit WHERE project = ? OR project = '' ORDER BY id DESC LIMIT ?").all(project, lim)) as unknown as AuditRow[];
  }
  /** Confere a corrente inteira. ok=false aponta a primeira linha que não bate. */
  verifyAudit(): { ok: boolean; total: number; brokenAt: number | null } {
    let prev = GENESIS, total = 0;
    for (const r of this.db.prepare('SELECT * FROM audit ORDER BY id').iterate() as Iterable<AuditRow>) {
      total++;
      if (r.prev !== prev || r.hash !== auditHash(prev, r)) return { ok: false, total, brokenAt: r.id };
      prev = r.hash;
    }
    return { ok: true, total, brokenAt: null };
  }

  close() { this.db.close(); }
}

export interface Note { id: number; project: string; text: string; created_at: string; done: number }
export interface Shortcut { id: number; project: string; label: string; text: string; target: string; created_at: string }
export interface AuditRow { id: number; at: string; project: string; actor: string; action: string; target: string; detail: string; prev: string; hash: string }
export interface AgentStat { agent: string; registros: number; done: number; travado: number }

// Hora local, como o resto dos registros: em UTC, uma nota feita depois das 21h (Brasil) caía no diário do dia seguinte.
const nowIso = () => localIso();

const GENESIS = '0'.repeat(64);
function auditHash(prev: string, r: Pick<AuditRow, 'at' | 'project' | 'actor' | 'action' | 'target' | 'detail'>): string {
  return createHash('sha256').update(prev).update(JSON.stringify([r.at, r.project, r.actor, r.action, r.target, r.detail])).digest('hex');
}
