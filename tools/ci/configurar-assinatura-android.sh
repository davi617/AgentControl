#!/usr/bin/env bash
# One-time, interactive Android release signing setup. Run locally; never commit keys.
set -euo pipefail
umask 077

REPO="davi617/AgentControl"
KEYDIR="$HOME/.local/share/agent-control/signing"
PASSDIR="$HOME/.config/agent-control/credentials"
KEYSTORE="$KEYDIR/agentcontrol-release.p12"
PASSFILE="$PASSDIR/android-release-password"
ALIAS="agentcontrol"

for cmd in openssl gh base64; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Falta %s. Instale-o antes de continuar.\n' "$cmd" >&2
    exit 1
  fi
done
gh auth status >/dev/null 2>&1 || { echo "Faca login no GitHub com: gh auth login" >&2; exit 1; }
echo "Esta rotina cria (ou reutiliza) uma chave Android privada no PC e cadastra 4 secrets no GitHub."
echo "A chave e a senha nunca sao adicionadas ao repositorio."
read -r -p "Continuar para $REPO? [s/N] " answer
[[ "$answer" =~ ^[sS]$ ]] || exit 0

install -d -m 700 "$KEYDIR" "$PASSDIR"
if [[ -e "$KEYSTORE" && -e "$PASSFILE" ]]; then
  echo "Reutilizando a chave existente: a assinatura deve permanecer a mesma."
elif [[ -e "$KEYSTORE" || -e "$PASSFILE" ]]; then
  echo "Existe apenas um dos arquivos da chave. Nao vou substitui-los." >&2
  exit 1
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  password="$(openssl rand -hex 32)"
  export AC_ANDROID_RELEASE_PASS="$password"
  openssl req -new -x509 -newkey rsa:3072 -sha256 -days 10000 -nodes \
    -subj '/CN=Agent Control Android Release/' \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
    -name "$ALIAS" -out "$KEYSTORE" -passout env:AC_ANDROID_RELEASE_PASS >/dev/null 2>&1
  printf '%s\n' "$password" > "$PASSFILE"
  chmod 600 "$KEYSTORE" "$PASSFILE"
  echo "Chave PKCS12 criada fora do repositorio."
fi

IFS= read -r password < "$PASSFILE"
export AC_ANDROID_RELEASE_PASS="$password"
openssl pkcs12 -in "$KEYSTORE" -passin env:AC_ANDROID_RELEASE_PASS -info -noout >/dev/null 2>&1
echo "Enviando secrets criptografados ao GitHub Actions..."
base64 < "$KEYSTORE" | tr -d '\r\n' | gh secret set ANDROID_KEYSTORE_B64 -R "$REPO"
printf '%s' "$password" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
printf '%s' "$password" | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"

echo "Pronto: os quatro secrets foram configurados."
echo "GUARDE UM BACKUP SEGURO OFFLINE da chave e da senha. Sem elas nao sera possivel"
echo "atualizar os APKs assinados com essa identidade se o notebook for perdido."
echo "Chave: $KEYSTORE"
echo "Senha: $PASSFILE"
