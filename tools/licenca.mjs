// Licenças do Agent Control (vendedor). A chave PRIVADA fica fora do Git, em ~/.config/agent-control/licenca-privada.pem,
// e nunca é impressa. A chave PÚBLICA vai para o app (AGENT_CONTROL_LICENSE_PUBKEY ou VENDOR_PUBLIC_KEY em src/plans.ts).
//
//   node tools/licenca.mjs chaves                          cria o par de chaves (uma vez) e mostra só a pública
//   node tools/licenca.mjs emitir <plano> <cliente> <dias> [pessoas]   imprime uma licença AC1.… para o cliente
//   node tools/licenca.mjs conferir <licença>             confere com a pública do seu PC
//
// Planos: pro | time | empresa. Em produção quem emite é o webhook do gateway (ver docs/PAGAMENTOS.md).
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.homedir(), '.config', 'agent-control');
const privFile = path.join(dir, 'licenca-privada.pem');
const [cmd, ...args] = process.argv.slice(2);

const pubB64 = (key) => createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');

if (cmd === 'chaves') {
  if (existsSync(privFile)) { console.log('Já existe uma chave privada. Pública:\n' + pubB64(createPrivateKey(readFileSync(privFile)))); process.exit(0); }
  mkdirSync(dir, { recursive: true });
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  console.log(`Chave privada salva em ${privFile} (não compartilhe, faça backup offline).`);
  console.log('Chave pública (coloque no app):\n' + pubB64(privateKey));
} else if (cmd === 'emitir') {
  const [plan, cliente, dias, pessoas] = args;
  if (!['pro', 'time', 'empresa'].includes(plan) || !cliente || !(Number(dias) > 0)) { console.error('uso: emitir <pro|time|empresa> <cliente> <dias> [pessoas]'); process.exit(1); }
  if (!existsSync(privFile)) { console.error('rode antes: node tools/licenca.mjs chaves'); process.exit(1); }
  const key = createPrivateKey(readFileSync(privFile));
  const payload = { plan, cliente, ...(pessoas ? { pessoas: Number(pessoas) } : {}), validaAte: new Date(Date.now() + Number(dias) * 86_400_000).toISOString(), emitida: new Date().toISOString() };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  console.log(`AC1.${body.toString('base64url')}.${sign(null, body, key).toString('base64url')}`);
} else if (cmd === 'conferir') {
  const [h, b, s] = String(args[0] ?? '').split('.');
  if (h !== 'AC1' || !existsSync(privFile)) { console.error('licença inválida ou sem chave neste PC'); process.exit(1); }
  const pub = createPublicKey(createPrivateKey(readFileSync(privFile)));
  const ok = verify(null, Buffer.from(b, 'base64url'), pub, Buffer.from(s, 'base64url'));
  console.log(ok ? 'válida: ' + Buffer.from(b, 'base64url').toString() : 'assinatura NÃO confere');
  process.exit(ok ? 0 : 1);
} else {
  console.log('uso: node tools/licenca.mjs chaves | emitir <plano> <cliente> <dias> [pessoas] | conferir <licença>');
}
