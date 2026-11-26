'use strict';

const simulate = document.querySelector('#simulate');
if (simulate) {
  const reset = document.querySelector('#reset-demo');
  const missionState = document.querySelector('#mission-state');
  const primaryRoute = document.querySelector('#primary-route');
  const primaryState = document.querySelector('#primary-state');
  const backupRoute = document.querySelector('#backup-route');
  const backupState = document.querySelector('#backup-state');
  const result = document.querySelector('#route-result');

  simulate.addEventListener('click', () => {
    if (simulate.hasAttribute('aria-disabled')) return;
    missionState.textContent = 'Em execução';
    primaryRoute.classList.add('limited');
    primaryState.textContent = 'HTTP 429';
    backupRoute.classList.add('active');
    backupState.textContent = 'Em uso';
    result.textContent = 'O modelo principal atingiu o limite. A tarefa foi encaminhada ao modelo de reserva.';
    simulate.setAttribute('aria-disabled', 'true');
    reset.disabled = false;
    reset.focus();
  });

  reset.addEventListener('click', () => {
    missionState.textContent = 'Pronta';
    primaryRoute.classList.remove('limited');
    primaryState.textContent = 'Disponível';
    backupRoute.classList.remove('active');
    backupState.textContent = 'Em espera';
    result.textContent = 'Veja como a tarefa pode seguir quando o provedor retorna HTTP 429.';
    simulate.removeAttribute('aria-disabled');
    simulate.focus();
    reset.disabled = true;
  });

  document.querySelector('#route-actions').hidden = false;
}

const devices = document.querySelectorAll('.device[data-os]');
if (devices.length) {
  const userAgent = navigator.userAgent;
  const iPad = /Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1;
  const platform = [
    ['iphone', /iPhone|iPad|iPod/.test(userAgent) || iPad],
    ['android', /Android/.test(userAgent)],
    ['windows', /Windows/.test(userAgent)],
    ['mac', /Macintosh/.test(userAgent)],
    ['linux', /Linux/.test(userAgent) && !/CrOS/.test(userAgent)],
  ].find(([, matches]) => matches)?.[0];
  const device = [...devices].find((link) => link.dataset.os === platform);
  if (device) {
    const label = document.createElement('span');
    label.className = 'tag';
    label.textContent = 'Seu dispositivo';
    device.classList.add('mine');
    device.prepend(label);
  }
}

document.querySelectorAll('.code pre').forEach((code) => {
  const button = document.createElement('button');
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  const label = canCopy ? 'Copiar comando' : 'Selecionar comando';
  button.className = 'button button-small button-outline copy';
  button.type = 'button';
  button.textContent = label;
  code.after(button);

  button.addEventListener('click', async () => {
    if (canCopy) {
      const command = code.textContent.replace(/^\s*\$ +/gm, '').trim();
      try {
        await navigator.clipboard.writeText(command);
        button.textContent = 'Copiado';
        return;
      } catch {
        button.textContent = 'Comando selecionado';
      }
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
  });
});
