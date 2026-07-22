#!/usr/bin/env bash
# Provisiona o painel (Authelia + admin-service + frontend) na VPS. Idempotente.
# Requer DOMAIN=... e um .env ao lado com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
set -euo pipefail

NEXUS_USER="${NEXUS_USER:-nexus}"
NEXUS_HOME="${NEXUS_HOME:-/home/nexus}"
: "${DOMAIN:?defina DOMAIN (ex: DOMAIN=painel.seudominio.com)}"
LOGIN_USER="${LOGIN_USER:-admin}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@example.com}"

STAGING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTH_DIR="$NEXUS_HOME/auth-gateway"
WEB_DIR="/var/www/nexus-panel"
ADMIN_DIR="$NEXUS_HOME/admin-service"
AUTHELIA_BIN="/usr/local/bin/authelia"
SECRETS_ENV="${SECRETS_ENV:-$STAGING_DIR/.env}"

log()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '  \033[1;31m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Rode com sudo/root (mexe em /home, systemd, nginx)."
[[ -f "$SECRETS_ENV" ]] || die "Faltou o .env ao lado do deploy.sh (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)."
# shellcheck disable=SC1090
set -a; source "$SECRETS_ENV"; set +a
[[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] \
  || die "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env."

log "Plano"
cat <<EOF
  usuario sistema : $NEXUS_USER  (home: $NEXUS_HOME)
  dominio         : $DOMAIN     (Authelia 9092 · admin-service 8002)
  login do portal : $LOGIN_USER
  NAO toca em: outros servicos/vhosts existentes na VPS (so usa 9092 e 8002)
EOF
[[ "${ASSUME_YES:-0}" == "1" ]] || { read -rp $'\nConfirma? [y/N] ' c; [[ "${c:-N}" =~ ^[yY]$ ]] || die "Abortado."; }

log "1/9 Usuario e diretorios"
id -u "$NEXUS_USER" &>/dev/null || useradd --system --create-home --home-dir "$NEXUS_HOME" --shell /usr/sbin/nologin "$NEXUS_USER"
mkdir -p "$AUTH_DIR" "$WEB_DIR" "$ADMIN_DIR"
ok "estrutura em $NEXUS_HOME"

log "2/9 Copiando arquivos"
cp -r "$STAGING_DIR/auth-gateway/." "$AUTH_DIR/"
# Templates no repo sao genericos (REPLACE_ME_*); o valor real entra so aqui, na VPS.
sed -i "s/REPLACE_ME_DOMAIN/${DOMAIN}/g" "$AUTH_DIR/configuration.yml" "$AUTH_DIR/nginx/panel.conf"
sed -i "s/REPLACE_ME_USER/${LOGIN_USER}/g; s/REPLACE_ME_EMAIL/${CERTBOT_EMAIL}/g" "$AUTH_DIR/users_database.yml"
# Frontend em /var/www (o nginx nao consegue ler de /home/nexus — home dir nao e' traversavel).
cp -r "$STAGING_DIR/frontend/."     "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"; chmod -R 755 "$WEB_DIR"
cp -r "$STAGING_DIR/../admin-service/." "$ADMIN_DIR/"
ok "auth-gateway, frontend (/var/www) e admin-service copiados"

log "3/9 Authelia"
command -v authelia &>/dev/null && ok "authelia ja instalado ($(authelia --version 2>/dev/null | head -1))" \
  || die "authelia nao encontrado em /usr/local/bin — instale o release linux-arm64 primeiro."

log "4/9 Segredos do Authelia"
CFG="$AUTH_DIR/configuration.yml"
gen() { local ph="$1" n="$2"; grep -q "$ph" "$CFG" && sed -i "s|$ph|$(openssl rand -hex "$n")|g" "$CFG" && ok "$ph gerado" || true; }
gen 'REPLACE_ME_session_secret' 64
gen 'REPLACE_ME_storage_encryption_key' 64
gen 'REPLACE_ME_jwt_secret' 32
chmod 600 "$CFG"

log "5/9 ADMIN_SECRET (injetado pelo nginx, validado pelo admin-service)"
ADMIN_SECRET="${ADMIN_SECRET:-$(openssl rand -hex 32)}"
CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 32)}"
IP_HASH_SECRET="${IP_HASH_SECRET:-$(openssl rand -hex 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
ok "segredos prontos"

