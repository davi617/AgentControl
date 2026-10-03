#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -eq 0 ] || [ ! -f "$1" ]; then echo 'Uso: run-nixos.sh /caminho/AgentControl [argumentos]'; exit 2; fi
if [ "${AGENTCONTROL_NIX_ENV:-0}" = 1 ]; then exec "$@"; fi
command -v nix-build >/dev/null || { echo 'Instale Nix para executar o ambiente NixOS.'; exit 1; }
printf -v command '%q ' "$@"
env_dir=$(nix-build "$REPO/tools/nixos.nix" --no-out-link)
exec "$env_dir/bin/agent-control-env" -c "$command"
