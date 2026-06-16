#!/bin/bash
# Smoke tests do backend: verifica que o servico esta no ar e que os
# endpoints principais respondem como esperado.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

BASE_URL="http://localhost:8000"
HTTPS_URL="https://api.example.com"

pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC} $1"; }

echo "Smoke tests - Experience Connect backend"
echo

# Servico ativo
if systemctl is-active --quiet cxgame-backend; then
    pass "servico ativo"
else
    fail "servico nao esta ativo"
fi

# Health check local
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
[ "$HTTP_CODE" = "200" ] && pass "health (HTTP $HTTP_CODE)" || fail "health (HTTP $HTTP_CODE)"

# Endpoint raiz
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/")
[ "$HTTP_CODE" = "200" ] && pass "raiz (HTTP $HTTP_CODE)" || fail "raiz (HTTP $HTTP_CODE)"

# Ranking
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/ranking/current")
[ "$HTTP_CODE" = "200" ] && pass "ranking (HTTP $HTTP_CODE)" || fail "ranking (HTTP $HTTP_CODE)"

# Manifesto de intermission deve exigir autenticacao
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"user_id":"00000000-0000-0000-0000-000000000000","season_id":"S-2025-01","level":1,"setor":"CX","challenge_ids":["sel-101"]}' \
    "$BASE_URL/api/intermission/manifest")
[ "$HTTP_CODE" = "403" ] && pass "intermission protegido (HTTP $HTTP_CODE)" || fail "intermission sem protecao (HTTP $HTTP_CODE)"

# HTTPS via Nginx (opcional)
if curl -s -k -o /dev/null -w "%{http_code}" "$HTTPS_URL/health" | grep -q "200"; then
    pass "HTTPS via Nginx"
else
    warn "HTTPS nao configurado ou inacessivel"
fi

# Erros recentes no log
ERROR_COUNT=$(journalctl -u cxgame-backend -n 100 --no-pager | grep -ic "error" || true)
[ "$ERROR_COUNT" -eq 0 ] && pass "sem erros recentes no log" || warn "$ERROR_COUNT erro(s) no log recente"

echo
echo "Smoke tests concluidos."
