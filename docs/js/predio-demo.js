// Demonstração do Modo Prédio no site: o mesmo código do app (predio.js) com um time de mentira que muda de estado sozinho.
import { createPredio } from './predio.js';

const NAMES = ['CLAUDE', 'CODEX', 'GEMINI', 'QWEN', 'HERMES', 'OPENCODE', 'DROID', 'OPENCLAW'];
const CYCLE = ['WORKING', 'WORKING', 'REVIEW', 'DONE', 'BLOCKED', 'WORKING', ''];
const LINES = ['Terminei: testes passando ✓', 'Peguei a ordem J-014.', 'Preciso da sua aprovação para o push.', 'Revisando o login…', 'Café rápido e já volto.', 'Achei o bug do HUD!', 'Subi a correção na branch.'];

export function start(root) {
  const predio = createPredio(root, {});
  const now = () => new Date().toISOString();
  const state = NAMES.map((id, i) => ({ id, latest: { status: CYCLE[i % CYCLE.length], task: `T-${10 + i} ${['login', 'HUD', 'site', 'testes', 'Pix', 'Android', 'docs', 'deploy'][i]}`, ts: now() }, model: 'nvidia/glm-5.3' }));
  predio.update({ agents: state });
  predio.pending(1);
  predio.show();
  let n = 0;
  setInterval(() => {
    const a = state[Math.floor(Math.random() * state.length)];
    a.latest = { ...a.latest, status: CYCLE[Math.floor(Math.random() * CYCLE.length)], ts: now() };
    predio.update({ agents: state });
    const who = state[Math.floor(Math.random() * state.length)];
    predio.chat([{ agent: who.id, body: LINES[n++ % LINES.length] }]);
    if (n % 5 === 0) predio.chat([{ agent: 'DONO', body: 'Bom trabalho, time!' }]);
  }, 6000);
}
