# Linux: instalação e compatibilidade

O desktop é publicado para x64 e ARM64 com o runtime .NET incluído. A versão atual usa Avalonia 11.3 e X11; em sessões Wayland, precisa de XWayland. Bibliotecas nativas continuam sendo fornecidas pela distribuição.

## Arch, Manjaro e EndeavourOS

```bash
sudo pacman -Syu --needed icu openssl zlib libx11 libice libsm fontconfig xdg-utils xorg-xwayland
```

O `-Syu` evita atualização parcial do Arch. Para compilar a partir do código, instale .NET SDK 8; o servidor requer Node 24 ou superior. Verifique `dotnet --list-sdks` e `node --version`, pois versões dos pacotes em distribuições rolling mudam.

## Outras distribuições

### Alpine/musl x64

Alpine precisa de uma publicação própria **linux-musl-x64**. O instalador detecta musl e seleciona esse destino; as bibliotecas Skia/HarfBuzz usadas pelo app já incluem a variante musl x64. Não reutilize o pacote `linux-x64` glibc.

```bash
sudo apk add bash icu-libs openssl libstdc++ zlib libx11 libice libsm fontconfig xdg-utils xwayland
bash tools/linux-deps.sh --check
bash tools/instalar.sh --agentes
```

Para compilar, instale SDK .NET 8 compatível com musl; Node 24+ é necessário para o servidor. ARM64/musl ainda não tem binário gráfico compatível nas dependências atuais; o modo `--sem-app` permanece disponível.

### NixOS

As dependências e caminhos do desktop ficam no ambiente FHS declarado em `tools/nixos.nix`, com Node 24 e SDK .NET 8. Entre nesse ambiente para instalar:

```bash
env_dir="$(nix-build tools/nixos.nix --no-out-link)"
"$env_dir/bin/agent-control-env"
bash tools/instalar.sh --agentes
```

O atalho e o autostart criados dentro desse ambiente usam `tools/run-nixos.sh`, que volta ao mesmo ambiente ao iniciar o executável. Também pode abrir manualmente:

```bash
bash tools/run-nixos.sh "$PWD/desktop/dist/linux-x64/AgentControl"
```

O ambiente não modifica a configuração global do NixOS, não liga agentes e não instala CLIs adicionais automaticamente. Usa o canal `<nixpkgs>` configurado localmente; a CI usa NixOS 25.11. Mantenha o repositório no caminho de instalação, pois o atalho referencia o wrapper e o arquivo Nix.

`bash tools/linux-deps.sh` identifica a família da distribuição e mostra os comandos. Não instala pacotes nem usa sudo automaticamente. `bash tools/linux-deps.sh --check` confere X11, ICE, SM, fontconfig, ICU, OpenSSL, zlib e libstdc++ antes da compilação; o instalador já chama essa verificação.

Há instruções para Debian/Ubuntu e derivados (Mint, Pop!_OS), Fedora/RHEL e derivados, openSUSE e a família Arch. Distros não reconhecidas recebem a lista de bibliotecas para instalação manual. `xdg-utils` é necessário para abrir links e arquivos; integração de bandeja depende do ambiente gráfico.

Depois das dependências:

```bash
git clone "URL_DO_SEU_REPOSITORIO"
cd AgentControl
bash tools/instalar.sh --agentes
```

O modo servidor `--sem-app` dispensa as dependências gráficas e o SDK .NET. Autostart é opcional e usa o padrão XDG, sem exigir systemd. Nenhum agente inicia durante a instalação; revise os lançadores e autentique os CLIs antes de ligar o time.

## O que é validado

A CI `Linux distributions` executa o binário real em contêineres Arch, Ubuntu, Debian, Fedora e openSUSE x64, e Ubuntu/Debian ARM64 nativos. Confere os testes do servidor, configuração inicial, mudanças de time, preservação de dados e renderização das janelas em X11/Xvfb. A aprovação depende do resultado da execução, consultável na aba Actions; criar um job não equivale a ter passado nele.

Validação de 03/10/2026: **todos os sete ambientes passaram**, com 100 testes do servidor por ambiente e as verificações nativas. [Execução e logs](../../../actions/runs/37097820036).

| Distribuição testada | Arquitetura | Resultado |
|---|---|---|
| Arch Linux (rolling) | x64 | PASS |
| Ubuntu 22.04 | x64 | PASS |
| Debian 12 | x64 | PASS |
| Fedora 44 | x64 | PASS |
| openSUSE Tumbleweed | x64 | PASS |
| Ubuntu 24.04 | ARM64 | PASS |
| Debian 12 | ARM64 | PASS |

Contêineres verificam bibliotecas e execução na distribuição, usando o kernel do runner. Não equivalem a testes manuais de GNOME/KDE, Wayland, bandeja, áudio ou instalação em hardware de cada distro. Derivados compartilham dependências, mas não recebem confirmação individual automática.

## Limites de compatibilidade

- Não há um binário único garantido para todo Linux. Distribuição, arquitetura e libc precisam ser compatíveis.
- Alpine usa o destino musl x64; a publicação glibc continua incompatível com musl. Outras distros musl não recebem validação individual.
- NixOS usa o wrapper FHS. Sua CI verifica o ambiente Nix em runner Linux, sem equivaler a testes de uma instalação completa de NixOS, GNOME/KDE, voz ou bandeja. Gentoo e distros não incluídas na CI precisam das bibliotecas equivalentes e validação própria.
- x86 de 32 bits, ARM de 32 bits e Linux antigo não estão cobertos. As imagens rolling são verificadas em cada execução; compatibilidade futura depende dessas verificações.

Referências: [Avalonia 11 — plataformas](https://v11.docs.avaloniaui.net/docs/overview/supported-platforms/) e [.NET — dependências Linux](https://learn.microsoft.com/en-us/dotnet/core/install/linux-scripted-manual).
