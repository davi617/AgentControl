// Páginas internas: links do GitHub sem nome de dono no código (vem do endereço do GitHub Pages ou do <meta name="repository">),
// downloads da versão mais nova, "seu aparelho" marcado e botão de copiar.
const meta = document.querySelector('meta[name="repository"]')?.content;
const owner = location.hostname.endsWith('.github.io') ? location.hostname.slice(0, -10) : '';
const project = location.hostname.endsWith('.github.io') ? (location.pathname.split('/').filter(Boolean)[0] || 'AgentControl') : 'AgentControl';
const repo = meta || (owner ? `${owner}/${project}` : '');
const gh = repo ? `https://github.com/${repo}` : 'https://github.com/search?q=AgentControl&type=repositories';
document.querySelectorAll('[data-gh]').forEach((a) => { a.href = repo ? gh + a.dataset.gh : gh; });
document.querySelectorAll('[data-dl]').forEach((a) => { a.href = repo ? `${gh}/releases/latest/download/${a.dataset.dl}` : `${gh}`; });

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const mine = isIOS ? 'iphone' : /Android/i.test(ua) ? 'android' : /Win/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'mac' : /CrOS/i.test(ua) ? 'linux' : /Linux/i.test(ua) ? 'linux' : null;
document.querySelectorAll('[data-os]').forEach((c) => { if (c.dataset.os === mine) { c.classList.add('mine'); const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Seu aparelho'; c.prepend(t); } });

document.querySelectorAll('.code').forEach((box) => {
  const b = document.createElement('button'); b.className = 'copy'; b.type = 'button'; b.textContent = 'Copiar';
  b.addEventListener('click', async () => {
    const text = box.querySelector('pre').innerText.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.replace(/^\s*\$\s*/, '')).join('\n');
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copiado ✓'; } catch { b.textContent = 'Selecione e copie'; }
    setTimeout(() => { b.textContent = 'Copiar'; }, 1800);
  });
  box.append(b);
});

// Links e versao atualizados pelo site; API de Releases nao e necessaria.
const setVer = (v) => {
  document.querySelectorAll('[data-ver]').forEach(e => {e.textContent = ' · versão ' + v;});
  document.querySelectorAll('[data-versao]').forEach(e => {e.textContent = v; if (e.tagName === 'A') e.href = '../#baixar';});
};
setVer('v4.4.0');
fetch('../assets/downloads.json', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(j => {
  if (!j || !j.downloads || typeof j.downloads !== 'object') return;
  document.querySelectorAll('[data-dl]').forEach(a => {
    const url = j.downloads[a.dataset.dl];
    if (typeof url !== 'string') return;
    try { const parsed = new URL(url); if (parsed.protocol === 'https:') a.href = parsed.href; } catch {}
  });
  if (/^v[0-9]+[.][0-9]+[.][0-9]+$/.test(j.version)) setVer(j.version);
}).catch(() => {});
