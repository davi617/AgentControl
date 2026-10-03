#!/usr/bin/env bash
# Instala o Agent Control no Linux ou no macOS (rodar de dentro do repositório):
#   bash tools/instalar.sh                 servidor + app do PC + atalho no menu de apps
#   bash tools/instalar.sh --autostart     também liga os serviços sozinho quando você entra no sistema
#   bash tools/instalar.sh --agentes       também copia os lançadores de exemplo dos agentes (sem sobrescrever)
#   bash tools/instalar.sh --sem-app       só o servidor (máquina sem tela)
# Precisa: Node 24+, e .NET SDK 8 para compilar o app (https://dot.net). Nada escuta fora do 127.0.0.1.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AUTO=0; AGENTES=0; APP=1
for a in "$@"; do case "$a" in --autostart) AUTO=1 ;; --agentes) AGENTES=1 ;; --sem-app) APP=0 ;; *) echo "opção desconhecida: $a"; exit 2 ;; esac; done
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS-$ARCH" in
  Linux-x86_64) RID=linux-x64 ;; Linux-aarch64|Linux-arm64) RID=linux-arm64 ;;
  Darwin-arm64) RID=osx-arm64 ;; Darwin-x86_64) RID=osx-x64 ;;
  *) echo "Sistema não suportado: $OS $ARCH"; exit 1 ;;
esac
if [ "$OS" = Linux ] && (ldd --version 2>&1 || true) | grep -qi musl; then
  case "$ARCH" in
    x86_64) RID=linux-musl-x64 ;;
    *) echo 'Desktop musl disponível somente para x64 nesta versão. Use --sem-app para servidor.'; [ "$APP" = 0 ] || exit 1 ;;
  esac
fi
if [ "$OS" = Linux ] && [ "$APP" = 1 ]; then
  bash "$REPO/tools/linux-deps.sh" --check
fi
ok() { printf '\033[32m%s\033[0m\n' "$*"; }
aviso() { printf '\033[33m%s\033[0m\n' "$*"; }

