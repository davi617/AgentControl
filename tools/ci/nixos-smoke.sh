#!/usr/bin/env bash
set -euo pipefail
test "${AGENTCONTROL_NIX_ENV:-0}" = 1
bash -n tools/instalar.sh tools/run-nixos.sh tools/linux-deps.sh
bash tools/linux-deps.sh --check
npm ci
node --test
# No host ld.so cache: force dependencies from the Nix FHS library directories.
export LD_LIBRARY_PATH=/usr/lib:/usr/lib64:/lib:/lib64
Xvfb :99 -screen 0 1440x1000x24 > artifacts/xvfb.log 2>&1 &
display_pid=$!
trap 'kill "$display_pid" 2>/dev/null || true' EXIT
export DISPLAY=:99 AGENTCONTROL_TEST_DISPLAY_READY=1
for attempt in {1..50}; do
  [ -S /tmp/.X11-unix/X99 ] && break
  kill -0 "$display_pid" || { cat artifacts/xvfb.log; exit 1; }
  sleep 0.1
done
python3 tools/ci/native-desktop-smoke.py artifacts/app/AgentControl artifacts
export JARVIS_CONFIG="$PWD/artifacts/configuration with spaces/first run.json"
bash tools/run-nixos.sh "$PWD/artifacts/app/AgentControl" --time 'CLAUDE,AIDER,CHATGPT'
