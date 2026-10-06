## O que muda

## Como testei
- [ ] `npm test`
- [ ] App do PC compila (`dotnet build desktop/AgentControl/AgentControl.csproj`)
- [ ] App do Android compila (`cd android && ./gradlew assembleDebug`)

## Segurança
- [ ] Nada escuta fora do 127.0.0.1 (remoto só pelo Tailscale, com token)
- [ ] Sem chaves, tokens, licenças ou dados pessoais no diff
