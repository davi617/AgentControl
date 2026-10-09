# Revisão para o Claude Code

O dono pediu uma grande atualização do AgentControl com colaboração entre Codex e Claude Code. Esta proposta entrega
a Central de Missões e melhorias de busca, coordenação e reconexão, na versão de desenvolvimento 3.2.

## Estado da colaboração

Codex preparou a implementação. A chamada local de revisão ao Claude Code terminou sem resposta após 45 segundos;
o conector de acesso ao computador também estava offline. Este documento é o contexto para retomar a revisão em uma
sessão disponível. Ele não representa uma revisão concluída pelo Claude, nem uma ordem registrada no JARVIS-INBOX.

## Arquivos para revisar

- `src/overview.ts`, `src/server.ts`: retrato do projeto, contagens e autenticação da rota.
- `src/search.ts`: resultados alternados entre sala, comandos, tarefas e notas.
- `public/missions.js`: Central, Kanban/lista, planejamento, relatório e busca.
- `public/app.js`, `public/index.html`, `public/style.css`, `public/sw.js`: integração, navegação, reconexão e cache.
- `desktop/AgentControl/Ui/{LauncherWindow,HudHost,FullWindow}.cs`: atalhos que abrem a Central com o projeto atual.
- `test/overview.test.ts`, `test/missions.test.mjs`: casos novos.

## Revisão solicitada

1. Confira a experiência no navegador do PC e no celular: teclado, filtros, rolagem, tema claro e escuro e leitura dos cartões.
2. Troque rapidamente entre projetos, desligue o servidor e reconecte. Verifique se dados de um projeto não aparecem em outro.
3. Prepare uma ordem para um agente e uma para o líder. Verifique os destinos e a aprovação de uma ação protegida.
4. Confira números com mais de 30 comandos, mais de 20 aprovações e tarefas sem estado conhecido.
5. Registre problemas com arquivo, evidência e próximo passo. Trabalhe em uma branch/worktree própria para qualquer correção.

## Limites da verificação local

O build do desktop passou. A verificação de vulnerabilidades do NuGet não conseguiu consultar a rede, e o compilador
registrou avisos existentes dos analisadores e do Avalonia.

O ambiente local permite os testes de dados e do handler sem sockets. Testes que abrem `127.0.0.1` recebem `EPERM`;
o teste que inicia um subprocesso para conferir fuso também recebe `EPERM`. O Chromium de teste não iniciou por bloqueio
de sockets. A suíte completa e a conferência visual precisam ser executadas no CI ou em uma sessão com esses recursos.

As alterações que já estavam sem commit na pasta de trabalho original foram preservadas. A proposta também inclui as
correções já commitadas de índices, leitura tolerante a arquivos ocupados, limites da fila, feed, chamada e Prédio que
estavam na base local posterior à versão publicada no main.
