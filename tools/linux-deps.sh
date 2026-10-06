#!/usr/bin/env bash
# Dependencies for the glibc desktop build. Print commands by default; never elevate silently.
set -euo pipefail
MODE=${1:---help}
case "$MODE" in --help|--check) ;; *) echo "Uso: bash tools/linux-deps.sh [--help|--check]"; exit 2 ;; esac
if [ "$(uname -s)" != Linux ]; then echo 'Este diagnóstico é para Linux.'; exit 2; fi
ID=unknown; ID_LIKE=''
if [ -r /etc/os-release ]; then . /etc/os-release; fi
echo "Linux: ${PRETTY_NAME:-$ID}; arquitetura: $(uname -m)"
case " $ID $ID_LIKE " in
  *' alpine '*)
    echo 'Dependências: sudo apk add icu-libs openssl libstdc++ zlib libx11 libice libsm fontconfig xdg-utils xwayland'
    echo 'Desktop: publique linux-musl-x64; o binário glibc não serve. Para compilar, instale .NET SDK 8 compatível com musl; servidor: Node 24+.' ;;
  *' nixos '*)
    echo 'Use o ambiente criado por nix-build tools/nixos.nix, conforme docs/linux.md.'
    if [ "${AGENTCONTROL_NIX_ENV:-0}" != 1 ] && [ "$MODE" = --check ]; then exit 1; fi ;;
  *' arch '*|*' manjaro '*|*' endeavouros '*)
    echo 'Dependências: sudo pacman -Syu --needed icu openssl zlib libx11 libice libsm fontconfig xdg-utils xorg-xwayland'
    echo 'Compilação/servidor: .NET SDK 8 e Node 24+ (confira as versões antes de instalar).' ;;
  *' debian '*|*' ubuntu '*)
    echo 'Dependências: sudo apt-get update && sudo apt-get install libx11-6 libice6 libsm6 libfontconfig1 libstdc++6 zlib1g xdg-utils xwayland'
    echo 'Instale também ICU e OpenSSL da sua versão (libicuXX e libssl3/libssl3t64), .NET SDK 8 para compilar e Node 24+ para o servidor.' ;;
  *' fedora '*|*' rhel '*|*' centos '*)
    echo 'Dependências: sudo dnf install libicu openssl-libs zlib libX11 libICE libSM fontconfig libstdc++ xdg-utils xorg-x11-server-Xwayland'
    echo 'Instale .NET SDK 8 para compilar e Node 24+ para o servidor.' ;;
  *' opensuse'*|*' suse '*)
    echo 'Dependências: sudo zypper install libicu libopenssl3 libz1 libX11-6 libICE6 libSM6 fontconfig libstdc++6 xdg-utils xwayland'
    echo 'Instale .NET SDK 8 para compilar e Node 24+ para o servidor.' ;;
  *) echo 'Instale glibc, ICU, OpenSSL, zlib, libstdc++, X11, ICE, SM, fontconfig e xdg-utils pelos pacotes da sua distribuição.' ;;
esac
echo 'Avalonia 11 usa X11; numa sessão Wayland, mantenha XWayland disponível.'
if [ "$MODE" = --help ]; then exit 0; fi
if [ "${AGENTCONTROL_NIX_ENV:-0}" = 1 ]; then
  echo 'Bibliotecas fornecidas pelo ambiente Nix FHS.'
  exit 0
fi
LDCONFIG=$(command -v ldconfig || true)
if [ -z "$LDCONFIG" ] && [ -x /sbin/ldconfig ]; then LDCONFIG=/sbin/ldconfig; fi
LIBRARIES=''
if [ -n "$LDCONFIG" ]; then LIBRARIES=$("$LDCONFIG" -p 2>/dev/null || true); fi
missing=0
for library in libX11.so.6 libICE.so.6 libSM.so.6 libfontconfig.so.1 libstdc++.so.6 libz.so.1 libicuuc.so libssl.so; do
  found=0
  if grep -Fq "$library" <<< "$LIBRARIES"; then found=1; fi
  for path in /lib/"$library"* /usr/lib/"$library"*; do [ ! -e "$path" ] || found=1; done
  if [ "$found" = 0 ]; then echo "Falta: $library"; missing=1; fi
done
if [ "$missing" = 1 ]; then echo 'Instale as dependências indicadas e execute novamente.'; exit 1; fi
echo 'Dependências nativas encontradas.'
