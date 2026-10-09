// Uso de cada agente na fila da NVIDIA (pedido do dono, 2026-09-27: "coloque usos dos agentes").
// Todos usam a mesma chave; a fila sabe quem é quem pelo endereço: http://127.0.0.1:20129/a/<agente>/v1.
// Sem prefixo: 'voz' = CHAMADA, 'alta' = JARVIS (chat), resto = OUTRO. Guarda 30 dias em data/gate-usage.json.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localDay } from './date.ts';

export interface Bucket {
  req: number; // pedidos que chegaram à NVIDIA (com resposta)
  ok: number; // resposta 2xx
  err: number; // resposta de erro (não 429)
  r429: number; // vezes que a NVIDIA mandou esperar
  pin: number; // tokens de entrada (prompt)
  pout: number; // tokens de saída (resposta)
  ms: number; // soma do tempo das respostas
  models: Record<string, number>;
}

const empty = (): Bucket => ({ req: 0, ok: 0, err: 0, r429: 0, pin: 0, pout: 0, ms: 0, models: {} });
const dayKey = (d = new Date()) => localDay(d); // AAAA-MM-DD no horário do PC

/** "/a/hermes/v1/chat/completions" → HERMES + "/v1/chat/completions". Sem prefixo, decide pelo cabeçalho de prioridade. */
export function agentFromUrl(url: string, priority: string): { agent: string; url: string } {
  const m = /^\/a\/([a-z0-9_-]{2,24})(\/.*)$/i.exec(url);
  if (m) return { agent: m[1].toUpperCase(), url: m[2] };
  return { agent: priority === 'voz' ? 'CHAMADA' : priority === 'alta' ? 'JARVIS' : 'OUTRO', url };
}

/** Tokens do fim da resposta (JSON normal ou stream SSE; formato OpenAI ou Anthropic). O último valor vence. */
export function tokensFrom(tail: string): { pin: number; pout: number } {
  const last = (re: RegExp) => { let v = 0; for (const m of tail.matchAll(re)) v = Number(m[1]); return v; };
  return {
    pin: last(/"prompt_tokens"\s*:\s*(\d+)/g) || last(/"input_tokens"\s*:\s*(\d+)/g),
    pout: last(/"completion_tokens"\s*:\s*(\d+)/g) || last(/"output_tokens"\s*:\s*(\d+)/g),
  };
}

export class Usage {
  days: Record<string, Record<string, Bucket>> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) { try { this.days = JSON.parse(readFileSync(file, 'utf8')).days ?? {}; } catch { /* arquivo estragado: começa do zero */ } }
  }

  private bucket(agent: string, now = new Date()): Bucket {
    // Nome que é chave especial de objeto (__proto__…) nunca vira chave: os contadores iriam parar no Object.prototype.
    const who = agent === '__proto__' || agent === 'constructor' || agent === 'prototype' ? 'OUTRO' : agent;
    const day = dayKey(now);
    const d = new Map(Object.entries(this.days[day] ?? {}));
    let b = d.get(who);
    // Map + fromEntries: o nome vira chave própria do objeto, nunca uma escrita direta por nome vindo do pedido.
    if (!b) { b = empty(); d.set(who, b); this.days[day] = Object.fromEntries(d); }
    return b;
  }

  record(agent: string, model: string, r: { status: number; ms: number; pin: number; pout: number }, now = new Date()) {
    const b = this.bucket(agent, now);
    b.req++;
    if (r.status >= 200 && r.status < 300) b.ok++; else b.err++;
    b.ms += r.ms; b.pin += r.pin; b.pout += r.pout;
    // O nome do modelo vem no pedido: conta num Map (chave qualquer, até "__proto__", sem tocar no protótipo).
    if (model) {
      const m = new Map(Object.entries(b.models));
      m.set(model, (m.get(model) ?? 0) + 1);
      b.models = Object.fromEntries(m);
    }
    this.save();
  }

  hit429(agent: string, now = new Date()) { this.bucket(agent, now).r429++; this.save(); }

  /** Últimos `dias` dias: total por agente + série por dia (para o gráfico do app). */
  snapshot(dias = 7, now = new Date()) {
    const keys: string[] = [];
    for (let i = dias - 1; i >= 0; i--) keys.push(dayKey(new Date(now.getTime() - i * 86_400_000)));
    const total: Record<string, Bucket> = {};
    const porDia = keys.map((dia) => {
      const d = this.days[dia] ?? {};
      for (const [a, b] of Object.entries(d)) {
        const t = (total[a] ??= empty());
        t.req += b.req; t.ok += b.ok; t.err += b.err; t.r429 += b.r429; t.pin += b.pin; t.pout += b.pout; t.ms += b.ms;
        for (const [m, n] of Object.entries(b.models)) t.models[m] = (t.models[m] ?? 0) + n;
      }
      return { dia, req: Object.values(d).reduce((s, b) => s + b.req, 0), tokens: Object.values(d).reduce((s, b) => s + b.pin + b.pout, 0) };
    });
    const agentes = Object.entries(total)
      .map(([agent, b]) => ({ agent, ...b, msMedio: b.req ? Math.round(b.ms / b.req) : 0 }))
      .sort((a, b) => b.req - a.req);
    return { dias, agentes, porDia };
  }

  /** Grava no máximo a cada 5 s (não escreve no disco a cada pedido). Mantém 30 dias. */
  private save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 5_000);
    this.timer.unref?.();
  }

  flush() {
    if (!this.file) return;
    const keep = Object.keys(this.days).sort().slice(-30);
    this.days = Object.fromEntries(keep.map((k) => [k, this.days[k]]));
    // Disco cheio ou arquivo travado não pode derrubar a fila (o flush roda dentro de um timer: erro ali encerra o processo).
    // Grava num .tmp e troca de uma vez, para queda de energia não deixar o JSON pela metade.
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ days: this.days }));
      renameSync(tmp, this.file);
    } catch (e) { console.error('[uso] não gravei gate-usage.json:', (e as Error).message); }
  }
}
