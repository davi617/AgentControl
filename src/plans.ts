// Planos e licença (2026-10-03): freemium. O app é aberto (MIT) e roda de graça no seu PC; os planos pagos liberam
// mais gente no Modo Time e serviços da nuvem. A licença é um texto assinado (Ed25519) pelo vendedor: o app confere
// a assinatura sozinho, sem internet, com a chave PÚBLICA abaixo. A chave privada nunca fica no repositório.

import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type PlanId = 'gratis' | 'pro' | 'time' | 'empresa';
export interface Plan { id: PlanId; nome: string; precoMensalBRL: number | null; pessoas: number; recursos: string[] }

/** Tabela de planos. pessoas = quantas pessoas no Modo Time contando você (Infinity = sem limite). */
export const PLANS: Record<PlanId, Plan> = {
  gratis: { id: 'gratis', nome: 'Grátis', precoMensalBRL: 0, pessoas: 3, recursos: ['Agentes ilimitados no seu PC', 'Sala, chamada e HUD', 'App do celular', 'Até 3 pessoas no time'] },
  pro: { id: 'pro', nome: 'Pro', precoMensalBRL: 29, pessoas: 5, recursos: ['Tudo do Grátis', 'Até 5 pessoas', 'Acesso de fora sem Tailscale (nuvem)', 'Backup da configuração'] },
  time: { id: 'time', nome: 'Time', precoMensalBRL: 19, pessoas: Infinity, recursos: ['Tudo do Pro', 'Pessoas ilimitadas (preço por pessoa)', 'Aprovação em dupla', 'Histórico e auditoria de 1 ano'] },
  empresa: { id: 'empresa', nome: 'Empresa', precoMensalBRL: null, pessoas: Infinity, recursos: ['Tudo do Time', 'SSO', 'Suporte prioritário', 'Contrato'] },
};

/**
 * Chave pública do vendedor (Ed25519, SPKI em base64). Trocar pela gerada com `node tools/licenca.mjs chaves`.
 * Esta é a chave PÚBLICA oficial (pode ficar no código aberto; só confere assinatura). Quem faz fork troca pela sua; vazia = tudo fica no Grátis.
 */
export const VENDOR_PUBLIC_KEY = process.env.AGENT_CONTROL_LICENSE_PUBKEY ?? 'MCowBQYDK2VwAyEA7xOljP1yjG5vZLy/9HEuoaVdaMDH10r/A8zfus3BwPY=';

export interface License { plan: PlanId; cliente: string; pessoas?: number; validaAte: string; emitida: string }
export interface PlanState { plan: Plan; license: Omit<License, 'cliente'> & { cliente: string } | null; motivo: string | null; pessoas: number }

const b64url = (b: Buffer) => b.toString('base64url');

/** Junta payload e assinatura no formato de texto da licença: AC1.<payload>.<assinatura>. */
export function encodeLicense(payload: License, sign: (data: Buffer) => Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return `AC1.${b64url(body)}.${b64url(sign(body))}`;
}

/** Confere a licença. Devolve o payload ou o motivo de recusa (assinatura, formato, vencida, plano desconhecido). */
export function checkLicense(text: string, publicKeyB64: string, now = new Date()): { ok: true; license: License } | { ok: false; motivo: string } {
  const parts = text.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'AC1') return { ok: false, motivo: 'formato de licença inválido' };
  if (!publicKeyB64) return { ok: false, motivo: 'este app não tem a chave do vendedor (versão compilada sem planos pagos)' };
  let body: Buffer, sig: Buffer;
  try { body = Buffer.from(parts[1], 'base64url'); sig = Buffer.from(parts[2], 'base64url'); } catch { return { ok: false, motivo: 'formato de licença inválido' }; }
  let good = false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return { ok: false, motivo: 'chave do vendedor não é Ed25519' };
    good = verify(null, body, key, sig);
  } catch { good = false; }
  if (!good) return { ok: false, motivo: 'assinatura não confere (licença alterada ou de outro vendedor)' };
  let lic: License;
  try { lic = JSON.parse(body.toString('utf8')); } catch { return { ok: false, motivo: 'conteúdo da licença ilegível' }; }
  if (!PLANS[lic.plan] || lic.plan === 'gratis') return { ok: false, motivo: 'plano desconhecido na licença' };
  // 5 min de folga no relógio do PC.
  if (!(new Date(lic.validaAte).getTime() + 300_000 > now.getTime())) return { ok: false, motivo: `licença venceu em ${lic.validaAte.slice(0, 10)}` };
  return { ok: true, license: lic };
}

/** Licença salva em data/license.txt (fora do Git). */
export class PlanStore {
  private file: string;
  private publicKey: string;
  constructor(dataDir: string | null, publicKey = VENDOR_PUBLIC_KEY) { this.file = dataDir ? path.join(dataDir, 'license.txt') : ''; this.publicKey = publicKey; this.mem = ''; }
  private mem: string;

  private read(): string {
    if (!this.file) return this.mem;
    try { return existsSync(this.file) ? readFileSync(this.file, 'utf8') : ''; } catch { return ''; }
  }

  /** Plano em vigor agora. Licença inválida ou vencida volta para o Grátis com o motivo. */
  state(now = new Date()): PlanState {
    const text = this.read().trim();
    if (!text) return { plan: PLANS.gratis, license: null, motivo: null, pessoas: PLANS.gratis.pessoas };
    const r = checkLicense(text, this.publicKey, now);
    if (!r.ok) return { plan: PLANS.gratis, license: null, motivo: r.motivo, pessoas: PLANS.gratis.pessoas };
    const plan = PLANS[r.license.plan];
    return { plan, license: r.license, motivo: null, pessoas: r.license.pessoas ?? plan.pessoas };
  }

  /** Grava uma licença nova só se ela for válida (não troca uma boa por uma ruim). */
  install(text: string, now = new Date()): PlanState {
    const r = checkLicense(text, this.publicKey, now);
    if (!r.ok) throw new Error(r.motivo);
    if (this.file) { mkdirSync(path.dirname(this.file), { recursive: true }); writeFileSync(this.file, text.trim() + '\n'); }
    else this.mem = text.trim();
    return this.state(now);
  }
}

/** Para a tela e a API: Infinity vira null no JSON. */
export const publicPlan = (s: PlanState) => ({
  plano: s.plan.id, nome: s.plan.nome, pessoas: Number.isFinite(s.pessoas) ? s.pessoas : null, recursos: s.plan.recursos,
  cliente: s.license?.cliente ?? null, validaAte: s.license?.validaAte ?? null, motivo: s.motivo,
  planos: Object.values(PLANS).map((p) => ({ id: p.id, nome: p.nome, precoMensalBRL: p.precoMensalBRL, pessoas: Number.isFinite(p.pessoas) ? p.pessoas : null, recursos: p.recursos })),
});
