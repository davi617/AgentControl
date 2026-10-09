// Service worker do app instalado (PWA). Guarda só a "casca" (HTML, CSS, JS e ícones) para abrir rápido e mostrar
// um aviso quando o PC está fora do ar. Nada da API, da sala ou dos agentes é guardado: /api e /events vão sempre à rede.
// Só roda em contexto seguro (127.0.0.1 ou HTTPS, ex.: tailscale serve); pelo IP do Tailscale em http o navegador não liga.
const CACHE = 'agent-control-v4';
const SHELL = ['/', '/style.css', '/app.js', '/missions.js', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/events') return;
  // rede primeiro (o app muda com o servidor); sem rede, a cópia guardada
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.includes(u.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(u.pathname, copy)); }
    return r;
  }).catch(() => caches.match(u.pathname).then((r) => r ?? new Response('Sem conexão com o PC. Confira se ele está ligado e se o Tailscale está ativo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
});
