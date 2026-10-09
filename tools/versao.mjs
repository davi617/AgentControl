#!/usr/bin/env node
// Fonte única (v4.0): a versão mora em version.json e o Prédio do site vem de public/predio.js.
//   node tools/versao.mjs           copia para package.json, package-lock.json, .csproj e docs/js/predio.js
//   node tools/versao.mjs --check   só confere (CI); sai com erro e diz o que está fora
// O Android lê version.json direto no build.gradle.kts; a release confere que a versão pedida é esta.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (f) => path.join(root, f);
const check = process.argv.includes('--check');
const { version } = JSON.parse(readFileSync(at('version.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error(`version.json: versão inválida "${version}"`); process.exit(1); }

const wrong = [];
function sync(file, edit) {
  const before = readFileSync(at(file), 'utf8');
  const after = edit(before);
  if (after === before) return;
  if (check) wrong.push(file); else writeFileSync(at(file), after);
}

sync('package.json', (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
// package-lock: a versão do projeto aparece no topo e em packages[""] (as duas primeiras ocorrências).
sync('package-lock.json', (s) => { let n = 0; return s.replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < 2 ? `${a}${version}${b}` : m)); });
sync('desktop/AgentControl/AgentControl.csproj', (s) => s.replace(/<Version>[^<]+<\/Version>/, `<Version>${version}</Version>`));

const predio = readFileSync(at('public/predio.js'), 'utf8');
if (readFileSync(at('docs/js/predio.js'), 'utf8') !== predio) {
  if (check) wrong.push('docs/js/predio.js (diferente de public/predio.js)'); else copyFileSync(at('public/predio.js'), at('docs/js/predio.js'));
}

if (check && wrong.length) {
  console.error(`Fora da versão ${version} / da fonte única:\n  ${wrong.join('\n  ')}\nRode: node tools/versao.mjs`);
  process.exit(1);
}
console.log(check ? `ok: tudo em ${version}` : `sincronizado: ${version}`);
