#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# start.sh — Atualiza e (re)sobe o controle-casa-de-aluguel.
#
# COMO USAR (na VPS):
#   cd ~/PROJETOS/controle-casa-de-aluguel
#   ./start.sh
#
# O que faz, em ordem:
#   1. Confere que tem .env (se não, copia do .env.example e avisa)
#   2. Faz git pull pra trazer atualizações do GitHub
#   3. docker compose up -d --build (idempotente — se nada mudou, não rebuilda)
#   4. Mostra os últimos 40 logs pra você confirmar que subiu
#   5. Testa o /health
#
# Pode rodar quantas vezes quiser. Se nada mudou, ele só verifica
# que o container está up e mostra os logs.
# ─────────────────────────────────────────────────────────────────

set -e  # para na primeira falha

# Cores pra ficar mais legível
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # reset

echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${BLUE}  Controle Casa de Aluguel — start.sh${NC}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ─── 1. .env ─────────────────────────────────────────────────
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}⚠️  .env não existe — copiando do .env.example${NC}"
        cp .env.example .env
        echo -e "${RED}AÇÃO NECESSÁRIA: edite o .env antes de continuar${NC}"
        echo -e "  ${YELLOW}- defina APP_PASSWORD (senha de login)${NC}"
        echo -e "  ${YELLOW}- gere SESSION_SECRET com:  openssl rand -hex 32${NC}"
        echo -e "  ${YELLOW}- mantenha COOKIE_SECURE=true (Caddy faz HTTPS)${NC}"
        exit 1
    else
        echo -e "${RED}❌ Nem .env nem .env.example encontrados!${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✅ .env presente${NC}"

# ─── 2. git pull ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[1/4]${NC} Buscando atualizações do GitHub..."
if [ -d .git ]; then
    git fetch --quiet origin
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "$LOCAL")
    if [ "$LOCAL" = "$REMOTE" ]; then
        echo -e "${GREEN}✅ Já está atualizado (sem mudanças no GitHub)${NC}"
    else
        echo -e "${YELLOW}↓ Tem mudanças novas — fazendo pull${NC}"
        git pull --ff-only
    fi
else
    echo -e "${YELLOW}⚠️  Não é um repo Git — pulando git pull${NC}"
fi

# ─── 3. docker compose up ─────────────────────────────────────
echo ""
echo -e "${BOLD}[2/4]${NC} Subindo container com docker compose..."
echo -e "${YELLOW}(rebuild só roda se algum arquivo mudou; pode demorar 1-2 min na primeira vez)${NC}"
docker compose up -d --build

# ─── 4. logs ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4]${NC} Aguardando container ficar pronto..."
sleep 3
echo -e "${BOLD}Últimos 40 logs:${NC}"
echo -e "${BLUE}────────────────────────────────────────────────${NC}"
docker compose logs --tail=40 controle-casa-de-aluguel || docker compose logs --tail=40
echo -e "${BLUE}────────────────────────────────────────────────${NC}"

# ─── 5. health check ─────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4]${NC} Testando /health..."
PORT=$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '"' | tr -d "'")
PORT=${PORT:-3002}

# Tenta primeiro na network do Docker (via container Caddy se existir)
if docker ps --format '{{.Names}}' | grep -q '^painel_caddy$'; then
    echo "  via painel_caddy (network interna)..."
    if docker exec painel_caddy wget -qO- "http://controle-casa-de-aluguel:${PORT}/health" 2>/dev/null; then
        echo ""
        echo -e "${GREEN}✅ /health respondeu pela rede interna${NC}"
    else
        echo -e "${YELLOW}⚠️  /health não respondeu pela rede interna${NC}"
    fi
fi

# Tenta também via localhost (caso porta esteja exposta)
if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ /health respondeu em http://localhost:${PORT}${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅ Pronto! Acesse:${NC}"
echo -e "${BOLD}     https://aluguel.yourobot.com.br${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
