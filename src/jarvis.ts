import { EventEmitter } from 'node:events';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Config, ProjectCfg } from './config.ts';
import { activeGoalId, agents, ingest, locks, metaPaths, nowIso, sourceFiles, tasks, type SourceFile } from './sources.ts';
import { chatDir, chatSourceFor, chatSources, postChat, writeSala } from './chat.ts';
import { createCommand, decideCommand, guardInbox, inboxPath, mirrorPaths, trackCommands, trustInbox } from './commands.ts';
import { deterministic, llmInput, llmSummary } from './summarizer.ts';
import { Store, type Entry } from './store.ts';

const norm = (p: string) => path.resolve(p).toLowerCase();
const allSources = (p: ProjectCfg): SourceFile[] => [...sourceFiles(p), ...chatSources(p)];

/**
 * Eventos emitidos (todos com { project }):
 *  chat { entries }  ·  entries { entries }  ·  agents  ·  tasks  ·  summary { summary }  ·  commands { commands }
 */
export class Jarvis extends EventEmitter {
  cfg: Config;
  store: Store;
  private watcher?: FSWatcher;
  private sources = new Map<string, { project: ProjectCfg; src: SourceFile }>();
  private metas = new Map<string, ProjectCfg>();
  private inboxes = new Map<string, ProjectCfg>();
  private pendingAgents = new Map<string, NodeJS.Timeout>();
  private summaryTimer = new Map<string, NodeJS.Timeout>();
  private summarizing = new Set<string>();
  fetchImpl: typeof fetch = fetch;

  constructor(cfg: Config, store?: Store) {
    super();
    // Cada /events aberto prende 7 listeners; o teto é por pessoa (MAX_STREAMS em server.ts), não deste emissor.
    this.setMaxListeners(0);
    this.cfg = cfg;
    this.store = store ?? new Store(cfg.db);
  }

  project(id: string | null | undefined): ProjectCfg | undefined {
    return this.cfg.projects.find((p) => p.id === id) ?? (id ? undefined : this.cfg.projects[0]);
  }

  private indexSources(p: ProjectCfg): string[] {
    const paths: string[] = [];
    for (const src of allSources(p)) { this.sources.set(norm(src.path), { project: p, src }); paths.push(src.path); }
    for (const m of metaPaths(p)) { this.metas.set(norm(m), p); paths.push(m); }
    // Inbox e espelhos: vigiados para ninguém além do JARVIS mexer (guardInbox).
    for (const f of [inboxPath(p), ...mirrorPaths(p).map((m) => m.file)]) if (f) { this.inboxes.set(norm(f), p); paths.push(f); }
    trustInbox(p);
    const cd = chatDir(p);
    if (cd) paths.push(cd); // agente novo (fora do launcher) cria o próprio arquivo e já entra na sala
    return paths;
  }

  async start(): Promise<void> {
    const paths: string[] = [];
    for (const p of this.cfg.projects) {
      paths.push(...this.indexSources(p));
      const first = this.store.feed(p.id, { limit: 1 }).length === 0;
      for (const src of allSources(p)) ingest(this.store, p, src, first);
      writeSala(this.store, p);
    }
    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      depth: 0,
      usePolling: !!this.cfg.pollInterval,
      interval: this.cfg.pollInterval,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    this.watcher.on('add', (f) => this.onChange(f));
    this.watcher.on('change', (f) => this.onChange(f));
    this.watcher.on('unlink', (f) => this.onChange(f));
    this.watcher.on('error', (e) => console.error('[watcher]', (e as Error).message));
    await new Promise<void>((r) => this.watcher!.once('ready', () => r()));
    for (const p of this.cfg.projects) this.scheduleSummary(p, true);
  }

  private onChange(file: string) {
    const key = norm(file);
    const inboxOf = this.inboxes.get(key);
    if (inboxOf) {
      const who = guardInbox(inboxOf, file);
      if (who) {
        console.error(`[inbox] ${who} alterou ${file}; restaurado`);
        try { postChat(inboxOf, 'JARVIS', 'DONO', 'inbox', `Atenção: ${who} alterou o JARVIS-INBOX.md (só o JARVIS escreve lá). Voltei o arquivo ao certo. Aprovação continua valendo só pelo Agent Control.`); } catch { /* sem chat configurado */ }
        this.emit('inbox', { project: inboxOf.id, who });
      }
    }
    let hit = this.sources.get(key);
    if (!hit) {
      for (const p of this.cfg.projects) {
        const src = chatSourceFor(p, file);
        if (src) { hit = { project: p, src }; this.sources.set(key, hit); break; }
      }
    }
    if (hit) {
      const { project: p, src } = hit;
      if (src.kind === 'meta') this.reindex(p); // ACTIVE_GOAL mudou: outro Goal pode estar ativo
      const added = ingest(this.store, p, src, false);
      if (src.kind === 'tasks') this.emit('tasks', { project: p.id });
      if (added.length) {
        this.emit('entries', { project: p.id, entries: added });
        if (added.some((e) => e.kind === 'chat')) {
          writeSala(this.store, p);
          this.emit('chat', { project: p.id, entries: added.filter((e) => e.kind === 'chat') });
        }
        const cmds = trackCommands(this.store, added);
        if (cmds.length) this.emit('commands', { project: p.id, commands: cmds });
        this.bumpAgents(p);
        this.scheduleSummary(p, false);
      }
      return;
    }
    const meta = this.metas.get(key) ?? this.metas.get(norm(path.dirname(file)));
    if (meta) this.bumpAgents(meta);
  }

