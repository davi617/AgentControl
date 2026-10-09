# Como contribuir

Obrigado por querer ajudar. O Agent Control é MIT e aceita correções, testes e ideias.

## Antes de começar
- Leia o [ARCHITECTURE.md](ARCHITECTURE.md) (5 minutos) para saber onde cada coisa mora.
- Falha de segurança: **não** abra issue pública. Veja o [SECURITY.md](SECURITY.md).

## Rodar
```bash
npm ci
npm test            # servidor (node --test), ~20 s
npm run typecheck   # tipos (o Node roda .ts sem conferir)
node tools/versao.mjs --check
```
App do PC: `dotnet build desktop/AgentControl/AgentControl.csproj` (.NET 8).
Android: JDK 17 + Android SDK, `cd android && ./gradlew assembleDebug`.

## Regras do código
- **Rota nova da API vai em `src/routes.ts`**, com o papel mínimo (`leitura`, `membro` ou `dono`). Escrita nunca é
  `leitura`. O teste da matriz cobre a rota sozinho.
- **Mudança no banco é migração nova** no fim da lista em `Store.migrate()`. Nunca edite um passo já publicado.
- Ação que mexe no time, na segurança ou nos agentes: registre na auditoria (`audit(c, ...)` em `routes.ts`).
- Texto que vai para arquivo, tela ou modelo passa por `redact()`.
- Hora: use `localIso()`/`localDay()` (`src/date.ts`). Os registros são em hora local, sem fuso.
- `public/predio.js` é a fonte; `docs/js/predio.js` é cópia (`node tools/versao.mjs`).
- Comentários e textos de tela em português do Brasil, curtos e diretos, explicando o porquê.

## Versão e release
1. Mude `version.json` e rode `node tools/versao.mjs`.
2. Escreva no `CHANGELOG.md`.
3. Depois do merge na `main`, rode o workflow **Release** com a mesma versão.

## Pull request
- Um assunto por PR, com teste para bug corrigido.
- O CI precisa passar: testes, tipos, versão, build do PC (Windows/Linux/macOS), APK, gitleaks e CodeQL.
