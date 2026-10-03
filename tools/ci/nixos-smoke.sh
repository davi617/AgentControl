#!/usr/bin/env bash
set -euo pipefail
test "${AGENTCONTROL_NIX_ENV:-0}" = 1
bash -n tools/instalar.sh tools/run-nixos.sh tools/linux-deps.sh
bash tools/linux-deps.sh --check
npm ci
node --test
# No host ld.so cache: force dependencies from the Nix FHS library directories.
export LD_LIBRARY_PATH=/usr/lib:/usr/lib64:/lib:/lib64
python3 tools/ci/native-desktop-smoke.py artifacts/app/AgentControl artifacts
export JARVIS_CONFIG="$PWD/artifacts/configuration with spaces/first run.json"
bash tools/run-nixos.sh "$PWD/artifacts/app/AgentControl" --time 'CLAUDE,AIDER,CHATGPT'
