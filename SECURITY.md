# Segurança

## Como reportar
Achou uma falha? **Não abra issue pública.** Use **Security → Report a vulnerability** neste repositório
(aviso privado do GitHub). Respondemos em até 7 dias.

## O que o Agent Control garante
- O servidor só escuta em `127.0.0.1`. O acesso de fora (celular/iPhone) só existe se você ligar, só no IP do
  Tailscale (`100.64.0.0/10`) e sempre com token de 256 bits.
- Na tela de entrar do iPhone: o token é trocado por uma **sessão só daquele aparelho** (cookie `HttpOnly` +
  `SameSite=Strict`, 30 dias; o token nunca fica no cookie e o servidor guarda só o hash). Login de outra origem é
  recusado e 8 tentativas erradas bloqueiam aquele aparelho por 15 minutos. **Sair** encerra a sessão no servidor;
  em **Aparelhos conectados** o dono desconecta qualquer navegador. Quem sai do time perde todas as sessões.
- Escritas pelo navegador exigem `Origin` da própria sala e token CSRF; checagem de `Host` contra DNS rebinding.
- CSP estrita (`script-src 'self'`, sem inline), `frame-ancestors 'none'`, `nosniff`, `no-referrer`,
  `Permissions-Policy` (só microfone, para a chamada) e `Cross-Origin-Opener-Policy`.
- Papéis no Modo Time: só leitura não escreve; aprovar comando protegido e mexer no time é só do dono.
- Deploy, push, merge, release, apagar e pagar ficam esperando aprovação, que vale para um comando só.
- Filtro de segredos (`src/redact.ts`) antes de gravar, mostrar ou mandar texto para um modelo — inclusive anexos
  de texto da chamada, que vão para o vault já filtrados.
- Licença paga assinada com Ed25519 e conferida offline; a chave privada nunca fica no repositório.
- Pagamento acontece no site do meio de pagamento; nenhum dado de cartão passa pelo app ou pelo site.
  O webhook confere o token do gateway e é idempotente.
- CI: testes, build dos apps, varredura de segredos (gitleaks) e CodeQL; actions fixadas por SHA.
- Release com `SHA256SUMS.txt` e atestado de origem: `gh attestation verify <arquivo> --repo davi617/AgentControl`.

## Em quem o Agent Control confia (e o que ainda não garante)
- **Programas do próprio PC são tratados como você.** Qualquer processo local consegue pegar o token CSRF em
  `/api/session` e usar a fila em `127.0.0.1:20129`. Num PC compartilhado com outras contas, não ligue o servidor.
- **A aprovação de comando protegido é um combinado com o agente, não uma trava.** O JARVIS segura o comando e
  marca `VIOLATION` se o agente andar sem `approved: J-xxx`, mas quem impede o push de verdade é o agente não ter
  credencial de push na worktree. Não deixe token do GitHub/deploy nas pastas dos agentes.
- **A detecção de ação protegida é por palavras** (com normalização contra caractere invisível e acento). Frases
  muito indiretas podem passar.
- **Fora do escopo:** um agente comprometido na própria worktree (ele roda com as permissões do seu usuário).

## Versões com correção
Sempre a versão mais nova em Releases.
