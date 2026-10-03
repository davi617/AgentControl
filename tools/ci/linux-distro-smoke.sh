#!/usr/bin/env bash
# Disposable CI container only: called as root inside the selected distribution.
set -euo pipefail
. /etc/os-release
case "$ID" in
  alpine)
    apk add --no-cache bash python3 nodejs npm icu-libs openssl libstdc++ zlib libx11 libice libsm fontconfig xvfb font-dejavu xdg-utils
    npm ci ;;
  arch)
    pacman -Syu --noconfirm --needed python icu openssl zlib libx11 libice libsm fontconfig xorg-server-xvfb ttf-dejavu xdg-utils ;;
  ubuntu|debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y python3 libicu-dev libssl-dev zlib1g libx11-6 libice6 libsm6 libfontconfig1 libstdc++6 xvfb fonts-dejavu-core xdg-utils ;;
  fedora)
    dnf install -y python3 libicu openssl-libs zlib libX11 libICE libSM fontconfig libstdc++ xorg-x11-server-Xvfb dejavu-sans-fonts xdg-utils ;;
  opensuse-tumbleweed)
    zypper --non-interactive install python3 libicu libopenssl3 libz1 libX11-6 libICE6 libSM6 fontconfig libstdc++6 xorg-x11-server-Xvfb dejavu-fonts xdg-utils ;;
  *) echo "Unsupported test image: $ID"; exit 2 ;;
esac
if [ "$ID" != alpine ]; then export PATH="/opt/node/bin:$PATH"; fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
bash -n tools/instalar.sh tools/linux-deps.sh tools/agentes/agent-loop.sh
bash tools/linux-deps.sh --check
node --test
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
