// Tela de entrar do navegador (iPhone/PWA): manda o token uma vez; o servidor guarda num cookie HttpOnly.
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = document.getElementById('m');
  const token = document.getElementById('t').value.trim();
  if (!token) { m.textContent = 'Cole o token primeiro.'; return; }
  m.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if (r.ok) { location.replace('/'); return; }
    m.textContent = r.status === 401 ? 'Token não confere. Peça um novo ao dono do time.' : 'Não deu para entrar agora. Tente de novo.';
  } catch { m.textContent = 'Sem conexão com o PC. Confira se o Tailscale está ligado.'; }
});
