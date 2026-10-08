# Ideias do Agent Control

## Entrou na 3.0 (Prédio)
- **Placar do dia:** telão no Correio do Térreo com o pódio (🥇🥈🥉) de quem mais terminou tarefas hoje e o destaque do
  dia. Cada tarefa conta uma vez (agente + horário do STATUS), mesmo recarregando; zera à meia-noite. A estante de
  troféus da Diretoria passou a contar pelo placar.
- **Festa do time:** quando o time todo termina, ou o Goal ativo é encerrado, todo mundo desce para o Térreo por 15 s:
  confete, balões ("Missão cumprida!"), o chefe junto e uma faixa colorida por cima de qualquer andar.
- **Fim de expediente:** das 22 h às 6 h quem está parado se despede ("Fui! Até amanhã 👋"), sai pela recepção e some
  do prédio; o andar do time sem ninguém trabalhando apaga a luz. Chegou ordem, ele volta pela recepção.
- **Sons opcionais:** "ding" de aprovação nova e do elevador, estalo de confete e fanfarra da festa. Feitos na hora
  (Web Audio, sem arquivos) e desligados por padrão.
- **Achar agente:** lista 🔎 na barra; a tela vai para o andar dele, aproxima e segue. O cartão mostra quantas tarefas ele
  terminou hoje e se foi para casa.
- **Foto do andar:** 📷 salva o andar em PNG.
- **Atalhos:** 0–9 vão direto ao andar, F tela cheia, M sons, P foto (além de setas, +/− e Esc).
- **Site:** seção "Novo na 3.0", a demonstração faz festa de vez em quando e, fora do GitHub Pages, os links do GitHub
  vão para a busca em vez de um endereço quebrado (e a API não é chamada à toa).

## Entrou na 1.2 (Prédio)
- **Seu personagem (com foto):** botão 🧑 no Prédio. Escolha pele, cabelo, roupa, calça, tênis e acessório, ou ponha
  uma foto: o app tira dela a cor da pele, a cor do cabelo e se é comprido ou careca. A foto fica só no aparelho; o
  servidor guarda só as cores. Dá para fazer o personagem de cada agente também (cartão → "Personagem").
- **Elevador:** dois elevadores na sala do canto de cada andar, no lugar da escada. Quem troca de andar aperta o
  botão, espera na marca, entra (até 4 por cabine), a porta fecha e o visor conta os andares; sai no andar certo.
  Seguindo alguém, a tela troca de andar junto com a cabine. A fila vira um contador ("3 esperando o elevador").
- **Bonequinhos novos:** cabeça maior com contorno, olhos, sobrancelha e bochecha; camiseta, listrada, moletom ou
  polo; óculos, fone ou barba de vez em quando; 8 cabelos (cacheado e rabo de cavalo entraram); de costas quando
  sobem a tela; cara de preocupado quando travado, boca aberta comemorando, olho fechado dormindo.
- **Decoração das salas:** tapetes, quadros na parede, luminárias que acendem à noite, aquário com peixes na recepção,
  letreiro neon "AGENT CONTROL", máquina de lanche e bebedouro na copa, flores no jardim, estante de troféus na
  sala do chefe (conta quem terminou hoje), quadro de tarefas em cada sala do time (quem senta ali e no que trabalha).
- **Datas do ano:** abóboras em outubro, bandeirinhas de festa junina em junho/julho, árvore de Natal em dezembro.
- **AgentC mascote:** o robozinho passeia pelos andares e troca de andar de elevador; toque nele para ele falar.
- **Vida no escritório:** agentes parados perto um do outro trocam uma frase ("Bora um café?"); quem termina uma
  tarefa solta confete e vai para a copa; o chefe vai conferir o painel quando tem aprovação esperando.
- **Mais leve:** chão, paredes e decoração ficam numa camada guardada (só redesenha quando muda); 30 quadros por
  segundo; nítido em tela retina (iPhone, Mac, celulares).

## Próximas ideias
| Ideia | Como seria | Esforço |
|---|---|---|
| Mesa personalizada | cada agente escolhe planta, caneca e cor da cadeira (salvo no servidor) | médio |
| Clima de verdade | chuva ou sol nas janelas conforme a cidade do PC | baixo |
| Andar das pessoas | quem entra pelo Modo Time vira bonequinho também, com crachá | médio |
| Reunião de verdade | ao ligar a chamada, quem fala acende o balão e o telão mostra o assunto | médio |
| Construtor de andar | arrastar móveis e criar salas novas, salvo no `data/` | alto |
| Widget do celular | tela inicial do Android com o andar e quem está trabalhando | médio |
| Atalho de voz | "AgentC, quem está travado?" no app do celular | médio |
| Placar no servidor | o placar sai do aparelho e vai para o `data/`, igual em todo celular e PC | baixo |
| Semana no telão | gráfico de barras dos 7 dias no telão, com o recorde da semana | baixo |
| Crachá de conquistas | "10 tarefas seguidas sem travar", "primeiro do dia": selo no cartão do agente | médio |
| Ponto eletrônico | horário que cada agente chegou e saiu (a partir dos STATUS), visto no cartão | baixo |
| Visita do chefe | tocar numa sala do time leva você (o bonequinho de terno) até lá | baixo |
| Mapa do prédio | miniatura de todos os andares lado a lado, com pontinhos de cada agente | médio |
| Tema do escritório | piso, paredes e cores das salas escolhidos no editor (madeira, neon, minimalista) | médio |
| Gravação do dia | timelapse do andar em GIF/WebM (MediaRecorder do canvas) | médio |
| Notificação de festa | aviso no celular e no HUD do PC quando a festa começa | baixo |

## Pagamento
O pagamento está **em revisão**: a página `pagar/` mostra os planos com o aviso e o botão desligado até liberar.
Liga pelo `pagar/config.json` (`"aberto": true`, `"status": ""`) ou pela API do SaaS.
