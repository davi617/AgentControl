# Ideias do Agent Control

## Entrou agora (Prédio)
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
| Placar do dia | telão no Térreo com quem mais terminou tarefas e o "funcionário do mês" | baixo |
| Clima de verdade | chuva ou sol nas janelas conforme a cidade do PC | baixo |
| Sons opcionais | teclado baixinho, café, "ding" de aprovação (desligado por padrão) | baixo |
| Andar das pessoas | quem entra pelo Modo Time vira bonequinho também, com crachá | médio |
| Reunião de verdade | ao ligar a chamada, quem fala acende o balão e o telão mostra o assunto | médio |
| Festa de Goal | Goal concluído vira festa no Térreo com todo mundo e confete | baixo |
| Modo noturno do time | depois das 22 h os agentes "vão para casa" se pausados e as luzes apagam | baixo |
| Construtor de andar | arrastar móveis e criar salas novas, salvo no `data/` | alto |
| Widget do celular | tela inicial do Android com o andar e quem está trabalhando | médio |
| Atalho de voz | "AgentC, quem está travado?" no app do celular | médio |

## Pagamento
O pagamento está **em revisão**: a página `pagar/` mostra os planos com o aviso e o botão desligado até liberar.
Liga pelo `pagar/config.json` (`"aberto": true`, `"status": ""`) ou pela API do SaaS.