log "6/9 Senha e MFA (TOTP)"
UDB="$AUTH_DIR/users_database.yml"
GENERATED_PW=""
if grep -q 'REPLACE_WITH_ARGON2_HASH' "$UDB"; then
  if [[ -n "${LOGIN_PASSWORD:-}" ]]; then PW="$LOGIN_PASSWORD"
  elif [[ -t 0 ]]; then read -rsp "  Senha do '$LOGIN_USER' (nao ecoa): " PW; echo
  else PW="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)"; GENERATED_PW="$PW"; warn "nao-interativo → senha gerada (vai no MFA-SETUP.txt)"; fi
  HASH="$("$AUTHELIA_BIN" crypto hash generate argon2 --password "$PW" | awk -F': ' '/Digest/{print $2}')"
  [[ "${HASH:-}" == \$argon2* ]] || die "Falha ao gerar hash argon2."
  ESC="$(printf '%s' "$HASH" | sed -e 's/[&/\]/\\&/g')"
  sed -i "s|REPLACE_WITH_ARGON2_HASH|${ESC}|" "$UDB"
  ok "hash da senha gravado"
else ok "users_database.yml ja tem hash — mantido"; fi
chmod 600 "$UDB"; chown -R "$NEXUS_USER:$NEXUS_USER" "$AUTH_DIR"

sudo -u "$NEXUS_USER" "$AUTHELIA_BIN" storage migrate up --config "$CFG" >/dev/null 2>&1 && ok "storage migrado" || warn "migrate !=0 (talvez ja migrado)"
MFA_FILE="$AUTH_DIR/MFA-SETUP.txt"; MFA_QR="$AUTH_DIR/mfa-qr.png"
if [[ -f "$MFA_FILE" ]]; then warn "MFA-SETUP.txt existe — nao regero (quebraria o app registrado)."
else
  sudo -u "$NEXUS_USER" "$AUTHELIA_BIN" storage user totp generate "$LOGIN_USER" --issuer 'EC Nexus' --config "$CFG" --path "$MFA_QR" > "$MFA_FILE" 2>&1 || die "totp generate falhou."
  [[ -n "$GENERATED_PW" ]] && { echo; echo "=== LOGIN (gerado) ==="; echo "usuario: $LOGIN_USER"; echo "senha:   $GENERATED_PW"; } >> "$MFA_FILE"
  chmod 600 "$MFA_FILE" "$MFA_QR" 2>/dev/null || true; chown "$NEXUS_USER:$NEXUS_USER" "$MFA_FILE" "$MFA_QR" 2>/dev/null || true
  ok "MFA em $MFA_FILE (QR: $MFA_QR)"
fi

log "7/9 admin-service (venv, .env, service em 8002)"
python3 -m venv "$ADMIN_DIR/.venv"
"$ADMIN_DIR/.venv/bin/pip" -q install --upgrade pip >/dev/null 2>&1 || true
if [[ -f "$ADMIN_DIR/requirements.txt" ]]; then "$ADMIN_DIR/.venv/bin/pip" -q install -r "$ADMIN_DIR/requirements.txt" && ok "deps instaladas"
else "$ADMIN_DIR/.venv/bin/pip" -q install -e "$ADMIN_DIR" && ok "deps via setup.py"; fi

if [[ ! -f "$ADMIN_DIR/.env" ]]; then
  cat > "$ADMIN_DIR/.env" <<EOF