  private reindex(p: ProjectCfg) {
    for (const [k, v] of this.sources) if (v.project === p) this.sources.delete(k);
    const paths = this.indexSources(p);
    this.watcher?.add(paths);
    for (const src of allSources(p)) {
      const added = ingest(this.store, p, src, false);
      if (added.length) this.emit('entries', { project: p.id, entries: added });
    }
    this.emit('tasks', { project: p.id });
  }

  private bumpAgents(p: ProjectCfg) {
    clearTimeout(this.pendingAgents.get(p.id));
    this.pendingAgents.set(p.id, setTimeout(() => this.emit('agents', { project: p.id }), 150));
  }

  /** Registra o comando e responde na hora; o trabalho segue pelo bus, sem travar a sala. */
  command(p: ProjectCfg, text: string, target: string, by = 'DONO') {
    const cmd = createCommand(this.store, p, text, target, by);
    this.store.audit({ project: p.id, actor: by, action: 'comando', target: cmd.code, detail: `${target}${cmd.requires_approval ? ' · protegido' : ''}: ${cmd.text.slice(0, 300)}` });
    this.emit('commands', { project: p.id, commands: [cmd] });
    return cmd;
  }

  /** Pânico ligado (quem e quando) ou null. Fica no banco: reiniciar o Agent Control não reabre o acesso. */
  panic(): { by: string; at: string } | null {
    const v = this.store.setting('', 'panico');
    try { return v ? JSON.parse(v) : null; } catch { return null; }
  }
  setPanic(v: { by: string; at: string } | null) { this.store.setSetting('', 'panico', v ? JSON.stringify(v) : ''); }

  /** Aprovação em dupla ligada neste projeto (só vale se o plano tiver o recurso; quem confere é o servidor). */
  dualApproval(p: ProjectCfg): boolean { return this.store.setting(p.id, 'aprovacaoDupla') === '1'; }

  /** Fase 3: aprovar/recusar um comando protegido (um clique = um comando). `needed` = 2 na aprovação em dupla. */
  decide(p: ProjectCfg, code: string, decision: 'approve' | 'reject', who: { id: string } = { id: 'DONO' }, needed = 1) {
    const cmd = decideCommand(this.store, p, code, decision, who.id, needed);
    this.store.audit({ project: p.id, actor: who.id, action: decision === 'approve' ? 'aprovou' : 'recusou', target: code, detail: cmd.approval === 'pending' ? 'primeiro voto da dupla' : '' });
    this.emit('commands', { project: p.id, commands: [cmd] });
    return cmd;
  }

  /** Mensagem da tela para a sala. O watcher traz de volta como entrada (fonte única: o .md). */
  say(p: ProjectCfg, as: string, para: string, assunto: string, text: string) {
    return postChat(p, as, para, assunto, text);
  }

  state(p: ProjectCfg) {
    return { goal: activeGoalId(p) ?? null, agents: agents(this.store, p), locks: locks(p), tasks: tasks(p), looks: {} }; // looks: o Modo Prédio saiu na v4.0; fica vazio para apps antigos
  }

  recent(p: ProjectCfg): Entry[] {
    const last = this.store.lastSummary(p.id, 'llm');
    const since = last?.created_at ?? '0000';
    return this.store.since(p.id, since);
  }

  deterministicSummary(p: ProjectCfg): string {
    const s = this.state(p);
    return deterministic(p, s.goal ?? undefined, s.agents, s.tasks, this.recent(p), s.locks);
  }

  /** Resumo por IA com intervalo mínimo; nunca bloqueia a sala. */
  private scheduleSummary(p: ProjectCfg, startup: boolean) {
    if (!this.cfg.summary.enabled || this.summaryTimer.has(p.id)) return;
    const last = this.store.lastSummary(p.id, 'llm');
    const minMs = this.cfg.summary.minIntervalMinutes * 60_000;
    const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity;
    if (startup && age < minMs) return;
    const wait = Math.max(0, minMs - age, startup ? 3_000 : 20_000);
    this.summaryTimer.set(p.id, setTimeout(() => {
      this.summaryTimer.delete(p.id);
      void this.runSummary(p);
    }, wait));
  }

  async runSummary(p: ProjectCfg) {
    if (this.summarizing.has(p.id)) return;
    this.summarizing.add(p.id);
    try {
      const det = this.deterministicSummary(p);
      const nvidiaBusy = locks(p).some((l) => /nvidia/i.test(l.name) && l.alive);
      const r = await llmSummary(this.cfg.summary, llmInput(det, this.recent(p)), nvidiaBusy, this.fetchImpl);
      const summary = this.store.addSummary({
        project: p.id, created_at: nowIso(), kind: 'llm', model: r.model, status: r.status, text: r.text,
      });
      this.emit('summary', { project: p.id, summary });
      return summary;
    } finally {
      this.summarizing.delete(p.id);
    }
  }

  async stop() {
    for (const t of this.summaryTimer.values()) clearTimeout(t);
    for (const t of this.pendingAgents.values()) clearTimeout(t);
    await this.watcher?.close();
    this.store.close();
  }
}
