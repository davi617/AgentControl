import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { Jarvis } from './jarvis.ts';
import { createServer } from './server.ts';
import { writeDiary } from './extras.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadConfig(process.env.JARVIS_CONFIG ?? path.join(root, 'jarvis.config.json'));
const j = new Jarvis(cfg);
await j.start();
j.on('summary', ({ summary }) => console.log(`[resumo] ${summary.status} ${summary.model ?? ''}`));

const server = createServer(j);
server.listen(cfg.port, cfg.host, () => {
  console.log(`Agent Control na sala: http://${cfg.host}:${cfg.port}  (somente local)`);
});

// Fase 4 (desligado por padrão): app do celular pelo Tailscale, com token.
let remote: ReturnType<typeof createServer> | undefined;
if (cfg.remote?.enabled) {
  const tf = cfg.remote.tokenFile;
  if (!existsSync(tf)) {
    mkdirSync(path.dirname(tf), { recursive: true });
    writeFileSync(tf, randomBytes(32).toString('hex'), { mode: 0o600 });
    console.log(`[remoto] token novo criado em ${tf} (não é impresso aqui)`);
  }
  const token = readFileSync(tf, 'utf8').trim();
  const rport = cfg.remote.port ?? cfg.port;
  remote = createServer(j, { host: cfg.remote.host, token, port: rport });
  remote.listen(rport, cfg.remote.host, () => {
    console.log(`Agent Control remoto: http://${cfg.remote!.host}:${rport}  (só Tailscale/loopback, exige token)`);
  });
}

// Diário do dia no vault (20-Operations/Diario/AAAA-MM-DD.md): agora e de hora em hora.
const diary = () => { for (const p of cfg.projects) writeDiary(j.store, p, cfg.summary).catch((e) => console.error('[diario]', (e as Error).message)); };
setTimeout(diary, 30_000).unref();
setInterval(diary, 60 * 60_000).unref();

const shutdown = async () => { server.close(); remote?.close(); await j.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