ENVIRONMENT=production
HOST=127.0.0.1
PORT=8002
JWT_SECRET=$JWT_SECRET
ADMIN_SECRET=$ADMIN_SECRET
CRON_SECRET=$CRON_SECRET
IP_HASH_SECRET=$IP_HASH_SECRET
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
SUPABASE_KEY=${SUPABASE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_JWT_SECRET=${SUPABASE_JWT_SECRET:-}
REDIS_URL=redis://127.0.0.1:6379
REDIS_ENABLED=true
ALLOWED_ORIGINS=https://$DOMAIN
LOG_LEVEL=INFO
LOG_FORMAT=json
LOG_FILE=$ADMIN_DIR/logs/app.log
EOF
  mkdir -p "$ADMIN_DIR/logs"
  ok ".env do admin-service criado"
else ok ".env do admin-service ja existe — mantido"; fi
chmod 600 "$ADMIN_DIR/.env"; chown -R "$NEXUS_USER:$NEXUS_USER" "$ADMIN_DIR"

cat > /etc/systemd/system/nexus-admin.service <<EOF
[Unit]
Description=EC Nexus admin-service (BFF)
After=network.target
[Service]
User=$NEXUS_USER
Group=$NEXUS_USER
WorkingDirectory=$ADMIN_DIR
EnvironmentFile=$ADMIN_DIR/.env
ExecStart=$ADMIN_DIR/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8002
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/nexus-authelia.service <<EOF
[Unit]
Description=EC Nexus Authelia (auth gateway)
After=network.target
[Service]
User=$NEXUS_USER
Group=$NEXUS_USER
ExecStart=$AUTHELIA_BIN --config $CFG
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now nexus-authelia.service nexus-admin.service
ok "nexus-authelia (9092) e nexus-admin (8002) no ar"

log "8/9 Nginx + certificado"
VHOST_SRC="$AUTH_DIR/nginx/panel.conf"
VHOST_DST="/etc/nginx/sites-available/${DOMAIN}.conf"
sed -i "s|REPLACE_ME_ADMIN_SECRET|${ADMIN_SECRET}|g" "$VHOST_SRC"

if [[ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  mkdir -p /var/www/html
  cat > "$VHOST_DST" <<EOF
server {
    listen 80; listen [::]:80; server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
EOF
  ln -sf "$VHOST_DST" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  nginx -t 2>/tmp/nginx-test && systemctl reload nginx || { cat /tmp/nginx-test; die "nginx -t (stub) falhou."; }
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" || die "certbot falhou."
  ok "certificado emitido"
else ok "certificado ja existe"; fi

install -m 0644 "$VHOST_SRC" "$VHOST_DST"
ln -sf "$VHOST_DST" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t 2>/tmp/nginx-test && { systemctl reload nginx; ok "vhost nexus aplicado"; } || { cat /tmp/nginx-test; die "nginx -t (vhost real) falhou."; }

log "9/9 Fail2ban"
if [[ -f "$AUTH_DIR/fail2ban/filter.d/nexus-authelia.conf" ]]; then
  install -m 0644 "$AUTH_DIR/fail2ban/filter.d/nexus-authelia.conf" /etc/fail2ban/filter.d/nexus-authelia.conf
  install -m 0644 "$AUTH_DIR/fail2ban/jail.d/nexus-authelia.conf"   /etc/fail2ban/jail.d/nexus-authelia.conf
  sudo -u "$NEXUS_USER" touch "$AUTH_DIR/authelia.log" 2>/dev/null || true
  systemctl is-active --quiet fail2ban && { fail2ban-client reload >/dev/null 2>&1 && ok "fail2ban recarregado"; } || warn "fail2ban inativo — jail instalado sem reload."
fi

log "PRONTO ✅"
cat <<EOF

  MFA — registre no seu app autenticador e depois apague:
     sudo cat $MFA_FILE      # URI otpauth:// (o 'secret=' e a chave manual)
     sudo shred -u $MFA_FILE $MFA_QR
  (ou puxe pro seu PC com: nexus-panel/fetch-mfa.sh)

  Acesse: https://$DOMAIN  → login ($LOGIN_USER) + TOTP
  Servicos: systemctl status nexus-authelia nexus-admin --no-pager
EOF
