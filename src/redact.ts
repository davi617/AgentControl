// Filtro de segredos. Roda ANTES de gravar no SQLite, exibir ou mandar para modelo.
// Prefere apagar demais a vazar: na dúvida, o valor vira [REDACTED].

const R = '[REDACTED]';

const RULES: Array<[RegExp, string]> = [
  // Do not retain account names in local paths or contact addresses in app text.
  [/\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/gi, '[HOME]'],
  [/\/(?:Users|home)\/[^/\s"'<>]+/g, '[HOME]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, R],
  // Cabeçalhos de autenticação
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, `$1 ${R}`],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, R],
  // Chaves com prefixo conhecido
  [/\b(sk|pk|rk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}/g, R],
  [/\bnvapi-[A-Za-z0-9_-]{12,}/g, R],
  [/\bAIza[A-Za-z0-9_-]{20,}/g, R],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\bAKIA[A-Z0-9]{16}\b/g, R],
  [/\b[spr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, R], // Stripe
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, R], // GitLab
  [/\bhf_[A-Za-z0-9]{30,}/g, R], // HuggingFace
  [/\bnpm_[A-Za-z0-9]{36}\b/g, R],
  [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/g, R], // bot do Telegram
  // Webhooks: a URL inteira é a credencial
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, R],
  [/https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, R],
  // .npmrc: //registry.npmjs.org/:_authToken=...
  [/(_authToken\s*=\s*)[^\s"']+/gi, `$1${R}`],
  [/\bya29\.[A-Za-z0-9_-]{20,}/g, R],
  // Chave privada PEM
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  // URL com credencial embutida: scheme://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@\/]+:[^\s@\/]+@/gi, `$1${R}@`],
  // Atribuições: password=..., api_key: "...", secret=..., cookie: ...
  [
    /\b((?:api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|senha|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?id|cookie|set-cookie|private[_-]?key)\s*["']?\s*[:=]\s*)(["']?)[^\s"',;]{4,}\2/gi,
    `$1$2${R}$2`,
  ],
  // Contas NVIDIA/afins aparecem em mensagens de erro de provider
  [/(account\s+')[^']+(')/gi, `$1${R}$2`],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
