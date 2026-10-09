# Central de Missões · 4.0 em desenvolvimento

A Central reúne o Goal ativo, as tarefas registradas em TASKS.md, os últimos STATUS dos agentes, as aprovações e a
atividade recente. Ela permite planejar o próximo trabalho e levar o contexto do projeto para outra sessão de agente.

## Como usar

1. Abra **Missões** na sala. O primeiro acesso passa a abrir essa seção; a preferência de aba existente continua sendo usada.
2. Confira o progresso e as pendências. Os estados são os informados nos arquivos, e não uma comprovação de que o processo está ligado.
3. Use Kanban ou Lista, buscando por ID, tarefa, responsável ou estado.
4. Escolha um modelo de ordem, descreva o objetivo e selecione o responsável. **Preparar ordem** leva o texto à tela
   Comandos; **Enviar** registra a ordem pelo protocolo existente. É necessário um Goal ativo.
5. Para trabalhar com uma sessão separada, use **Contexto para outro agente** ou **Baixar relatório** e compartilhe o Markdown.
   O relatório inclui as tarefas e os comandos recentes; revise o conteúdo antes de compartilhá-lo fora do seu time.

O Launcher, a bandeja e a Visão geral do HUD abrem a Central em uma janela do navegador, com o projeto atual selecionado.
No celular, ela está disponível na sala web/PWA. Esta mudança não gera nem instala um APK novo.

## Comportamento dos dados

- O endpoint autenticado `GET /api/overview?project=ID` retorna um retrato do projeto sem iniciar agentes ou consultar modelos.
- A contagem de comandos considera o histórico inteiro no SQLite; a lista tem até 30 comandos recentes e 20 pendentes.
- "Concluídos hoje" usa a data de atualização do comando no calendário local do servidor, incluindo ordens criadas em dias anteriores.
- Os estados desconhecidos ficam na fila. Revisão humana e aprovação pendente ficam na coluna Bloqueadas.
- Os caminhos e logs das worktrees ficam fora do retrato da Central. Os dados de tarefas e comandos seguem o filtro existente de segredos.
- A Central atualiza por eventos e a cada 30 segundos enquanto está visível. Consultas têm prazo de 10 segundos.
  Em falha, a última leitura continua na tela com indicação de que pode estar desatualizada.
- A troca de projeto cancela a consulta da Central e da busca. Respostas e eventos da seleção anterior não substituem os dados atuais.
- A reconexão da sala recupera o estado e as listas para alcançar eventos perdidos.
- O service worker inclui o novo módulo da interface e continua sem guardar dados de API ou eventos.

## Busca

**Buscar no projeto** e Ctrl/Cmd+K consultam sala, comandos, tarefas e notas. Os resultados alternam entre as fontes para
que muitas mensagens não escondam uma tarefa ou nota. Notas abrem como prévia de texto; os demais resultados levam à
seção correspondente. As consultas são canceladas quando o texto, o projeto ou a janela de busca muda.

## Verificação

Os testes novos cobrem estados do quadro, contagens com histórico maior que a lista, isolamento entre projetos,
dia local, relatórios, autenticação do endpoint, falhas de leitura e diversidade das fontes na busca.

O build Release do desktop pode ser conferido com:

```bash
dotnet build desktop/AgentControl/AgentControl.csproj -c Release -nologo
npm test
```

O CI existente também verifica sintaxe dos módulos web e builds Windows, Linux, macOS e Android. Uma release e a
instalação nos aparelhos precisam ocorrer depois da revisão desta versão.
