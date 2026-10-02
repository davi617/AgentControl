#!/data/data/com.termux/files/usr/bin/bash
# JARVIS rodando no celular (Termux). O código, o vault e as .ai-team chegam do PC pelo Syncthing em ~/dw.
# Uso: bash ~/dw/jarvis/phone/start.sh 100.x.y.z   (IP DESTE celular no app do Tailscale; só na 1ª vez)
set -e
STATE="$HOME/jarvis-phone"
mkdir -p "$STATE"

IP="${1:-$(cat "$STATE/ip" 2>/dev/null || true)}"
case "$IP" in
  100.*) echo "$IP" > "$STATE/ip" ;;
  *) echo "Passe o IP do celular no Tailscale (começa com 100.): bash ~/dw/jarvis/phone/start.sh 100.x.y.z"; exit 1 ;;
esac

# O que o celular gera (node_modules etc.) não pode voltar para o PC: o celular usa a mesma lista de ignorados.
grep -qs 'stglobalignore' "$HOME/dw/.stignore" || echo '#include .stglobalignore' >> "$HOME/dw/.stignore"

sed "s/__TAILSCALE_IP__/$IP/" "$HOME/dw/jarvis/phone/jarvis.phone.template.json" > "$STATE/config.json"

cd "$HOME/dw/jarvis"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm install --omit=dev --no-audit --no-fund
  touch node_modules
fi

# Android mata app em segundo plano: segura o Termux acordado e garante o Syncthing ligado.
termux-wake-lock 2>/dev/null || true
pgrep -f 'syncthing serve' >/dev/null || (nohup syncthing serve --no-browser > "$STATE/syncthing.log" 2>&1 &)

echo "JARVIS no celular. No app JARVIS use: http://$IP:20150"
echo "Token do app: cat ~/jarvis-phone/remote-token.txt   (criado na 1ª vez que o servidor sobe)"
JARVIS_CONFIG="$STATE/config.json" exec node src/main.ts
