#!/usr/bin/env bash
# Puxa o MFA gerado pelo deploy.sh na VPS pra esta pasta.
set -euo pipefail

SSH_ALIAS="${SSH_ALIAS:?defina SSH_ALIAS (host/alias SSH da VPS, ex: SSH_ALIAS=meuvps)}"
REMOTE_DIR="${REMOTE_DIR:-/home/nexus/auth-gateway}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "▶ Puxando MFA de ${SSH_ALIAS}:${REMOTE_DIR} → ${OUT_DIR}"

if ! ssh "$SSH_ALIAS" "sudo test -f ${REMOTE_DIR}/MFA-SETUP.txt"; then
  echo "✗ MFA-SETUP.txt nao existe na VPS. Rode o deploy.sh la primeiro." >&2
  exit 1
fi

ssh "$SSH_ALIAS" "sudo cat ${REMOTE_DIR}/MFA-SETUP.txt" > "${OUT_DIR}/MFA-SETUP.txt"
echo "  ✓ MFA-SETUP.txt"
if ssh "$SSH_ALIAS" "sudo test -f ${REMOTE_DIR}/mfa-qr.png"; then
  ssh "$SSH_ALIAS" "sudo base64 -w0 ${REMOTE_DIR}/mfa-qr.png" | base64 -d > "${OUT_DIR}/mfa-qr.png"
  echo "  ✓ mfa-qr.png"
fi

echo ""
echo "Aqui em ${OUT_DIR}: MFA-SETUP.txt (secret= e a chave manual) e mfa-qr.png (QR)."
read -rp "Apagar as copias da VPS agora (shred)? [y/N] " c
if [[ "${c:-N}" =~ ^[yY]$ ]]; then
  ssh "$SSH_ALIAS" "sudo shred -u ${REMOTE_DIR}/MFA-SETUP.txt ${REMOTE_DIR}/mfa-qr.png 2>/dev/null || true"
  echo "  ✓ copias da VPS apagadas (o segredo segue no banco do Authelia + no seu app)"
else
  echo "  (mantidas — apague depois: sudo shred -u ${REMOTE_DIR}/MFA-SETUP.txt ${REMOTE_DIR}/mfa-qr.png)"
fi
