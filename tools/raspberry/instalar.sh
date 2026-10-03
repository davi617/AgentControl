#!/usr/bin/env bash
# Instala o Agent Control num Raspberry Pi (ou qualquer Linux sem tela). Uso: bash tools/raspberry/instalar.sh
# Liga o servidor como serviço do usuário (systemd), só em 127.0.0.1. Acesso de fora: Tailscale + token, nunca porta aberta.
set -euo pipefail
cd "$(dirname "$0")/../.."
need=24
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$have" -lt "$need" ]; then
  echo "Precisa do Node $need ou mais novo (tem: $have). No Raspberry Pi OS 64 bits:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
npm ci --omit=dev
[ -f jarvis.config.json ] || { cp jarvis.config.example.json jarvis.config.json; echo "Criei jarvis.config.json: edite os caminhos do seu projeto."; }
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/agent-control.service <<UNIT
[Unit]
Description=Agent Control (servidor)
After=network.target
[Service]
WorkingDirectory=$PWD
ExecStart=$(command -v node) src/main.ts
Restart=on-failure
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now agent-control.service
loginctl enable-linger "$USER" 2>/dev/null || true   # continua rodando sem ninguém logado
echo "Pronto. Ver a salinha: node tools/terminal/sala.mjs"
