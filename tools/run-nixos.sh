#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ] || [ ! -f "$1" ]; then echo 'Uso: run-nixos.sh /caminho/AgentControl [argumentos]'; exit 2; fi
if [ "${AGENTCONTROL_NIX_ENV:-0}" = 1 ]; then exec "$@"; fi
command -v nix-shell >/dev/null || { echo 'Instale Nix para executar o ambiente NixOS.'; exit 1; }
printf -v command '%q ' "$@"
exec nix-shell "$REPO/tools/nixos.nix" --run "$command"