# 1) Node e dependências do servidor
command -v node >/dev/null || { echo "Instale o Node 24+ (https://nodejs.org ou nvm) e rode de novo."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || { echo "Precisa do Node 24+ (tem $(node -v))."; exit 1; }
(cd "$REPO" && npm ci --omit=dev --no-audit --no-fund)
ok "Servidor: dependências instaladas."
[ -f "$REPO/jarvis.config.json" ] || { cp "$REPO/jarvis.config.example.json" "$REPO/jarvis.config.json"; aviso "Criei jarvis.config.json a partir do exemplo: ajuste o vault e as worktrees."; }
command -v 9router >/dev/null || [ -f "$(npm root -g)/9router/cli.js" ] || aviso "9Router não encontrado. Para os modelos: npm i -g 9router (e configure a chave em ~/.config/agent-control/9router.key)."

# 2) App do PC (Launcher + HUD + AgentC)
if [ "$APP" = 1 ]; then
  command -v dotnet >/dev/null || { echo "Instale o .NET SDK 8 (https://dot.net) para compilar o app, ou rode com --sem-app."; exit 1; }
  OUT="$REPO/desktop/dist/$RID"
  dotnet publish "$REPO/desktop/AgentControl/AgentControl.csproj" -c Release -r "$RID" --self-contained true \
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o "$OUT"
  chmod +x "$OUT/AgentControl"
  if [ "$OS" = Darwin ]; then
    APPDIR="$HOME/Applications/Agent Control.app"
    mkdir -p "$APPDIR/Contents/MacOS" "$APPDIR/Contents/Resources"
    cp -R "$OUT/." "$APPDIR/Contents/MacOS/"
    if command -v sips >/dev/null && command -v iconutil >/dev/null; then
      IS="$(mktemp -d)/agentc.iconset"; mkdir -p "$IS"
      for s in 16 32 128 256 512; do sips -z $s $s "$REPO/desktop/AgentControl/Assets/agentc.png" --out "$IS/icon_${s}x${s}.png" >/dev/null; done
      iconutil -c icns "$IS" -o "$APPDIR/Contents/Resources/agentc.icns" || true
    fi
    cat > "$APPDIR/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Agent Control</string>
  <key>CFBundleDisplayName</key><string>Agent Control</string>
  <key>CFBundleIdentifier</key><string>dev.agentcontrol.app</string>
  <key>CFBundleExecutable</key><string>AgentControl</string>
  <key>CFBundleIconFile</key><string>agentc</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
    # App compilado aqui, sem assinatura da Apple: tira a quarentena para o Gatekeeper não bloquear.
    xattr -dr com.apple.quarantine "$APPDIR" 2>/dev/null || true
    EXE="$APPDIR/Contents/MacOS/AgentControl"
    ok "App: $APPDIR (abra pelo Launchpad ou Spotlight: Agent Control)."
  else
    EXE="$OUT/AgentControl"
    EXEC_LINE="\"$EXE\""
    if [ "${AGENTCONTROL_NIX_ENV:-0}" = 1 ]; then
      chmod +x "$REPO/tools/run-nixos.sh"
      EXEC_LINE="\"$REPO/tools/run-nixos.sh\" \"$EXE\""
    fi
    ICON="$HOME/.local/share/icons/hicolor/512x512/apps/agent-control.png"
    mkdir -p "$(dirname "$ICON")" "$HOME/.local/share/applications"
    cp "$REPO/desktop/AgentControl/Assets/agentc.png" "$ICON"
    cat > "$HOME/.local/share/applications/agent-control.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Agent Control
Comment=Seu time de agentes de IA num só lugar
Exec=$EXEC_LINE
Icon=agent-control
Terminal=false
Categories=Development;Utility;
EOF
    command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" || true
    ok "App: $EXE (no menu de aplicativos: Agent Control)."
    aviso "No GNOME, o ícone na bandeja precisa da extensão AppIndicator; sem ela, o botão direito no AgentC esconde/mostra."
  fi
fi

# 3) Ligar sozinho ao entrar no sistema (só com --autostart)
if [ "$AUTO" = 1 ]; then
  [ "$APP" = 1 ] || { echo "--autostart precisa do app (não use --sem-app)."; exit 1; }
  if [ "$OS" = Darwin ]; then
    PL="$HOME/Library/LaunchAgents/dev.agentcontrol.autostart.plist"; mkdir -p "$(dirname "$PL")"
    cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.agentcontrol.autostart</string>
  <key>ProgramArguments</key><array><string>$EXE</string><string>--autostart</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
    ok "Autostart: $PL (para tirar: apague esse arquivo)."
  else
    mkdir -p "$HOME/.config/autostart"
    sed "s|^Exec=.*|Exec=$EXEC_LINE --autostart|; s|^Name=.*|Name=Agent Control (ligar serviços)|" "$HOME/.local/share/applications/agent-control.desktop" > "$HOME/.config/autostart/agent-control.desktop"
    ok "Autostart: ~/.config/autostart/agent-control.desktop (para tirar: apague esse arquivo)."
  fi
fi

# 4) Lançadores dos agentes (só com --agentes; nunca sobrescreve)
if [ "$AGENTES" = 1 ]; then
  L="$HOME/.config/agent-control/launchers"; mkdir -p "$L"
  for f in "$REPO"/tools/agentes/launchers/*.sh.example; do
    n="$(basename "$f" .example)"
    [ -f "$L/$n" ] && { echo "$n: já existe, mantido."; continue; }
    cp "$f" "$L/$n"; chmod +x "$L/$n"; echo "$n: copiado."
  done
  ok "Agentes: ajuste os lançadores em $L e ligue com: bash tools/agentes/ligar-agentes.sh (ou o botão Ligar agentes)."
fi
ok "Pronto. Abra o Agent Control e toque em Ligar tudo."
