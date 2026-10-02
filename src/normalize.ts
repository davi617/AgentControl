// Limpa texto vindo dos .md dos agentes antes de qualquer outra etapa.
// Problemas reais encontrados na Fase 0: BOM, `r`n literal (bug do goal-sync.ps1)
// e mojibake UTF-8 lido como cp1252 (ex.: "ReproduzÃ­vel" em TASKS.md).

// cp1252 usa 0x80–0x9F para caracteres que não existem em latin1.
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const MOJIBAKE_HINT = /[ÃÂâ][\u0080-¿Œ-™]/;

function toCp1252Bytes(s: string): Buffer | null {
  const out = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[i] = c;
    else if (c >= 0x80 && c <= 0x9f) out[i] = c; // controles C1 que sobreviveram como latin1
    else if (CP1252_EXTRA[c] !== undefined) out[i] = CP1252_EXTRA[c];
    else return null;
  }
  return out;
}

/** Desfaz mojibake linha a linha; só aceita a troca se o resultado for UTF-8 válido. */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE_HINT.test(text)) return text;
  return text
    .split('\n')
    .map((line) => {
      if (!MOJIBAKE_HINT.test(line)) return line;
      const bytes = toCp1252Bytes(line);
      if (!bytes) return line;
      const fixed = bytes.toString('utf8');
      return fixed.includes('�') ? line : fixed;
    })
    .join('\n');
}

export function normalize(raw: string): string {
  let t = raw.replace(/^﻿/, '');
  t = t.replace(/`r`n/g, '\n');
  t = t.replace(/\r\n?/g, '\n');
  return repairMojibake(t);
}
