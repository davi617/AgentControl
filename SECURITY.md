# Segurança

## Como reportar
Achou uma falha? **Não abra issue pública.** Use **Security → Report a vulnerability** neste repositório
(aviso privado do GitHub). Respondemos em até 7 dias.

## O que o Agent Control garante
- O servidor só escuta em `127.0.0.1`. O acesso de fora (celular/iPhone) só existe se você ligar, só no IP do
  Tailscale (`100.64.0.0/10`) e sempre com token de 256 bits.
- Na tela de entrar do iPhone: o token vira cookie `HttpOnly` + `SameSite=Strict`, login de outra origem é recusado
  e 8 tentativas erradas bloqueiam aquele aparelho por 15 minutos. **Sair** apaga o cookie.
- Escritas pelo navegador exigem `Origin` da própria sala e token CSRF; checagem de `Host` contra DNS rebinding.
- CSP estrita (`script-src 'self'`, sem inline), `frame-ancestors 'none'`, `nosniff`, `no-referrer`,
  `Permissions-Policy` (só microfone, para a chamada) e `Cross-Origin-Opener-Policy`.
- Papéis no Modo Time: só leitura não escreve; aprovar comando protegido e mexer no time é só do dono.
- Deploy, push, merge, release, apagar e pagar ficam esperando aprovação, que vale para um comando só.
- Filtro de segredos (`src/redact.ts`) antes de gravar, mostrar ou mandar texto para um modelo.
- Licença paga assinada com Ed25519 e conferida offline; a chave privada nunca fica no repositório.
- Pagamento acontece no site do meio de pagamento; nenhum dado de cartão passa pelo app ou pelo site.
  O webhook confere o token do gateway e é idempotente.
- CI: testes, build dos apps e varredura de segredos (gitleaks) em todo push.

## Versões com correção
Sempre a versão mais nova em Releases.
