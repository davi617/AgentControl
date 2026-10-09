# O que mudou

Formato: a versão mais nova primeiro. A versão mora em `version.json` (fonte única: servidor, app do PC e Android).

## 4.1.0 — 2026-10-09

### Novo
- **Código ao vivo** (sala, app do PC e Android): cada agente, pelo nome, mexendo no código agora. Arquivos alterados,
  linhas a mais e a menos, o diff de cada arquivo (filtrado de segredos) e uma linha do tempo com edições e commits.
- **CLI `agentcontrol`**: `ao-vivo --diff`, `codigo`, `diff`, `mandar`, `comandos`, `aprovar`, `recusar`, `falar`,
  `panico`, `auditoria`; no PC ou de fora com `--token`; `--json` para scripts.
- **Nomes dos agentes** em todas as telas (Claude Code, Codex, Qwen Code, Gemini CLI…), não só o id.
- A Central de Missões mostra os nomes dos agentes e se atualiza quando um agente mexe no código.

### Removido
- **Modo Prédio** (os bonequinhos no escritório), na sala, no app do PC, no Android e no site. No lugar dele entra o
  Código ao vivo. A tabela de personagens fica no banco; `/api/state` ainda manda `looks: {}` para apps antigos.

### Corrigido
- Android: a tela da sala dentro do app (era a do Prédio) entrava mandando o token cru num cookie que o servidor
  recusa desde a 3.1, e caía na tela de login. Agora o app abre uma sessão e entra de novo sozinho se ela cair.
- Arquivos da sala lidos pelo mesmo descritor do `stat` (CodeQL `js/file-system-race`) e nome de modelo vindo do
  pedido contado num `Map` no uso da fila (CodeQL `js/remote-property-injection`).
- Ordem que o AgentC cria a partir da conversa de alguém do time fica no nome dessa pessoa (`created_by` e auditoria).

## 4.0.0 — 2026-10-09

A maior atualização até agora: o Agent Control passa a ter trava de verdade para o time inteiro, com registro de
tudo o que acontece.

### Novo
- **Central de Missões**: quadro de tarefas (Kanban), contexto para outro agente, relatório, busca no projeto
  (Ctrl K) e reconexão do ao vivo.
- **Botão de pânico** (sala web, app do PC e Android): para todos os agentes na hora (corta a rodada em andamento),
  desliga os aparelhos conectados e fecha o acesso de quem não é dono até você desligar. Fica gravado: reiniciar o
  Agent Control não reabre o acesso. Avisa a sala e entra na auditoria.
- **Aprovação em dupla** (plano Time): comando protegido só anda com o "sim" de duas pessoas diferentes com papel de
  dono. Um "recusar" de qualquer uma vale na hora, e os agentes só veem a decisão final. As telas mostram "1 de 2".
- **Log de auditoria** só de acréscimo, com hash encadeado: comandos, aprovações, time, aparelhos, licença, pausa,
  modelos, pânico e logins. O banco recusa editar ou apagar uma linha, e a sala mostra se a corrente está íntegra.
  Exporta CSV (com BOM para o Excel e fórmulas neutralizadas).
- **Digital/rosto/PIN no Android** antes de aprovar comando protegido (Android 10+, sem biblioteca a mais).
- Comandos guardam **quem pediu** (`created_by`), não só o `[Nome]` no texto.
- `/api/about` mostra a versão.

### Corrigido
- Pessoa com papel **membro** conseguia criar e apagar atalhos (um atalho escrito por membro e rodado pelo dono saía
  como ordem do dono, sem o nome de quem escreveu) e mudar os avisos do celular do dono. Agora é só do dono.
- Notas rápidas, atalhos e favoritos eram gravados em UTC: no Brasil, uma nota feita depois das 21h ia para o
  diário do dia seguinte. Agora tudo fica em hora local, como o resto.
- `/api/stats` cortava o período em UTC (errava por algumas horas).
- Uma linha `## …` no meio de uma mensagem do chat virava outra mensagem, com data e autor inventados.
- Busca geral: 30 mensagens da sala escondiam comandos, tarefas e notas. Agora cada fonte tem sua cota, e o texto das
  notas fica em cache (antes relia o vault inteiro a cada tecla). Pasta ou nota travada (OneDrive, EBUSY) não derruba
  mais a busca.
- Disco cheio ou arquivo travado ao gravar o uso da fila derrubava o processo; agora fica no log, e a gravação é
  atômica (queda de energia não deixa o JSON pela metade). Promessa rejeitada sem dono também não derruba mais.
- App do PC: depois de aprovar, a tela dizia "aprovado" mesmo quando o servidor respondia outra coisa.
- Sala web: no tema "sistema" com o sistema claro, o cartão de aprovação ficava escuro com texto escuro.
- `/api/app/apk` sem APK publicado respondia 500; agora 404.
- `npm test` travava para sempre no Linux (um teste criava pasta dentro de `/proc`).

### Por dentro
- Rotas da API em tabela (`src/routes.ts`), cada uma com papel mínimo declarado. Um teste passa por **todas** as
  rotas com cada papel (anônimo, leitura, membro, dono) e confirma que nenhuma escrita passa sem CSRF no navegador.
- Migrações do SQLite numeradas (`PRAGMA user_version`), em transação.
- `tsc --noEmit` no CI (`npm run typecheck`); o Node roda `.ts` sem conferir tipos.
- Versão única em `version.json`; `node tools/versao.mjs` sincroniza `package.json` e `.csproj`, e `--check` roda
  no CI e no `npm test`. A release recusa versão diferente do arquivo.
- Testes do servidor: 148 na 3.1; a 4.1 tem 157 (os do Prédio saíram; entraram código ao vivo, CLI e missões).

## 3.1.0 — 2026-10-09
Segurança: sessões no navegador em vez do token no cookie, tela de aparelhos conectados, inbox forjado é restaurado e
o dono é avisado, filtro de segredos mais amplo, dribles da aprovação fechados, CI com actions fixadas por SHA,
CodeQL e atestado de origem na release.

## 3.0.0 — 2026-10-08
Prédio: placar do dia, festa do time, fim de expediente e sons.

## 1.2.1 — 2026-10-06
Prédio: crie seu personagem (com foto).

## 1.2.0 — 2026-10-06
Primeira release com o app do PC e o APK gerados pelo workflow.
