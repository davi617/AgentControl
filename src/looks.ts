// Personagens do Modo Prédio: a roupa, as cores e o cabelo que o dono escolheu para ele mesmo ("VOCÊ") e para cada
// agente. Só cores e nomes de estilo: a foto usada para tirar as cores fica no aparelho e nunca chega aqui.

export const LOOK_STYLES = ['curto', 'longo', 'careca', 'bone', 'coque', 'topete', 'cacheado', 'rabo'] as const;
export const LOOK_TOPS = ['camiseta', 'listrada', 'moletom', 'polo', 'terno'] as const;
export const LOOK_ACCS = ['nenhum', 'oculos', 'fone', 'barba'] as const;
const COLORS = ['skin', 'hair', 'shirt', 'pants', 'shoes', 'cap'] as const;

export interface Look {
  skin: string; hair: string; shirt: string; pants: string; shoes: string; cap: string;
  style: (typeof LOOK_STYLES)[number]; top: (typeof LOOK_TOPS)[number]; acc: (typeof LOOK_ACCS)[number];
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Confere e limpa um personagem vindo do navegador/app. Devolve null se faltar ou sobrar algo inválido. */
export function sanitizeLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of COLORS) {
    const v = r[k];
    if (typeof v !== 'string' || !HEX.test(v)) return null;
    out[k] = v.toUpperCase();
  }
  const pickFrom = <T extends readonly string[]>(list: T, v: unknown): T[number] | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v : null);
  const style = pickFrom(LOOK_STYLES, r.style), top = pickFrom(LOOK_TOPS, r.top), acc = pickFrom(LOOK_ACCS, r.acc);
  if (!style || !top || !acc) return null;
  return { ...(out as Pick<Look, (typeof COLORS)[number]>), style, top, acc };
}

/** Quem pode ter personagem: você (o dono) ou um agente do projeto. */
export function lookOwnerOk(id: unknown, agents: string[]): id is string {
  return typeof id === 'string' && id.length <= 40 && (id === 'VOCÊ' || agents.includes(id));
}
