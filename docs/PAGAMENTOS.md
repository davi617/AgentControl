# Pagamentos e planos (freemium)

## Resumo
- O app continua **aberto (MIT) e grátis** no seu PC. Os planos pagos liberam **mais pessoas no Modo Time** e **serviços na nuvem**
  (acesso de fora sem Tailscale, backup, auditoria longa) — o que tem custo para nós e não dá para "tirar do código".
- **Não** fazemos processamento de pagamento próprio: isso exige autorização do Banco Central como instituição de pagamento
  e certificação PCI DSS para cartão. O "nosso sistema" é a camada de **cobrança, licença e limites** em cima de um gateway.

## Planos
| Plano | Preço | Pessoas no time | O que tem |
|---|---|---|---|
| Grátis | R$ 0 | 3 (com você) | agentes ilimitados no PC, sala, chamada, HUD, app do celular |
| Pro | R$ 29/mês | 5 | + acesso de fora sem Tailscale (nuvem), backup da configuração |
| Time | R$ 19 por pessoa/mês | sem limite | + aprovação em dupla, histórico/auditoria de 1 ano |
| Empresa | sob consulta | sem limite | + SSO, suporte prioritário, contrato |

Referência de mercado (2026): Linear US$ 10–16/pessoa, Cursor Teams US$ 40/pessoa, Codex Business US$ 25/pessoa,
Factory US$ 46/assento, Devin Team US$ 500/mês. Os números acima são ponto de partida, não decisão final.

## Como o app sabe o plano (já implementado)
- `src/plans.ts`: tabela de planos e **licença assinada Ed25519** (`AC1.<dados>.<assinatura>`). O app confere a assinatura
  **offline** com a chave pública; editar a licença invalida a assinatura. Vencida ou inválida → volta para o Grátis com o motivo.
- `GET /api/plan` (qualquer pessoa do time) e `POST /api/plan/license` (só o dono) — a licença fica em `data/license.txt`.
- O convite do Modo Time respeita o limite: passou do número de pessoas → **402** com a mensagem do plano.
- `tools/licenca.mjs`: `chaves` (gera o par uma vez; privada em `~/.config/agent-control/`, nunca impressa),
  `emitir <plano> <cliente> <dias> [pessoas]`, `conferir <licença>`.
- Sem chave pública configurada (`AGENT_CONTROL_LICENSE_PUBKEY`), nenhuma licença paga vale: quem compila o código aberto fica no Grátis.

## Cobrança (próximo passo — precisa do dono criar as contas)
```
cliente ──► página de planos (site) ──► checkout do gateway (Pix Automático / cartão)
                                              │ webhook "pagamento confirmado / assinatura renovada / cancelada"
                                              ▼
                               serviço de licenças (nuvem, pequeno) ──► assina a licença (Ed25519)
                                              │ e-mail / link mágico                │ renovação mensal
                                              ▼                                     ▼
                                   cliente cola a licença no app      app busca a licença nova sozinho (opcional)
```
- **Brasil**: Asaas (Pix Automático/recorrente ~0,99%, cartão ~2,99%) ou Mercado Pago/Pagar.me/Iugu.
  Pix Automático (BC, 2026) é a recorrência mais barata para assinatura mensal.
- **Internacional**: Merchant of Record (cuida de imposto/IVA): Polar (~4% + US$ 0,40, entrega chave de licença),
  Paddle ou Lemon Squeezy (~5% + US$ 0,50). Stripe Billing se for só cartão.
- O webhook **sempre** confere a assinatura do gateway e é idempotente (o mesmo evento duas vezes não emite duas licenças).
- Nenhuma chave de gateway no app nem no repositório: só no serviço de licenças, por variável de ambiente.

## O que só o dono faz
1. Criar a conta no gateway escolhido (aceitar termos, KYC, conta bancária).
2. Rodar `node tools/licenca.mjs chaves` e guardar a chave privada com backup offline.
3. Decidir os preços finais e publicar a página de planos.

## Fontes
- Open core / freemium: https://dev.to/whoffagents/how-to-monetize-an-open-source-project-freemium-open-core-and-license-gating-4il6 ·
  https://openalternative.co/blog/how-open-source-companies-make-money · https://blog.mean.ceo/open-source-monetization-trends-september-2026/
- Gateways BR e Pix Automático: https://forjadesistemas.com.br/blog/pix-automatico-recorrencia-saas-proprio-2026/ ·
  https://mindconsulting.com.br/2026/07/gateways-pagamento-online-brasil-comparativo-2026/ · https://www.kataly.com.br/blog/ranking-taxas-gateways-pagamento-2026-benchmark
- Merchant of Record: https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026 ·
  https://stilllater.com/dev-tools/lemonsqueezy-vs-stripe-vs-paddle/
- Licença offline Ed25519: https://docs.rs/crate/keylight/0.3.5 · https://github.com/franzos/signet
- Regulação (instituição de pagamento): https://www.contabeis.com.br/legislacao/56377/resolucao-bacen-4282-2013/
- Preços de time: https://mem0.ai/blog/cursor-pricing · https://usagepricing.com/blueprint/linear
